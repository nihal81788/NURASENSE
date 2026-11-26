import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoEcg } from '../src/scripts/demoEcg.js';

const FS = 250;

/* Deterministic pseudo-random source so failures are repeatable */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* Sample index and height of every R peak */
function rPeaks(samples) {
  const peaks = [];
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i] > 0.7 && samples[i] > samples[i - 1] && samples[i] >= samples[i + 1]) {
      if (peaks.length && i - peaks[peaks.length - 1].i < FS * 0.3) continue;
      peaks.push({ i, v: samples[i] });
    }
  }
  return peaks;
}

test('returns the requested number of finite samples', () => {
  const ecg = createDemoEcg({ random: seeded() });
  const batch = ecg.next(75);
  assert.equal(batch.length, 75);
  assert.ok(batch.every(Number.isFinite));
});

test('bpm stays within 80-95 and changes over ten minutes', () => {
  for (const seed of [1, 7, 42, 999]) {
    const ecg = createDemoEcg({ random: seeded(seed) });
    const seen = new Set();
    for (let s = 0; s < 600; s++) {
      ecg.next(FS);
      const bpm = ecg.bpm();
      assert.ok(bpm >= 80 && bpm <= 95, `bpm ${bpm} out of range`);
      seen.add(bpm);
    }
    assert.ok(seen.size >= 5, `only ${seen.size} distinct values`);
  }
});

test('extreme random sources still keep bpm in range', () => {
  for (const random of [() => 0, () => 0.999999]) {
    const ecg = createDemoEcg({ random });
    for (let s = 0; s < 120; s++) {
      ecg.next(FS);
      assert.ok(ecg.bpm() >= 80 && ecg.bpm() <= 95);
    }
  }
});

test('beat spacing and height vary, at a rate matching 80-95 bpm', () => {
  const ecg = createDemoEcg({ random: seeded(3) });
  const peaks = rPeaks(ecg.next(FS * 60));
  assert.ok(peaks.length >= 78 && peaks.length <= 97, `${peaks.length} beats in 60 s`);
  const gaps = peaks.slice(1).map((p, k) => p.i - peaks[k].i);
  assert.ok(new Set(gaps).size >= 5, 'beat spacing is constant');
  assert.ok(new Set(peaks.map(p => p.v.toFixed(2))).size >= 5, 'beat height is constant');
});

test('output does not depend on batch size', () => {
  const a = createDemoEcg({ random: () => 0.5 });
  const b = createDemoEcg({ random: () => 0.5 });
  const whole = a.next(1000);
  const pieces = [];
  for (let k = 0; k < 40; k++) pieces.push(...b.next(25));
  assert.deepEqual(pieces, whole);
});
