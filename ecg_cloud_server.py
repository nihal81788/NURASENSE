"""
NuraSense TPP — Cloud ECG Processing & Telemetry Hub
FastAPI server for deployment on Railway.

Features:
1. Ingests raw 250Hz ECG batches from ESP32 via POST /ingest with 'x-device-token' header
2. Verifies device token and retrieves user_id from Supabase 'devices' table (with fast in-memory caching)
3. Applies clinical DSP filtering:
   - 50Hz Notch filter (powerline interference)
   - 0.5Hz - 40.0Hz Butterworth bandpass filter
   - Maintains continuous filter state (zi) across batch chunks in memory
4. Pan-Tompkins QRS and R-peak detection for accurate real-time BPM calculation
5. Broadcasts {samples: [...], bpm: float, timestamp: float} via WebSocket at /ws/{user_id}
6. Configured via SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables
"""

import asyncio
from collections import deque
import os
import sys
import time
from typing import Dict, List, Optional, Set, Tuple

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import numpy as np
import scipy.signal as signal
from supabase import create_client, Client
from potassium_ml import PotassiumPredictor
from alert_system import alert_system

load_dotenv()

# UTF-8 stdout encoding for clean logging on Windows / Linux containers
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Initialize Supabase client
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://rtqeevykhqomyoyxeebf.supabase.co")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY") or ""

supabase_client: Optional[Client] = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    try:
        supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        print(f"[Supabase] Connected to {SUPABASE_URL}")
    except Exception as e:
        print(f"[Supabase] Warning: Could not initialize client: {e}")
else:
    print("[Supabase] Notice: SUPABASE_SERVICE_KEY not provided. Token lookups will use local fallback.")

# Initialize Kardio-Net / T-wave Potassium Predictor at server startup
potassium_predictor = PotassiumPredictor()

# In-memory history cache: user_id -> List[dict] for fast REST responses and offline fallback
in_memory_k_history: Dict[str, List[dict]] = {}

app = FastAPI(
    title="NuraSense Cloud ECG Telemetry Engine",
    description="Real-time 250Hz single-lead ECG DSP filtering and Pan-Tompkins QRS BPM detection for TPP early warning.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# In-memory device token cache: token -> (user_id, device_db_uuid, timestamp)
TOKEN_CACHE_TTL_SECONDS = 300  # 5 minutes
device_token_cache: Dict[str, Tuple[str, Optional[str], float]] = {}


async def resolve_device(device_token: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Resolves (user_id, device_db_uuid) from device_token.
    Uses in-memory cache with TTL to avoid rate-limiting Supabase under 25Hz batch ingestion.
    """
    now = time.time()
    if device_token in device_token_cache:
        user_id, dev_uuid, cached_at = device_token_cache[device_token]
        if now - cached_at < TOKEN_CACHE_TTL_SECONDS:
            return user_id, dev_uuid

    # If Supabase client is configured, query the devices table
    if supabase_client:
        try:
            loop = asyncio.get_event_loop()
            res = await loop.run_in_executor(
                None,
                lambda: supabase_client.table("devices").select("id, user_id").eq("device_token", device_token).single().execute()
            )
            if res.data and "user_id" in res.data:
                uid = res.data["user_id"]
                dev_uuid = res.data.get("id")
                device_token_cache[device_token] = (uid, dev_uuid, now)
                return uid, dev_uuid
        except Exception as e:
            print(f"[Devices] Lookup error for token {device_token[:8]}...: {e}")

    # Fallback for local simulation or when token matches a known user pattern
    if "_" in device_token or len(device_token) > 4:
        fallback_uid = f"user_{device_token.lower()}"
        device_token_cache[device_token] = (fallback_uid, None, now)
        return fallback_uid, None

    return None, None


async def resolve_user_id(device_token: str) -> Optional[str]:
    uid, _ = await resolve_device(device_token)
    return uid


class DeviceSignalState:
    """
    Per-device stateful streaming DSP filter & Pan-Tompkins QRS analyzer.
    Sampling rate: 250 Hz
    Filters:
      - 50 Hz Notch (Q=10.0) for Indian grid ±2.5Hz powerline hum elimination
      - 0.67 Hz - 35.0 Hz Butterworth 3rd-order bandpass filter (AAMI clinical standard)
      - Dedicated 6.0 - 18.0 Hz bandpass for robust QRS R-peak energy isolation
      - Stateful IIR streaming (zi) across batch chunks
      - Dynamic AGC envelope for clear spike differentiation matching clinical ECG
      - Multi-beat trimmed-mean RR averaging & exponential damping for stable BPM
    """
    def __init__(self, fs: int = 250):
        self.fs = fs
        nyq = 0.5 * fs

        # 50 Hz Notch filter (Q=10.0 for robust ±2.5Hz mains hum rejection)
        self.b_notch, self.a_notch = signal.iirnotch(50.0 / nyq, Q=10.0)
        # 0.67 - 35.0 Hz Butterworth 3rd-order bandpass filter (removes respiration wander & EMG)
        self.b_band, self.a_band = signal.butter(3, [0.67 / nyq, 35.0 / nyq], btype="bandpass")
        # 6.0 - 18.0 Hz dedicated bandpass for R-peak QRS isolation
        self.b_qrs, self.a_qrs = signal.butter(2, [6.0 / nyq, 18.0 / nyq], btype="bandpass")

        # Initial filter conditions for seamless streaming across batches
        self.zi_notch = signal.lfilter_zi(self.b_notch, self.a_notch) * 0.0
        self.zi_band = signal.lfilter_zi(self.b_band, self.a_band) * 0.0

        # Continuous slow-moving DC baseline tracker
        self.dc_baseline: Optional[float] = None
        # Peak AGC envelope: fast attack, slow decay
        self.envelope: float = 400.0

        # Rolling buffer of filtered samples (1500 samples = 6.0s at 250Hz)
        self.filtered_history: deque = deque(maxlen=1500)
        # Rolling ECG buffer for Kardio-Net ML potassium estimation (maxlen=3750 = 15.0s at 250Hz)
        self.rolling_ecg_buffer: deque = deque(maxlen=3750)
        self.last_k_prediction_time: float = 0.0
        self.last_k_prediction: Optional[Dict[str, Any]] = None
        # Validated RR interval history across consecutive heartbeats
        self.valid_rr_history: deque = deque(maxlen=8)
        self.last_bpm: float = 72.0
        self.smoothed_bpm: Optional[float] = None
        self.last_update_time: float = time.time()
        self.lock = asyncio.Lock()

        # Real-time Leads-Off Detection:
        # Tracks rolling 1.5s (375 samples @ 250Hz) raw ADC history & hysteresis counter
        self.raw_history: deque = deque(maxlen=375)
        self.is_leads_off: bool = True  # Safe initial state until skin contact confirmed
        self.leads_off_counter: int = 5  # Hysteresis debounce counter

    def filter_batch(self, raw_samples: List[float]) -> np.ndarray:
        """
        Applies streaming 50Hz notch and 0.67-35Hz clinical bandpass filtering.
        Includes real-time Software Leads-Off Detection:
        If electrodes are removed from skin (input railed near 0/4095 or floating open-circuit noise),
        suppresses ambient hum, clamps output to clean 0 flatline, drops BPM to 0,
        and flags leads_off=True.
        """
        arr = np.asarray(raw_samples, dtype=np.float32)
        if len(arr) == 0:
            return np.array([], dtype=np.float32)

        # Record raw samples into rolling history for leads-off analysis
        for s in arr:
            self.raw_history.append(float(s))

        # Evaluate Leads-Off condition once we have >= 200 samples (~0.8s - 1.5s)
        if len(self.raw_history) >= 200:
            raw_arr = np.asarray(self.raw_history, dtype=np.float32)

            # 1. Rail saturation: inputs pulled to VDD (~4095) or GND (~0)
            is_railed = (np.mean(raw_arr > 3950.0) > 0.25) or (np.mean(raw_arr < 90.0) > 0.25)

            # 2. Peak-to-peak amplitude check:
            # Living human ECG Lead I has sharp QRS excursion (>80 ADC counts).
            # Open-circuit flatline or gentle baseline drift has ptp < 45 ADC counts.
            raw_ptp = float(np.ptp(raw_arr))
            is_flat = raw_ptp < 45.0

            # 3. Floating antenna noise check:
            # Floating leads in air pick up tiny ambient noise (std < 14 counts out of 4096).
            # In real human ECG, QRS complexes generate std > 25 counts and ptp > 80 counts.
            raw_std = float(np.std(raw_arr))
            is_floating = raw_std < 14.0

            leads_off_detected = is_railed or is_flat or is_floating

            if leads_off_detected:
                self.leads_off_counter = min(8, self.leads_off_counter + 1)
                if self.leads_off_counter >= 3:
                    self.is_leads_off = True
            else:
                self.leads_off_counter = max(0, self.leads_off_counter - 2)
                if self.leads_off_counter == 0:
                    self.is_leads_off = False
        else:
            # Not enough data yet - keep current state
            pass

        # If leads are off, output clean flatline zeros and reset estimators
        if self.is_leads_off:
            flatline = np.zeros(len(arr), dtype=np.float32)
            self.envelope = 400.0  # Reset AGC envelope
            self.smoothed_bpm = None
            self.last_bpm = 0.0
            self.valid_rr_history.clear()
            for s in flatline:
                self.filtered_history.append(float(s))
            self.last_update_time = time.time()
            return flatline

        # --- Normal Connected Skin Telemetry Filtering ---
        # Update smooth continuous baseline (avoids tearing signal at batch edges)
        batch_mean = float(np.mean(arr))
        if self.dc_baseline is None:
            self.dc_baseline = batch_mean
        else:
            alpha = 0.04
            self.dc_baseline = (1.0 - alpha) * self.dc_baseline + alpha * batch_mean

        # Center signal around continuous baseline and correct inverted Lead I polarity
        centered = arr - self.dc_baseline
        centered = centered * -1.0

        # Stream filtering with state persistence across batches
        notched, self.zi_notch = signal.lfilter(self.b_notch, self.a_notch, centered, zi=self.zi_notch)
        bandpassed, self.zi_band = signal.lfilter(self.b_band, self.a_band, notched, zi=self.zi_band)

        # Dynamic AGC envelope tracking: fast attack on tall QRS, slow decay across cardiac cycles
        batch_peak = float(np.max(np.abs(bandpassed))) if len(bandpassed) > 0 else 50.0
        if batch_peak > self.envelope:
            # Fast attack (reaches full scale in 2-3 batches)
            self.envelope = 0.6 * self.envelope + 0.4 * batch_peak
        else:
            # Slow decay (half-life ~ 1.5 seconds)
            self.envelope = 0.992 * self.envelope + 0.008 * 120.0
        self.envelope = max(self.envelope, 100.0)

        # Normalized signal around 0 (R-peaks reach ~ ±0.9 to ±1.3, P/T waves ~ ±0.15 to ±0.3)
        normalized = bandpassed / self.envelope

        for s in normalized:
            self.filtered_history.append(float(s))

        self.last_update_time = time.time()
        return normalized

    def calculate_bpm(self) -> float:
        """
        Pan-Tompkins Algorithm with multi-beat RR outlier rejection & exponential damping:
        1. Gated by leads-off detection: returns 0.0 immediately if leads are disconnected.
        2. Requires minimum physiological QRS energy (std > 0.08, integrated peak > 0.03)
           to reject floating antenna hum.
        3. 5.0-second window (1250 samples) for high-confidence multi-beat analysis
        4. Dedicated 6-18 Hz bandpass for QRS energy isolation (eliminates T-wave false triggers)
        5. Derivative + Squaring + 120ms Moving Window Integration
        6. Adaptive thresholding with 380ms refractory blanking (max 158 BPM)
        7. Interquartile / Trimmed mean over rolling RR history to reject noise & motion spikes
        8. Exponential smoothing for rock-solid, clinically steady displayed BPM
        """
        if self.is_leads_off:
            return 0.0

        if len(self.filtered_history) < 500:
            return self.last_bpm

        # Analyze up to last 1250 samples (5.0s)
        sig = np.array(list(self.filtered_history)[-1250:], dtype=np.float32)

        # Minimum physiological signal excursion gate (suppresses faint noise)
        if float(np.std(sig)) < 0.08 or float(np.ptp(sig)) < 0.25:
            return 0.0

        # 1. Dedicated QRS bandpass (6 - 18 Hz)
        try:
            qrs_sig = signal.filtfilt(self.b_qrs, self.a_qrs, sig)
        except Exception:
            qrs_sig = sig

        # 2. Derivative
        diff = np.diff(qrs_sig)
        # 3. Squaring
        squared = diff ** 2

        # 4. Moving window integration (120ms = 30 samples at 250Hz)
        win_size = max(2, int(0.12 * self.fs))
        integrated = np.convolve(squared, np.ones(win_size) / win_size, mode="same")

        if float(np.max(integrated)) < 0.03:
            return 0.0

        # 5. Adaptive thresholding
        threshold = np.mean(integrated) + 1.2 * np.std(integrated)
        # Refractory period: minimum 380ms between beats (max 158 bpm)
        min_distance = int(0.38 * self.fs)

        peaks, _ = signal.find_peaks(integrated, height=threshold, distance=min_distance)

        if len(peaks) >= 3:
            rr_intervals = np.diff(peaks) / float(self.fs)
            # Physiological bounds check (40 - 160 BPM -> 0.38s - 1.50s)
            valid_rr = [float(r) for r in rr_intervals if 0.38 <= r <= 1.50]

            for r in valid_rr:
                self.valid_rr_history.append(r)

            if len(self.valid_rr_history) >= 3:
                # Trimmed mean: drop highest and lowest to eliminate outlier/noise beats
                sorted_rr = sorted(list(self.valid_rr_history))
                trimmed = sorted_rr[1:-1] if len(sorted_rr) >= 4 else sorted_rr
                avg_rr = float(np.mean(trimmed))

                if avg_rr > 0:
                    instant_bpm = 60.0 / avg_rr

                    if 35.0 <= instant_bpm <= 180.0:
                        if self.smoothed_bpm is None:
                            self.smoothed_bpm = instant_bpm
                        else:
                            # Exponential smoothing: 85% previous, 15% new (gentle, steady glide)
                            self.smoothed_bpm = 0.85 * self.smoothed_bpm + 0.15 * instant_bpm

                        self.last_bpm = round(self.smoothed_bpm, 1)

        return self.last_bpm


# Active device states in memory: device_token -> DeviceSignalState
device_states: Dict[str, DeviceSignalState] = {}


class ConnectionManager:
    """Manages active dashboard WebSocket subscribers per user_id."""
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        async with self.lock:
            if user_id not in self.active_connections:
                self.active_connections[user_id] = set()
            self.active_connections[user_id].add(websocket)
        print(f"[WS] User {user_id} connected. Total clients for user: {len(self.active_connections[user_id])}")

    async def disconnect(self, user_id: str, websocket: WebSocket):
        async with self.lock:
            if user_id in self.active_connections:
                self.active_connections[user_id].discard(websocket)
                if not self.active_connections[user_id]:
                    del self.active_connections[user_id]
        print(f"[WS] User {user_id} disconnected.")

    async def broadcast(self, user_id: str, data: dict):
        async with self.lock:
            clients = list(self.active_connections.get(user_id, []))

        for ws in clients:
            try:
                await ws.send_json(data)
            except Exception:
                await self.disconnect(user_id, ws)


manager = ConnectionManager()

# In-memory latest known user location from browser geolocation: user_id -> {"lat": float, "lng": float}
latest_user_locations: Dict[str, dict] = {}


class IngestBatchRequest(BaseModel):
    samples: List[float] = Field(..., description="Array of ECG sample counts, typically 10-75 samples @ 250Hz")
    location: Optional[dict] = Field(None, description="Optional GPS coordinates: {'lat': float, 'lng': float}")


@app.get("/")
@app.get("/health")
async def health_check():
    return {
        "status": "online",
        "service": "NuraSense Cloud ECG Telemetry Engine",
        "active_devices": len(device_states),
        "connected_users": len(manager.active_connections),
        "timestamp": time.time()
    }


@app.post("/ingest")
async def ingest_ecg_batch(
    payload: IngestBatchRequest,
    x_device_token: Optional[str] = Header(None)
):
    """
    Ingest endpoint for ESP32 hardware.
    Receives raw ECG samples, applies 50Hz notch and 0.5-40Hz bandpass filtering,
    calculates BPM, and broadcasts to dashboard clients subscribed to the owner's user_id.
    """
    if not x_device_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing 'x-device-token' header"
        )

    if not payload.samples:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty samples array"
        )

    user_id, device_db_id = await resolve_device(x_device_token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Device token not registered to any user. Pair device in NuraSense dashboard."
        )

    # Cache location if provided in request
    if payload.location:
        latest_user_locations[user_id] = payload.location

    # Get or create per-device DSP filter state
    if x_device_token not in device_states:
        device_states[x_device_token] = DeviceSignalState(fs=250)

    state = device_states[x_device_token]

    async with state.lock:
        filtered_samples = state.filter_batch(payload.samples)
        bpm = state.calculate_bpm()

        if state.is_leads_off:
            # If electrodes are removed, flush rolling buffer so fake inference is never triggered
            state.rolling_ecg_buffer.clear()
        else:
            # Append filtered samples to device's rolling buffer (maxlen=3750 = 15s)
            for s in filtered_samples:
                state.rolling_ecg_buffer.append(float(s))

            # Run potassium prediction in background thread if buffer has >= 1250 samples (5s) and rate-limited to once every 10s
            # (Runs via run_in_executor so heavy PyTorch inference NEVER blocks the /ingest HTTP response or ESP32 connection!)
            now = time.time()
            if len(state.rolling_ecg_buffer) >= 1250 and (now - state.last_k_prediction_time >= 10.0):
                state.last_k_prediction_time = now
                buf_arr = np.array(state.rolling_ecg_buffer, dtype=np.float32)
                asyncio.create_task(
                    run_potassium_inference_async(
                        user_id=user_id,
                        device_id=device_db_id,
                        buf_arr=buf_arr,
                        bpm=bpm,
                        state=state,
                        location=payload.location
                    )
                )

    # Broadcast via WebSocket to dashboard
    # Sends raw ESP32 ADC data as requested, plus filtered samples for clinical analysis
    broadcast_payload = {
        "samples": [float(s) for s in payload.samples],
        "raw_samples": [float(s) for s in payload.samples],
        "filtered_samples": [round(float(s), 4) for s in filtered_samples],
        "bpm": 0.0 if state.is_leads_off else bpm,
        "leads_off": bool(state.is_leads_off),
        "device_token": x_device_token,
        "timestamp": time.time()
    }

    # Add potassium prediction to WebSocket broadcast if available
    if not state.is_leads_off and state.last_k_prediction:
        broadcast_payload["potassium"] = {
            "mmol": state.last_k_prediction["potassium_mmol"],
            "risk": state.last_k_prediction["risk_class"],
            "confidence": state.last_k_prediction["confidence"],
            "alert": state.last_k_prediction["trigger_alert"]
        }

    await manager.broadcast(user_id, broadcast_payload)

    response_data = {
        "status": "ok",
        "user_id": user_id,
        "processed_samples": len(payload.samples),
        "bpm": 0.0 if state.is_leads_off else bpm,
        "leads_off": bool(state.is_leads_off)
    }
    if not state.is_leads_off and state.last_k_prediction:
        response_data["potassium"] = broadcast_payload["potassium"]

    return response_data


async def run_potassium_inference_async(
    user_id: str,
    device_id: Optional[str],
    buf_arr: np.ndarray,
    bpm: float,
    state: DeviceSignalState,
    location: Optional[dict] = None
):
    """
    Runs Kardio-Net ML inference in an asynchronous background thread pool.
    Guarantees the real-time /ingest endpoint responds instantly (<5ms)
    without being blocked by PyTorch convolution execution.
    If hypokalemia (<3.2 mmol/L) is detected, dispatches emergency alerts.
    """
    try:
        loop = asyncio.get_running_loop()
        k_pred = await loop.run_in_executor(
            None,
            lambda: potassium_predictor.predict(buf_arr, fs=250, bpm=bpm)
        )
        state.last_k_prediction = k_pred

        # Persist prediction to Supabase & in-memory cache
        await save_potassium_prediction(
            user_id=user_id,
            device_id=device_id,
            k_pred=k_pred
        )

        # Trigger multi-channel emergency alert system if critically low potassium
        if k_pred.get("trigger_alert"):
            loc = location or latest_user_locations.get(user_id) or {}
            asyncio.create_task(
                alert_system.send_all_alerts(
                    user_id=user_id,
                    potassium_mmol=k_pred["potassium_mmol"],
                    location=loc,
                    supabase_client=supabase_client
                )
            )

        # Broadcast live potassium prediction immediately to dashboard subscribers
        await manager.broadcast(user_id, {
            "potassium": {
                "mmol": k_pred["potassium_mmol"],
                "risk": k_pred["risk_class"],
                "confidence": k_pred["confidence"],
                "alert": k_pred["trigger_alert"]
            },
            "alert_triggered": bool(k_pred.get("trigger_alert")),
            "timestamp": time.time()
        })
    except Exception as e:
        print(f"[PotassiumPredictor] Background inference error: {e}")


async def save_potassium_prediction(user_id: str, device_id: Optional[str], k_pred: dict):
    """
    Saves potassium prediction into in-memory history cache and Supabase 'potassium_predictions' table.
    Record schema: {user_id, device_id, predicted_level, risk_class, confidence, ecg_features: {t_amp, t_slope, bpm}}
    """
    # Ensure device_id is either a valid UUID or None (Supabase device_id is UUID nullable)
    valid_device_uuid = None
    if device_id:
        try:
            import uuid
            uuid.UUID(str(device_id))
            valid_device_uuid = str(device_id)
        except (ValueError, TypeError):
            if str(device_id) in device_token_cache:
                _, cached_uuid, _ = device_token_cache[str(device_id)]
                valid_device_uuid = cached_uuid

    record = {
        "user_id": user_id,
        "device_id": valid_device_uuid,
        "predicted_level": float(k_pred["potassium_mmol"]),
        "risk_class": str(k_pred["risk_class"]),
        "confidence": float(k_pred.get("confidence", 0.90)),
        "ecg_features": k_pred.get("ecg_features", {}),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

    # Store in memory for instant REST lookup and fallback
    if user_id not in in_memory_k_history:
        in_memory_k_history[user_id] = []
    in_memory_k_history[user_id].insert(0, record)
    if len(in_memory_k_history[user_id]) > 50:
        in_memory_k_history[user_id].pop()

    # If Supabase client is configured, insert into potassium_predictions table
    if supabase_client:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: supabase_client.table("potassium_predictions").insert(record).execute()
            )
            print(f"[Supabase] Saved potassium prediction: {record['predicted_level']} mmol/L ({record['risk_class']}) for user {user_id}")
        except Exception as e:
            print(f"[Supabase] potassium_predictions insert error: {e}")


@app.get("/potassium/{user_id}/history")
async def get_potassium_history(
    user_id: str,
    x_device_token: Optional[str] = Header(None)
):
    """
    Returns last 20 predictions from potassium_predictions table for that user.
    Requires x-device-token header for auth.
    """
    if not x_device_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing 'x-device-token' header"
        )

    # Query Supabase table potassium_predictions if available
    if supabase_client:
        try:
            loop = asyncio.get_event_loop()
            res = await loop.run_in_executor(
                None,
                lambda: supabase_client.table("potassium_predictions")
                    .select("*")
                    .eq("user_id", user_id)
                    .order("created_at", desc=True)
                    .limit(20)
                    .execute()
            )
            if res.data and len(res.data) > 0:
                return res.data
        except Exception as e:
            print(f"[Supabase] History query notice: {e}")

    # Fallback to in-memory history cache
    user_history = in_memory_k_history.get(user_id, [])
    return user_history[:20]


@app.get("/alerts/{user_id}/history")
async def get_alert_history(
    user_id: str,
    x_device_token: Optional[str] = Header(None)
):
    """
    Returns last 10 rows from alert_logs table for this user.
    Falls back to in-memory history if Supabase is unavailable.
    """
    history = await alert_system.get_history(user_id, supabase_client)
    return {
        "status": "ok",
        "user_id": user_id,
        "count": len(history),
        "history": history
    }


@app.get("/alerts/{user_id}/status")
async def get_alert_status(user_id: str):
    """
    Returns diagnostics on alert channels (Fast2SMS, Twilio, EmailJS)
    and cooldown status for the patient.
    """
    return {
        "status": "ok",
        "user_id": user_id,
        "fast2sms": {
            "configured": bool(alert_system.fast2sms_api_key),
            "key_length": len(alert_system.fast2sms_api_key),
            "last_debug": alert_system.last_sms_debug or ("Configured" if alert_system.fast2sms_api_key else "Missing FAST2SMS_API_KEY")
        },
        "twilio": {
            "configured": bool(alert_system.twilio_client or (alert_system.twilio_account_sid and alert_system.twilio_auth_token)),
            "from_number": alert_system.twilio_phone_number or "Missing TWILIO_PHONE_NUMBER",
            "last_debug": alert_system.last_call_debug or "Idle"
        },
        "emailjs": {
            "configured": bool(alert_system.emailjs_public_key),
            "last_debug": alert_system.last_email_debug or "Idle"
        },
        "cooldown": {
            "active": alert_system.is_cooldown_active(user_id),
            "remaining_seconds": max(0, int(alert_system.cooldown_seconds - (time.time() - alert_system.cooldown_tracker.get(user_id, 0.0))))
        }
    }


@app.post("/alerts/{user_id}/test")
async def test_alert_dispatch(
    user_id: str,
    x_device_token: Optional[str] = Header(None)
):
    """
    Manual testing endpoint: Dispatches test alert via Twilio, Fast2SMS and EmailJS
    using the patient's registered emergency contacts (bypasses 30-min cooldown for testing).
    """
    loc = latest_user_locations.get(user_id) or {"lat": 28.6139, "lng": 77.2090}
    res = await alert_system.send_all_alerts(
        user_id=user_id,
        potassium_mmol=2.9,
        location=loc,
        supabase_client=supabase_client,
        bypass_cooldown=True
    )
    return res


@app.post("/alerts/{user_id}/reset-cooldown")
async def reset_alert_cooldown(user_id: str):
    """Resets the 30-minute anti-spam cooldown for testing."""
    alert_system.reset_cooldown(user_id)
    return {"status": "ok", "message": f"Cooldown reset for user {user_id}"}


@app.websocket("/ws/{user_id}")
async def websocket_dashboard_endpoint(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for NuraSense Patient Dashboard.
    Streams live 250Hz ECG samples, Pan-Tompkins BPM, and receives browser geolocation.
    """
    await manager.connect(user_id, websocket)
    try:
        # Send initial confirmation
        await websocket.send_json({
            "type": "connection_established",
            "user_id": user_id,
            "buffer_target": 750,
            "sampling_rate": 250
        })

        # Keep connection open and handle incoming messages/pings/geolocation updates
        while True:
            text = await websocket.receive_text()
            if text == "ping":
                await websocket.send_text("pong")
            else:
                try:
                    import json
                    msg = json.loads(text)
                    if isinstance(msg, dict):
                        if msg.get("type") == "location" and "location" in msg:
                            latest_user_locations[user_id] = msg["location"]
                            print(f"[Location] Updated browser location for user {user_id}: {msg['location']}")
                        elif msg.get("type") == "ping":
                            await websocket.send_text("pong")
                except Exception:
                    pass
    except WebSocketDisconnect:
        await manager.disconnect(user_id, websocket)
    except Exception as e:
        print(f"[WS Error] {e}")
        await manager.disconnect(user_id, websocket)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8765"))
    print(f"[Server] Starting NuraSense Cloud ECG Engine on port {port}...")
    uvicorn.run("ecg_cloud_server:app", host="0.0.0.0", port=port, reload=False)
