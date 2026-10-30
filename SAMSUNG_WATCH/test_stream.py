"""
Multi-modal test script to simulate Galaxy Watch biometrics:
- Continuous Heart Rate & IBI (with RMSSD calculation)
- Sweat Loss (Water Loss after running workout)
- Blood Oxygen (SpO2)
- Wrist Skin Temperature & Ambient Temperature
- 3-Axis Accelerometer (X, Y, Z & Tremor tracking)
"""
import math
import time
import requests

SERVER_URL = "http://127.0.0.1:8000/sensor-data"

def run_test_stream(duration_seconds=10):
    print(f"[*] Streaming multi-modal biometrics with Sweat Loss to {SERVER_URL} for {duration_seconds}s...")
    t = 0.0
    bpm = 83
    start_time = time.time()
    batch_count = 0
    sweat_loss = 40.0

    while time.time() - start_time < duration_seconds:
        ibi_ms = int(722 + 25 * math.sin(t * 0.7))

        # 3-Axis Accel with micro-tremor oscillation
        accel_x = round(15.0 * math.sin(t * 8.0), 1)
        accel_y = round(-40.0 + 10.0 * math.cos(t * 7.0), 1)
        accel_z = round(980.0 + 20.0 * math.sin(t * 9.0), 1)
        accel_mag = round(math.sqrt(accel_x**2 + accel_y**2 + accel_z**2) / 100.0, 2)

        # SpO2, Skin Temp & Sweat Loss
        skin_temp = round(34.1 + 0.1 * math.sin(t * 0.2), 1)
        ambient_temp = 24.3
        spo2 = 98 if (batch_count % 30 < 25) else 99
        sweat_loss = round(sweat_loss + 0.5, 1)

        payload = {
            "type": "multi_stream",
            "timestamp": int(time.time() * 1000),
            "heartRate": bpm,
            "ibi": [ibi_ms],
            "sweat_loss": sweat_loss,
            "sweat_status": 0,
            "spo2": spo2,
            "spo2_status": 0,
            "skin_temp": skin_temp,
            "ambient_temp": ambient_temp,
            "accel_x": accel_x,
            "accel_y": accel_y,
            "accel_z": accel_z,
            "accel_magnitude": accel_mag,
            "accel_samples": [{"x": accel_x, "y": accel_y, "z": accel_z, "mag": accel_mag}],
            "status": "active"
        }

        try:
            res = requests.post(SERVER_URL, json=payload, timeout=2.0)
            if res.status_code == 200:
                batch_count += 1
                resp_json = res.json()
                print(f"[+] #{batch_count:02d} | HR: {bpm} | RMSSD: {resp_json.get('rmssd')} ms | Sweat Loss: {sweat_loss} mL | SpO2: {spo2}% | Temp: {skin_temp}°C")
            else:
                print(f"[-] Server error {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[!] Request error: {e}")
            break

        time.sleep(0.1)
        t += 0.1

    print("[*] Multi-modal stream test finished.")

if __name__ == "__main__":
    run_test_stream()
