import { Router } from 'express';
import { mockStore } from '../data/mockStore.js';

export const potassiumRouter = Router();

potassiumRouter.get('/', (req, res) => {
  return res.json({
    success: true,
    data: mockStore.potassium
  });
});

potassiumRouter.post('/', (req, res) => {
  const { value, time } = req.body;
  const numVal = parseFloat(value);

  if (isNaN(numVal) || numVal < 2.5 || numVal > 7.0) {
    return res.status(400).json({
      error: "Potassium reading must be a valid number between 2.5 and 7.0 mmol/L."
    });
  }

  const rounded = Math.round(numVal * 10) / 10;
  const logTime = time || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  mockStore.potassium.current = rounded;
  mockStore.potassium.lastLogged = logTime;
  mockStore.potassium.history.push(rounded);
  if (mockStore.potassium.history.length > 14) {
    mockStore.potassium.history.shift();
  }

  const newReading = {
    id: "k_" + Date.now(),
    when: "Today · " + logTime,
    value: rounded,
    status: rounded < 3.5 ? "low" : rounded > 5.1 ? "high" : "normal"
  };
  mockStore.potassium.readings.unshift(newReading);

  return res.status(201).json({
    success: true,
    message: "Potassium reading logged successfully",
    reading: newReading,
    current: mockStore.potassium
  });
});
