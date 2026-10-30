import { Router } from 'express';
import { mockStore } from '../data/mockStore.js';

export const riskRouter = Router();

const TRIGGER_WEIGHTS = [
  { key: 'meal', label: 'High-carb meal', pts: 8 },
  { key: 'sleep', label: 'Short sleep', pts: 6 },
  { key: 'dose', label: 'Missed dose', pts: 7 },
  { key: 'cold', label: 'Cold exposure', pts: 4 },
  { key: 'exercise', label: 'Hard exercise', pts: 5 }
];

function calculateRisk(triggers, potassium, hrv, symptomPenalty, symptomLabel) {
  const factors = [];

  // Potassium impact
  if (potassium < 3.5) {
    const kPts = potassium < 3.2 ? 18 : potassium < 3.4 ? 14 : 10;
    factors.push({ label: `Potassium ${potassium.toFixed(1)} mmol/L`, pts: kPts });
  }

  // Active lifestyle/metabolic triggers
  TRIGGER_WEIGHTS.forEach((t) => {
    if (triggers && triggers[t.key]) {
      factors.push({ label: t.label, pts: t.pts });
    }
  });

  // Autonomic shift (low HRV)
  if (hrv < 35) {
    factors.push({ label: `HRV ${hrv} ms`, pts: 5 });
  }

  // Active symptoms
  if (symptomPenalty && symptomPenalty > 0) {
    factors.push({ label: symptomLabel || 'Active symptoms', pts: symptomPenalty });
  }

  let total = 17; // Clinical base autonomic risk
  factors.forEach((f) => { total += f.pts; });
  total = Math.max(4, Math.min(94, total));

  let levelKey = 'low';
  let levelLabel = 'Low risk';
  if (total >= 75) {
    levelKey = 'severe';
    levelLabel = 'High risk';
  } else if (total >= 50) {
    levelKey = 'elevated';
    levelLabel = 'Elevated';
  } else if (total >= 25) {
    levelKey = 'watch';
    levelLabel = 'Watch';
  }

  return {
    attackProbabilityPct: total,
    level: {
      key: levelKey,
      label: levelLabel
    },
    factors: factors,
    confidencePct: 86,
    windowHorizon: "2 hours"
  };
}

riskRouter.get('/', (req, res) => {
  const result = calculateRisk(
    mockStore.triggers,
    mockStore.potassium.current,
    mockStore.vitals.hrvRmssd,
    0,
    ''
  );
  return res.json({ success: true, ...result });
});

riskRouter.post('/evaluate', (req, res) => {
  const { triggers, potassium, hrv, symptomPenalty, symptomLabel } = req.body;
  
  if (triggers) {
    mockStore.triggers = { ...mockStore.triggers, ...triggers };
  }

  const kVal = potassium !== undefined ? parseFloat(potassium) : mockStore.potassium.current;
  const hrvVal = hrv !== undefined ? parseFloat(hrv) : mockStore.vitals.hrvRmssd;

  const result = calculateRisk(
    mockStore.triggers,
    kVal,
    hrvVal,
    symptomPenalty,
    symptomLabel
  );

  return res.json({ success: true, ...result });
});
