import { Router } from 'express';
import { mockStore } from '../data/mockStore.js';

export const careRouter = Router();

// Care plan tasks & hydration
careRouter.get('/plan', (req, res) => {
  return res.json({
    success: true,
    carePlan: mockStore.carePlan
  });
});

careRouter.post('/task/:id', (req, res) => {
  const taskId = req.params.id;
  const task = mockStore.carePlan.tasks.find((t) => t.id === taskId);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  task.completed = req.body.completed !== undefined ? req.body.completed : !task.completed;
  task.tag = task.completed ? "Taken" : "Due";
  return res.json({ success: true, task: task });
});

careRouter.post('/hydration', (req, res) => {
  const increment = req.body.increment || 0.25;
  const current = mockStore.carePlan.hydration.currentLiters;
  const updated = Math.min(2.5, Math.round((current + increment) * 100) / 100);
  mockStore.carePlan.hydration.currentLiters = updated;
  return res.json({
    success: true,
    hydration: mockStore.carePlan.hydration
  });
});

// Alerts
careRouter.get('/alerts', (req, res) => {
  return res.json({
    success: true,
    alerts: mockStore.alerts
  });
});

careRouter.post('/alerts/:id/ack', (req, res) => {
  const alert = mockStore.alerts.find((a) => a.id === req.params.id);
  if (!alert) {
    return res.status(404).json({ error: "Alert not found" });
  }
  alert.status = "done";
  return res.json({ success: true, alert: alert });
});

// Symptoms check-in
careRouter.post('/symptoms', (req, res) => {
  const { type, severity, notes } = req.body;
  if (!type) {
    return res.status(400).json({ error: "Symptom type is required" });
  }

  const logEntry = {
    id: "sym_" + Date.now(),
    type,
    severity: Number(severity) || 1,
    notes: notes || '',
    timestamp: new Date().toISOString()
  };

  if (type !== 'No symptoms') {
    mockStore.alerts.unshift({
      id: "a_" + Date.now(),
      time: "Today · " + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      title: "Symptom check-in",
      detail: `${type} · severity ${severity}/5`,
      score: "—",
      status: "open",
      level: severity >= 4 ? "severe" : "elevated"
    });
  }

  return res.status(201).json({
    success: true,
    message: "Symptom check-in logged",
    entry: logEntry
  });
});

// Care circle contacts & direct messages
careRouter.get('/circle', (req, res) => {
  return res.json({
    success: true,
    careCircle: mockStore.careCircle
  });
});

careRouter.post('/messages', (req, res) => {
  const { recipient, text, urgency } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Message content cannot be empty." });
  }

  const message = {
    id: "msg_" + Date.now(),
    recipient: recipient || "Dr. Sarah Lin",
    text: text.trim(),
    urgency: urgency || "normal",
    sentAt: new Date().toISOString()
  };
  mockStore.messages.push(message);

  return res.status(201).json({
    success: true,
    message: `Message dispatched to ${message.recipient}`,
    dispatchedMessage: message
  });
});
