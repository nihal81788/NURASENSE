"""
NuraSense - Galaxy Watch Telemetry Server
FastAPI ingestion service & real-time WebSocket broadcaster for:
- Continuous Heart Rate & IBI
- Clinical RMSSD (HRV) calculation
- 3-Axis Accelerometer with Tremor RMS calculation
- Blood Oxygen (SpO2)
- Wrist Skin Temperature & Ambient Temperature
- Sweat Loss (Water Loss after running workout)

Zero ECG. Full multi-modal biometric synchronization with NuraSense portal.
"""

import asyncio
from collections import deque
import json
import math
import os
import sys
import time
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

# Ensure Windows terminal prints UTF-8 cleanly without cp1252 errors
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

app = FastAPI(
    title="NuraSense Galaxy Watch Telemetry Hub",
    description="Streams real-time multi-modal Galaxy Watch biometrics: HR, IBI/HRV, Sweat Loss, SpO2, Skin Temp, and 3-Axis Accel.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rolling buffer of Inter-Beat Intervals (IBI in ms) for RMSSD HRV calculation
ibi_history: deque = deque(maxlen=100)

# Global sensor state
last_known_hr: Optional[int] = None
last_known_ibi: Optional[int] = None
last_known_spo2: Optional[int] = None
last_known_spo2_status: Optional[int] = None
last_known_skin_temp: Optional[float] = None
last_known_ambient_temp: Optional[float] = None
last_known_sweat_loss: Optional[float] = None
last_known_sweat_status: Optional[int] = None

last_known_accel: Dict[str, Any] = {
    "x": 0, "y": 0, "z": 0, "magnitude": 0.0, "tremor_rms": 0.0
}

# Rolling buffer for accelerometer tremor RMS calculation
accel_mag_history: deque = deque(maxlen=50)

total_packets_received: int = 0
total_accel_samples_received: int = 0
last_backend_sync_time: float = 0.0
backend_client: Optional[Any] = None

@app.on_event("startup")
async def startup_event():
    global backend_client
    try:
        import httpx
        backend_client = httpx.AsyncClient(timeout=1.0)
    except Exception:
        backend_client = None

@app.on_event("shutdown")
async def shutdown_event():
    global backend_client
    if backend_client:
        await backend_client.aclose()


def calculate_clinical_rmssd(window: deque) -> Optional[float]:
    """
    Computes clinical Root Mean Square of Successive Differences (RMSSD) in ms:
    RMSSD = sqrt( (1 / (N - 1)) * sum_{i=1}^{N-1} (IBI_{i+1} - IBI_i)^2 )
    Filters for physiological plausibility (300 ms to 2000 ms, corresponding to 30-200 BPM).
    """
    valid_ibis = [val for val in window if isinstance(val, (int, float)) and 300 <= val <= 2000]
    n = len(valid_ibis)
    if n < 2:
        return None

    squared_diffs = [(valid_ibis[i + 1] - valid_ibis[i]) ** 2 for i in range(n - 1)]
    mean_squared_diff = sum(squared_diffs) / (n - 1)
    return round(math.sqrt(mean_squared_diff), 2)


def calculate_tremor_rms(window: deque) -> float:
    """Computes Root-Mean-Square tremor magnitude fluctuation around mean acceleration."""
    if len(window) < 5:
        return 0.0
    mean_mag = sum(window) / len(window)
    sq_deviations = [(val - mean_mag) ** 2 for val in window]
    return round(math.sqrt(sum(sq_deviations) / len(sq_deviations)), 3)


# WebSocket Connection Manager
class TelemetryConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"[WS] Client connected. Total active clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"[WS] Client disconnected. Remaining clients: {len(self.active_connections)}")

    async def broadcast(self, data: dict):
        if not self.active_connections:
            return

        dead_connections = []
        for connection in list(self.active_connections):
            try:
                await connection.send_json(data)
            except Exception:
                dead_connections.append(connection)

        for dead in dead_connections:
            self.disconnect(dead)


manager = TelemetryConnectionManager()


# Schema for incoming sensor telemetry payload from Watch
class SensorDataPayload(BaseModel):
    type: Optional[str] = "biometrics"
    timestamp: Optional[float] = None
    heartRate: Optional[int] = None
    ibi: Optional[List[int]] = None
    hr_status: Optional[int] = None

    # Sweat Loss (Water Loss amount after running workout)
    sweat_loss: Optional[float] = None
    sweat_status: Optional[int] = None

    # SpO2
    spo2: Optional[int] = None
    spo2_status: Optional[int] = None

    # Skin Temperature
    skin_temp: Optional[float] = None
    ambient_temp: Optional[float] = None
    temp_status: Optional[int] = None

    # Accelerometer
    accel_x: Optional[float] = None
    accel_y: Optional[float] = None
    accel_z: Optional[float] = None
    accel_magnitude: Optional[float] = None
    accel_samples: Optional[List[Dict[str, Any]]] = None

    status: Optional[str] = None
    device: Optional[str] = None


@app.get("/", response_class=HTMLResponse)
async def serve_dashboard():
    """Serves the comprehensive multi-sensor dark-mode telemetry dashboard."""
    html_path = os.path.join(os.path.dirname(__file__), "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h2>Dashboard index.html not found</h2>", status_code=404)


@app.get("/health")
async def health_check():
    """Returns real-time service health, tracker state, and buffer statistics."""
    rmssd = calculate_clinical_rmssd(ibi_history)
    return {
        "status": "healthy",
        "active_ws_clients": len(manager.active_connections),
        "total_packets": total_packets_received,
        "total_accel_samples": total_accel_samples_received,
        "latest_heart_rate": last_known_hr,
        "latest_ibi": last_known_ibi,
        "current_rmssd_ms": rmssd,
        "latest_sweat_loss_ml": last_known_sweat_loss,
        "latest_sweat_status": last_known_sweat_status,
        "latest_spo2": last_known_spo2,
        "latest_skin_temp_c": last_known_skin_temp,
        "latest_ambient_temp_c": last_known_ambient_temp,
        "latest_accel": last_known_accel,
        "ibi_buffer_size": len(ibi_history)
    }


@app.post("/sensor-data")
async def receive_sensor_data(payload: SensorDataPayload):
    """
    Ingests continuous HR, IBI lists, Sweat Loss, SpO2, Skin Temp, and 3-Axis Accel.
    Computes rolling RMSSD (HRV) and tremor RMS, then broadcasts to connected WebSockets.
    """
    global total_packets_received, total_accel_samples_received
    global last_known_hr, last_known_ibi
    global last_known_sweat_loss, last_known_sweat_status
    global last_known_spo2, last_known_spo2_status
    global last_known_skin_temp, last_known_ambient_temp, last_known_accel

    total_packets_received += 1
    current_time_ms = payload.timestamp or (time.time() * 1000)

    # 1. Process Heart Rate & IBI
    if payload.heartRate is not None and payload.heartRate > 0:
        last_known_hr = payload.heartRate

    if payload.ibi:
        for ibi_val in payload.ibi:
            if ibi_val and 300 <= ibi_val <= 2000:
                ibi_history.append(ibi_val)
                last_known_ibi = ibi_val

    # 2. Process Sweat Loss (Running Workout Water Loss)
    if payload.sweat_loss is not None:
        last_known_sweat_loss = round(payload.sweat_loss, 2)
    if payload.sweat_status is not None:
        last_known_sweat_status = payload.sweat_status

    # 3. Process SpO2
    if payload.spo2 is not None and payload.spo2 > 0:
        last_known_spo2 = payload.spo2
    if payload.spo2_status is not None:
        last_known_spo2_status = payload.spo2_status

    # 4. Process Skin Temperature
    if payload.skin_temp is not None:
        last_known_skin_temp = round(payload.skin_temp, 2)
    if payload.ambient_temp is not None:
        last_known_ambient_temp = round(payload.ambient_temp, 2)

    # 5. Process 3-Axis Accelerometer
    if payload.accel_magnitude is not None:
        accel_mag_history.append(payload.accel_magnitude)
        tremor_rms = calculate_tremor_rms(accel_mag_history)
        last_known_accel = {
            "x": payload.accel_x or 0,
            "y": payload.accel_y or 0,
            "z": payload.accel_z or 0,
            "magnitude": round(payload.accel_magnitude, 2),
            "tremor_rms": tremor_rms
        }

    if payload.accel_samples:
        total_accel_samples_received += len(payload.accel_samples)

    # Compute clinical RMSSD
    rmssd = calculate_clinical_rmssd(ibi_history)

    # Format clean terminal readout
    parts = []
    if last_known_hr:
        parts.append(f"HR: {last_known_hr} BPM")
    if rmssd:
        parts.append(f"RMSSD: {rmssd} ms")
    if last_known_ibi:
        parts.append(f"IBI: {last_known_ibi} ms")
    if last_known_sweat_loss is not None:
        parts.append(f"Sweat Loss: {last_known_sweat_loss} mL")
    if last_known_spo2:
        parts.append(f"SpO2: {last_known_spo2}%")
    if last_known_skin_temp:
        parts.append(f"Skin Temp: {last_known_skin_temp} C")
    if last_known_accel.get("magnitude"):
        parts.append(f"Accel: {last_known_accel['magnitude']} m/s2 (X:{last_known_accel.get('x',0)} Y:{last_known_accel.get('y',0)} Z:{last_known_accel.get('z',0)} Tremor:{last_known_accel.get('tremor_rms',0)})")

    summary_str = " | ".join(parts) if parts else "Telemetry Received"
    print(f"[*] [WATCH TELEMETRY #{total_packets_received:04d}] {summary_str}", flush=True)

    # Format broadcast payload
    broadcast_msg = {
        "type": payload.type or "telemetry",
        "timestamp": current_time_ms,
        "heartRate": last_known_hr,
        "hr_status": payload.hr_status,
        "ibi": payload.ibi or [],
        "latestIbi": last_known_ibi,
        "rmssd": rmssd,
        "sweat_loss": last_known_sweat_loss,
        "sweat_status": last_known_sweat_status,
        "spo2": last_known_spo2,
        "spo2_status": last_known_spo2_status,
        "skin_temp": last_known_skin_temp,
        "ambient_temp": last_known_ambient_temp,
        "accel": last_known_accel,
        "accel_samples": payload.accel_samples or [],
        "status": payload.status or "active"
    }

    # Asynchronously dispatch to all connected dashboard websockets
    asyncio.create_task(manager.broadcast(broadcast_msg))

    # Synchronize to NuraSense backend (port 4000) using reusable client without socket exhaustion
    now_sync = time.time()
    if backend_client and (payload.type != "accelerometer" or (now_sync - last_backend_sync_time) >= 1.0):
        last_backend_sync_time = now_sync
        async def sync_to_backend():
            try:
                await backend_client.post("http://127.0.0.1:4000/api/telemetry/watch-data", json={
                    "heartRate": last_known_hr,
                    "rmssd": rmssd,
                    "sweatLoss": last_known_sweat_loss,
                    "spo2": last_known_spo2,
                    "skinTemp": last_known_skin_temp,
                    "accel": last_known_accel
                })
            except Exception:
                pass
        asyncio.create_task(sync_to_backend())

    return {
        "status": "success",
        "packets_processed": total_packets_received,
        "rmssd": rmssd,
        "sweat_loss": last_known_sweat_loss,
        "hr": last_known_hr
    }


@app.websocket("/ws")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time telemetry streaming to browsers & clients."""
    await manager.connect(websocket)

    # Immediately deliver current state upon connection
    init_state = {
        "type": "init",
        "timestamp": time.time() * 1000,
        "heartRate": last_known_hr,
        "latestIbi": last_known_ibi,
        "rmssd": calculate_clinical_rmssd(ibi_history),
        "sweat_loss": last_known_sweat_loss,
        "sweat_status": last_known_sweat_status,
        "spo2": last_known_spo2,
        "spo2_status": last_known_spo2_status,
        "skin_temp": last_known_skin_temp,
        "ambient_temp": last_known_ambient_temp,
        "accel": last_known_accel,
        "status": "connected"
    }
    await websocket.send_json(init_state)

    try:
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=20.0)
                if msg == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # Keepalive heartbeat
                await websocket.send_json({"type": "heartbeat", "time": time.time()})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# Simulation state
simulation_running = False
simulation_task = None


@app.post("/simulate/toggle")
async def toggle_simulation():
    """Toggles the synthetic multi-sensor biometric generator."""
    global simulation_running, simulation_task
    simulation_running = not simulation_running

    if simulation_running:
        simulation_task = asyncio.create_task(run_simulation_stream())
        return {"status": "started", "message": "Synthetic multi-sensor stream running."}
    else:
        if simulation_task:
            simulation_task.cancel()
            simulation_task = None
        return {"status": "stopped", "message": "Synthetic stream halted."}


async def run_simulation_stream():
    """Generates synthetic HR, IBI, Sweat Loss, SpO2, Skin Temp, and 3-Axis movement."""
    print("[SIMULATOR] Synthetic multi-sensor stream started (Running Workout Mode)...")
    t = 0.0
    sim_hr = 76
    base_temp = 34.2
    base_spo2 = 98
    simulated_sweat_loss = 45.0  # starts at 45 mL lost water

    while simulation_running:
        # IBI variation
        mock_ibi = int(833 + 30 * math.sin(t * 0.5))
        ibi_history.append(mock_ibi)

        # 3-Axis Accel with running gait oscillation
        accel_x = round(12.0 * math.sin(t * 8.0) + (time.time() % 3), 1)
        accel_y = round(-45.0 + 8.0 * math.cos(t * 7.5), 1)
        accel_z = round(980.0 + 15.0 * math.sin(t * 9.0), 1)
        accel_mag = round(math.sqrt(accel_x**2 + accel_y**2 + accel_z**2) / 100.0, 2)

        # Skin Temp & SpO2
        mock_skin_temp = round(base_temp + 0.15 * math.sin(t * 0.1), 1)
        mock_ambient_temp = 24.5
        mock_spo2 = base_spo2 if (int(t) % 20 < 15) else 99

        # Sweat water loss accumulates during running workout
        simulated_sweat_loss = round(simulated_sweat_loss + 0.08, 1)

        payload = SensorDataPayload(
            type="multi_stream",
            timestamp=time.time() * 1000,
            heartRate=sim_hr,
            ibi=[mock_ibi],
            sweat_loss=simulated_sweat_loss,
            sweat_status=0,
            spo2=mock_spo2,
            spo2_status=0,
            skin_temp=mock_skin_temp,
            ambient_temp=mock_ambient_temp,
            accel_x=accel_x,
            accel_y=accel_y,
            accel_z=accel_z,
            accel_magnitude=accel_mag,
            accel_samples=[{"x": accel_x, "y": accel_y, "z": accel_z, "mag": accel_mag}],
            status="simulated"
        )
        await receive_sensor_data(payload)
        t += 0.1
        await asyncio.sleep(0.1)

    print("[SIMULATOR] Synthetic multi-sensor stream stopped.")


if __name__ == "__main__":
    import uvicorn
    print("=" * 65)
    print("  GALAXY WATCH MULTI-MODAL BIOMETRICS SERVER")
    print("  Sensors: Continuous HR & IBI | Sweat Loss | SpO2 | Skin Temp | 3-Axis Accel")
    print("  Dashboard: http://127.0.0.1:8000")
    print("  WebSocket: ws://127.0.0.1:8000/ws")
    print("  Ingestion: POST http://127.0.0.1:8000/sensor-data")
    print("=" * 65)
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
