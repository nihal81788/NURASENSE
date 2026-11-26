/**
 * Simulated Lead I ECG for the dashboard's Demo mode.
 * Output is NOT sensor data: it is for display only and must be labelled "Simulated".
 * Amplitude units match the server's filtered samples (R peak about 1).
 */

const MIN_BPM = 80;
const MAX_BPM = 95;

/* [height, centre, width] of each wave, as fractions of one beat */
const WAVES = [
  [0.12, 0.16, 0.026],   // P
  [-0.09, 0.35, 0.010],  // Q
  [1.08, 0.385, 0.011],  // R
  [-0.22, 0.42, 0.012],  // S
  [0.28, 0.62, 0.045]    // T
];

export function createDemoEcg({ fs = 250, random = Math.random } = {}) {
  const between = (lo, hi) => lo + random() * (hi - lo);
  const clamp = v => Math.max(MIN_BPM, Math.min(MAX_BPM, v));

  let rate = between(MIN_BPM, MAX_BPM);
  let target = between(MIN_BPM, MAX_BPM);
  let time = 0;
  let beat = newBeat();
  let position = 0; // samples into the current beat

  function newBeat() {
    // Heart rate wanders toward a target that is replaced once reached
    if (Math.abs(target - rate) < 0.5) target = between(MIN_BPM, MAX_BPM);
    rate = clamp(rate + Math.max(-1.2, Math.min(1.2, target - rate)));
    return {
      length: Math.round((fs * 60 / rate) * between(0.96, 1.04)),
      gain: between(0.88, 1.12),
      tGain: between(0.85, 1.15)
    };
  }

  function sample() {
    if (position >= beat.length) {
      beat = newBeat();
      position = 0;
    }
    const phase = position / beat.length;
    let value = 0;
    for (let i = 0; i < WAVES.length; i++) {
      const [height, centre, width] = WAVES[i];
      const scale = i === WAVES.length - 1 ? beat.tGain : beat.gain;
      value += height * scale * Math.exp(-((phase - centre) ** 2) / (2 * width ** 2));
    }
    // Breathing-like baseline drift and fine sensor-like noise
    value += 0.03 * Math.sin(2 * Math.PI * 0.25 * time) + between(-0.012, 0.012);
    position += 1;
    time += 1 / fs;
    return value;
  }

  return {
    next: count => Array.from({ length: count }, sample),
    bpm: () => Math.round(rate)
  };
}
