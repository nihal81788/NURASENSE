# Samsung Galaxy Watch (Wear OS 4+ / Galaxy Watch FE) Real-Time Biometrics Telemetry

A high-performance standalone module for continuous Heart Rate (BPM), Inter-Beat Intervals (IBI), Clinical RMSSD (HRV), and 500 Hz Raw ECG streaming from a Samsung Galaxy Watch (Wear OS 4+, including Galaxy Watch FE) to a local FastAPI backend and HTML5 real-time oscilloscope dashboard.

---

## 1. System Architecture

```
[ Galaxy Watch FE (Wear OS 4+) ]
  │
  ├── Samsung Health Tracking Service (com.samsung.android.service.health)
  │    ├── HEART_RATE_CONTINUOUS  (BPM + IBI list)
  │    └── ECG_ON_DEMAND          (500 Hz raw mV samples + Lead Off)
  │
  └── OkHttp 4 Client (Asynchronous HTTP POST)
       │
       ▼ [ADB Reverse Tunnel: tcp:8000 -> tcp:8000]
       │
[ Host PC - FastAPI Server (server.py) ]
  │  ├── POST /sensor-data  (Rolling IBI Window -> Clinical RMSSD)
  │  └── Persistent WebSocket (/ws)
  │
  ▼
[ Real-Time Oscilloscope Dashboard (index.html) ]
     ├── Dark-mode medical telemetry cards (Live BPM, RMSSD, IBI)
     ├── HTML5 Canvas 60 FPS Phosphor ECG Oscilloscope (500 Hz, Ring Buffer)
     └── Dynamic Lead-Off / Electrode Placement Warning
```

---

## 2. Samsung Health Sensor SDK v1.4.1 Specifics

This project utilizes the official **Samsung Health Sensor API v1.4.1** (`samsung-health-sensor-api-1.4.1.aar`) placed in `SAMSUNG_WATCH/app/libs/`.

Key implementation details:
- **Service Connection:** Uses the standalone interface `com.samsung.android.service.health.tracking.ConnectionListener` (not an inner interface).
- **Service Binder:** Bound to `com.samsung.android.service.health`.
- **Target Metrics & Value Keys:**
  - `HealthTrackerType.HEART_RATE_CONTINUOUS`:
    - `ValueKey.HeartRateSet.HEART_RATE` (`Integer`)
    - `ValueKey.HeartRateSet.IBI_LIST` (`List<Integer>`)
    - `ValueKey.HeartRateSet.HEART_RATE_STATUS` (`Integer`)
  - `HealthTrackerType.ECG_ON_DEMAND`:
    - `ValueKey.EcgSet.ECG_MV` (`Float`, 500 Hz raw voltage in millivolts)
    - `ValueKey.EcgSet.LEAD_OFF` (`Integer`: `0` = Lead Attached, `1` = Lead Off / finger removed)
    - Batched in chunks (~50 samples per callback) to optimize battery and wireless network bandwidth.

---

## 3. Clinical RMSSD (HRV) Calculation

The backend maintains a rolling window of recent inter-beat intervals (filtered between 300 ms and 2000 ms to eliminate ectopic artifacts) and calculates clinical **RMSSD** (Root Mean Square of Successive Differences):

$$\text{RMSSD} = \sqrt{\frac{1}{N-1} \sum_{i=1}^{N-1} (IBI_{i+1} - IBI_i)^2}$$

### Clinical Interpretation:
- **> 50 ms:** High parasympathetic (vagal) tone, rested state, cardiovascular resilience.
- **30 – 50 ms:** Normal baseline physiological range for healthy adults.
- **< 30 ms:** Sympathetic dominance, acute physiological/mental stress, physical fatigue, or overtraining.

---

## 4. Directory Structure

```
SAMSUNG_WATCH/
├── app/
│   ├── libs/
│   │   └── samsung-health-sensor-api-1.4.1.aar   # Samsung Health Sensor SDK
│   ├── src/main/
│   │   ├── AndroidManifest.xml                  # Watch permissions, queries & cleartext config
│   │   ├── java/com/example/watchstream/
│   │   │   └── MainActivity.kt                  # Wear OS telemetry client
│   │   └── res/
│   │       ├── layout/activity_main.xml         # Wear OS circular UI
│   │       └── xml/network_security_config.xml  # Cleartext HTTP loopback permissions
│   └── build.gradle.kts                         # App build configuration (SDK 34, JVM 17)
├── gradle/wrapper/                              # Gradle 8.4 Wrapper
├── build.gradle.kts                             # Root build configuration
├── settings.gradle.kts                          # Module definitions & repositories
├── local.properties                             # Android SDK path configuration
├── server.py                                    # FastAPI server + WebSocket + RMSSD engine
├── index.html                                   # Dark-mode 60 FPS HTML5 Canvas dashboard
├── requirements.txt                             # Python dependencies
├── deploy.ps1                                   # Automated build, reverse tunnel & deploy script
├── start_server.ps1                             # Launches FastAPI & opens dashboard
├── test_stream.py                               # Mock 500 Hz ECG generator for offline testing
└── README.md                                    # Documentation
```

---

## 5. Quick Start & Execution Guide

### Prerequisites
1. **Host PC:**
   - Python 3.9+ (`pip install -r requirements.txt`)
   - Android SDK (API 34) and Java 17 (JDK 17)
   - ADB (`adb.exe` in PATH)
2. **Watch (Samsung Galaxy Watch FE / Wear OS 4):**
   - Enable **Developer options**: `Settings -> About watch -> Software info -> Tap "Software version" 7 times`.
   - In `Settings -> Developer options`:
     - Enable **ADB debugging**.
     - Enable **Wireless debugging** (note IP and port).

### Step 1: Install Python Dependencies
```powershell
cd SAMSUNG_WATCH
pip install -r requirements.txt
```

### Step 2: Connect Watch via ADB
Pair and connect your watch over Wi-Fi (or USB charging dock):
```powershell
# Pair (first time only)
adb pair <WATCH_IP>:<PAIRING_PORT>

# Connect
adb connect <WATCH_IP>:<DEBUG_PORT>

# Verify connection
adb devices
```

### Step 3: Automated Build & Deploy
Run the PowerShell deployment automation:
```powershell
.\deploy.ps1
```
This script will:
1. Compile the Wear OS application (`gradlew assembleDebug`).
2. Establish the ADB reverse port forward:
   ```powershell
   adb reverse tcp:8000 tcp:8000
   ```
3. Install `app-debug.apk` onto the Galaxy Watch.
4. Automatically grant `android.permission.BODY_SENSORS`.
5. Launch `MainActivity` on the watch.

### Step 4: Start Telemetry Server & Dashboard
In a separate terminal:
```powershell
.\start_server.ps1
```
- Server endpoint: `http://127.0.0.1:8000`
- Dashboard UI: `http://127.0.0.1:8000`
- WebSocket feed: `ws://127.0.0.1:8000/ws`
- Telemetry ingestion: `POST http://127.0.0.1:8000/sensor-data`

---

## 6. How to Use on Galaxy Watch FE

1. Open the **Galaxy Stream** app on the watch.
2. Tap **"Start HR Stream"**:
   - The green optical PPG sensor engages.
   - Live BPM and IBI values update on the watch display and stream continuously to the dashboard.
3. Tap **"Start ECG (500Hz)"**:
   - Lightly place your index finger onto the **top electrode / button** of the Galaxy Watch.
   - When contact is made (`Lead Attached`), the watch streams raw 500 Hz mV signals.
   - The dashboard oscilloscope immediately renders the real-time PQRST trace.

---

## 7. Testing Without Watch (Offline Simulator)

You can preview and verify the entire ingestion pipeline, RMSSD calculations, and 60 FPS HTML5 canvas oscilloscope even without the physical watch connected:

### Method A: Web UI Toggle
1. Start the server: `python server.py`.
2. Open `http://localhost:8000` in your browser.
3. Click the **"Start Test Simulation"** button in the top right.

### Method B: Standalone Python Driver
```powershell
python test_stream.py
```
This feeds 500 Hz synthetic clinical ECG pulses and sinus arrhythmia IBIs directly to `http://127.0.0.1:8000/sensor-data`.

