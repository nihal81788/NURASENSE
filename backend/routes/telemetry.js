import { Router } from 'express';
import { mockStore } from '../data/mockStore.js';

export const telemetryRouter = Router();

telemetryRouter.get('/vitals', (req, res) => {
  return res.json({
    success: true,
    sensor: mockStore.patient.sensor,
    vitals: mockStore.vitals,
    timestamp: new Date().toISOString()
  });
});

// Ingest live watch telemetry from Galaxy Watch FE
telemetryRouter.post('/watch-data', (req, res) => {
  const { heartRate, rmssd, spo2, skin_temp, skinTemp, sweatLoss } = req.body;
  if (heartRate && heartRate > 0) mockStore.vitals.heartRate = heartRate;
  if (rmssd && rmssd > 0) mockStore.vitals.hrvRmssd = Math.round(rmssd);
  if (spo2 && spo2 > 0) mockStore.vitals.spo2 = spo2;
  const temp = skin_temp || skinTemp;
  if (temp && temp > 0) mockStore.vitals.skinTemperature = temp;
  if (sweatLoss !== undefined && sweatLoss !== null) mockStore.vitals.sweatLoss = sweatLoss;
  
  mockStore.patient.sensor.type = "Samsung Galaxy Watch FE (Wear OS 4)";
  mockStore.patient.sensor.lead = "Optical PPG + Multi-Modal IMU";
  mockStore.patient.sensor.signalQuality = 100;
  mockStore.patient.sensor.lastSync = new Date().toISOString();
  
  return res.json({ success: true, vitals: mockStore.vitals });
});

telemetryRouter.get('/trends/:range', (req, res) => {
  const range = req.params.range || '24h';
  const trendsData = {
    '24h': {
      hr: [82, 79, 76, 74, 72, 71, 73, 78, 84, 88, 86, 84, 86],
      hrv: [36, 38, 40, 43, 45, 44, 42, 38, 33, 30, 31, 32, 31],
      ticks: ['00:00', '08:00', '16:00', 'Now'],
      events: [
        { index: 2, label: 'Risk alert' },
        { index: 9, label: 'High-carb meal' }
      ],
      annotation: 'Events: high-carb meal 19:40 · risk alert 04:12'
    },
    '7d': {
      hr: [84, 82, 79, 85, 88, 86, 87],
      hrv: [32, 34, 36, 33, 30, 31, 31],
      ticks: ['Mon', 'Wed', 'Fri', 'Sun'],
      events: [],
      annotation: 'Weekly view · your baseline is 84–90 bpm'
    },
    '14d': {
      hr: [83, 82, 84, 81, 79, 82, 85, 87, 86, 84, 83, 85, 87, 86],
      hrv: [34, 33, 35, 32, 30, 31, 33, 32, 30, 29, 30, 31, 32, 31],
      ticks: ['11 Oct', '15 Oct', '19 Oct', 'Today'],
      events: [],
      annotation: 'Two-week view · potassium readings are trending low'
    }
  };

  const selected = trendsData[range] || trendsData['24h'];
  return res.json({
    success: true,
    range: range,
    data: selected
  });
});
