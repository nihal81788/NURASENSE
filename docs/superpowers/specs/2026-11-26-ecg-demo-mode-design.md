# Live ECG demo mode (approved 2026-11-26)

**Intent:** show a varying ECG on the dashboard only while the ESP32 is sending data; otherwise show the device as offline with no graph.

**Approaches**
- Frontend-only Demo mode (picked): generated values never leave the browser.
- Server-side generator (rejected): generated values would reach potassium prediction and alerts.
- Replace real plotting with generated data, unlabelled (rejected): invented heart data would look like a patient's real reading.

**Design**
- A "Demo" button beside Filtered and Raw ADC.
- In Demo, incoming ESP32 batches drive a generated trace with varying beat spacing and height, noise and baseline drift.
- BPM tile on the live card; in Demo it drifts within 80–95.
- After 2 s without data (any mode): empty grid, BPM `--`, "Device offline".
- Graph and BPM show a visible "Simulated" label in Demo.

**Non-goals:** no change to the server, potassium prediction, alerts or saved records by generated values. Real data handling in Filtered and Raw ADC is unchanged.

**Left to the builder:** waveform parameters and drift rate.
