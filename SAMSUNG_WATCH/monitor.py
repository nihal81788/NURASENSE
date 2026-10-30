"""
NuraSense Galaxy Watch FE - Terminal Telemetry Monitor
Connects to ws://127.0.0.1:8000/ws and renders a live, colorized
terminal telemetry dashboard for all biometric data streams.
"""
import asyncio
import json
import os
import sys
import time

WS_URL = "ws://127.0.0.1:8000/ws"

# ANSI Color Codes
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BLUE = "\033[94m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"
CLEAR = "\033[2J\033[H"

async def run_terminal_monitor():
    try:
        import websockets
    except ImportError:
        print("[!] websockets library required. Install with: pip install websockets")
        return

    print(f"{CYAN}[*] Connecting to Galaxy Watch Stream at {WS_URL}...{RESET}")

    while True:
        try:
            async with websockets.connect(WS_URL) as ws:
                print(f"{GREEN}[✓] Connected to Galaxy Watch Telemetry stream!{RESET}")
                time.sleep(0.5)

                packet_count = 0
                ecg_total_points = 0

                async for message in ws:
                    try:
                        data = json.loads(message)
                    except Exception:
                        continue

                    if data.get("type") in ("ping", "pong", "heartbeat"):
                        continue

                    packet_count += 1

                    # Extract metrics
                    hr = data.get("heartRate")
                    rmssd = data.get("rmssd")
                    latest_ibi = data.get("latestIbi")
                    sweat_loss = data.get("sweat_loss")
                    sweat_status = data.get("sweat_status")
                    spo2 = data.get("spo2")
                    skin_temp = data.get("skin_temp")
                    ambient_temp = data.get("ambient_temp")
                    accel = data.get("accel") or {}

                    # Clear screen and render dashboard
                    sys.stdout.write(CLEAR)
                    sys.stdout.write(f"{BOLD}{CYAN}========================================================================{RESET}\n")
                    sys.stdout.write(f"{BOLD}{GREEN}       NURASENSE — SAMSUNG GALAXY WATCH FE LIVE TELEMETRY{RESET}\n")
                    sys.stdout.write(f"{BOLD}{CYAN}========================================================================{RESET}\n")
                    sys.stdout.write(f" Device    : {BOLD}Samsung Galaxy Watch FE (Wear OS 4){RESET}\n")
                    sys.stdout.write(f" Transport : {BOLD}Direct Wi-Fi / ADB -> http://127.0.0.1:8000{RESET}\n")
                    sys.stdout.write(f" Stream    : {GREEN}● LIVE{RESET} (Packets: {packet_count:,})\n")
                    sys.stdout.write(f" Timestamp : {DIM}{time.strftime('%Y-%m-%d %H:%M:%S')}{RESET}\n")
                    sys.stdout.write(f"{CYAN}------------------------------------------------------------------------{RESET}\n")
                    sys.stdout.write(f"{BOLD} BIOMETRIC SENSOR READINGS:{RESET}\n")
                    sys.stdout.write(f"{CYAN}------------------------------------------------------------------------{RESET}\n\n")

                    # Row 1: Heart Rate & RMSSD
                    hr_display = f"{RED}{BOLD}{hr} BPM{RESET}" if hr else f"{DIM}-- BPM{RESET}"
                    rmssd_display = f"{CYAN}{BOLD}{rmssd} ms{RESET}" if rmssd else f"{DIM}-- ms{RESET}"
                    ibi_display = f"{MAGENTA}{BOLD}{latest_ibi} ms{RESET}" if latest_ibi else f"{DIM}-- ms{RESET}"

                    sys.stdout.write(f"  [1] Heart Rate (PPG)   : {hr_display:<20} | Status: Resting\n")
                    sys.stdout.write(f"  [2] RMSSD (HRV)        : {rmssd_display:<20} | Vagal Autonomic Tone\n")
                    sys.stdout.write(f"  [3] Latest IBI (RR)    : {ibi_display:<20} | Inter-Beat Interval\n\n")

                    # Row 2: Sweat Loss & Blood Oxygen
                    sweat_display = f"{CYAN}{BOLD}{sweat_loss} mL{RESET}" if sweat_loss is not None else f"{DIM}-- mL{RESET}"
                    status_text = "Running Workout Active" if sweat_status == 0 else "Workout Monitor Ready"
                    spo2_display = f"{BLUE}{BOLD}{spo2} %{RESET}" if spo2 else f"{DIM}-- %{RESET}"

                    sys.stdout.write(f"  [4] Sweat Loss (Water) : {sweat_display:<20} | {status_text}\n")
                    sys.stdout.write(f"  [5] Blood Oxygen (SpO2): {spo2_display:<20} | Arterial Saturation\n\n")

                    # Row 3: Skin Temperature & 3-Axis Accel
                    skin_temp_display = f"{YELLOW}{BOLD}{skin_temp} °C{RESET}" if skin_temp else f"{DIM}-- °C{RESET}"
                    ambient_temp_display = f"{DIM}{ambient_temp} °C{RESET}" if ambient_temp else f"{DIM}-- °C{RESET}"

                    mag = accel.get("magnitude", 0.0)
                    tremor_rms = accel.get("tremor_rms", 0.0)
                    ax = accel.get("x", 0)
                    ay = accel.get("y", 0)
                    az = accel.get("z", 0)

                    tremor_status = f"{GREEN}Stationary{RESET}"
                    if tremor_rms > 1.2:
                        tremor_status = f"{RED}{BOLD}High Tremor!{RESET}"
                    elif tremor_rms > 0.4:
                        tremor_status = f"{YELLOW}Micro-Tremor{RESET}"

                    sys.stdout.write(f"  [6] Skin Temperature  : {skin_temp_display:<20} | Ambient: {ambient_temp_display}\n")
                    sys.stdout.write(f"  [7] 3-Axis Motion/IMU  : {GREEN}|a| = {mag} m/s²{RESET} (X:{ax} Y:{ay} Z:{az})\n")
                    sys.stdout.write(f"      Neuromuscular Tremor: {tremor_status} (RMS Index: {tremor_rms})\n\n")

                    sys.stdout.write(f"{CYAN}========================================================================{RESET}\n")
                    sys.stdout.write(f"{DIM}Web Dashboard: http://localhost:8000 | NuraSense App: http://localhost:3000{RESET}\n")
                    sys.stdout.write(f"{DIM}Press Ctrl+C to exit monitor.{RESET}\n")
                    sys.stdout.flush()

        except Exception as e:
            print(f"{YELLOW}[!] WebSocket reconnecting in 2s ({e})...{RESET}")
            await asyncio.sleep(2.0)

if __name__ == "__main__":
    try:
        asyncio.run(run_terminal_monitor())
    except KeyboardInterrupt:
        print("\n[*] Terminal monitor stopped.")

