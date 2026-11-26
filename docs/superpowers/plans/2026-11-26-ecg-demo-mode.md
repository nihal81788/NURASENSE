# ECG Demo Mode Implementation Plan

**Goal:** Offline with no graph when the ESP32 is silent; a labelled, varying 80–95 bpm demo trace while it sends data.

**Spec:** `docs/superpowers/specs/2026-11-26-ecg-demo-mode-design.md`

## Global Constraints
- Generated values stay in the browser: never write them to `.vital-hr-val`, `dashState`, the server or the WebSocket.
- Label text: "Simulated". BPM range: 80–95. Silence timeout: 2 s.
- No new dependencies. Commit only when the user says.

## Review Focus
- Switching Demo -> real mode must not leave generated samples on screen.
- Paused graph while the device goes silent must still blank.
- WebSocket open with a silent ESP32 must read "Device offline".

## Task 1: Generator
Files: create `frontend/src/scripts/demoEcg.js`, `frontend/tests/demoEcg.test.mjs`.
Produces: `createDemoEcg({ fs = 250, random = Math.random }) -> { next(count): number[], bpm(): number }`.
- [ ] Failing tests: length, finite values, BPM in 80–95 and changing, beat spacing varies, peak height varies
- [ ] Implement; `npm test` passes

## Task 2: Dashboard
Files: modify `frontend/src/scripts/dashboard.js` (`initCloudEcgMonitor`), `frontend/index.html`.
- [ ] Demo button, BPM tile (`liveEcgBpm`, `liveEcgStatus`), offline initial markup
- [ ] Demo branch in `onmessage`; clear buffer on mode switch and on silence
- [ ] Blank grid when not receiving; "Simulated" drawn on canvas
- [ ] `npm run build`; drive in browser with a local fake WebSocket feed
