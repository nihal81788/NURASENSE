import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { telemetryRouter } from './routes/telemetry.js';
import { potassiumRouter } from './routes/potassium.js';
import { riskRouter } from './routes/risk.js';
import { careRouter } from './routes/care.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'NuraSense Clinical Telemetry Engine',
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// Mount modular API routers
app.use('/api/auth', authRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/potassium', potassiumRouter);
app.use('/api/risk', riskRouter);
app.use('/api/care', careRouter);

// Global 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

app.listen(PORT, () => {
  console.log(`\n🏥 NuraSense Backend Server running on http://localhost:${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/api/health\n`);
});
