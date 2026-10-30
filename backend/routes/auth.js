import { Router } from 'express';
import { mockStore } from '../data/mockStore.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email address is required." });
  }

  // Simulated authentication
  const isDemo = email.toLowerCase() === 'patient@nurasense.app';
  const name = isDemo ? mockStore.patient.name : email.split('@')[0].replace(/[._-]+/g, ' ');

  return res.json({
    success: true,
    token: "demo_jwt_token_" + Date.now(),
    user: {
      id: isDemo ? mockStore.patient.id : "usr_" + Math.random().toString(36).substring(7),
      name: name,
      email: email,
      role: "patient"
    }
  });
});

authRouter.get('/me', (req, res) => {
  return res.json({
    success: true,
    patient: mockStore.patient
  });
});
