# NuraSense

> **Two-hour ECG early warning system for Thyrotoxic Periodic Paralysis (TPP)**

---

## 📁 Repository Structure

```
NURASENSE/
├── frontend/                  # Ultra-responsive Vite frontend application
│   ├── index.html             # Semantic entry point with PWA & Google Fonts
│   ├── vite.config.js         # Vite config with /api proxy to backend (port 3000)
│   ├── package.json           # Frontend scripts (dev, build, preview)
│   ├── public/                # Static assets (favicon.svg, manifest.json)
│   ├── src/
│   │   ├── styles/            # Modular CSS architecture
│   │   │   ├── main.css       # Style orchestrator
│   │   │   ├── tokens.css     # Design tokens, CSS variables, typography
│   │   │   ├── header.css     # Sticky header & desktop navigation
│   │   │   ├── hero.css       # Hero cardiac monitor & live risk gauge
│   │   │   ├── sections.css   # Physiology, pipeline tabs, baseline, ML model
│   │   │   ├── dashboard.css  # Full patient monitoring dashboard
│   │   │   ├── dialogs.css    # Accessible modal dialogs & toast
│   │   │   └── responsive.css # Breakpoints (mobile, tablet, desktop, 4K)
│   │   └── scripts/           # Modular ES6+ JavaScript modules
│   │       ├── main.js        # App bootstrap, view router, auth modal
│   │       ├── landing.js     # IntersectionObserver reveals, pipeline tabs, drawer
│   │       ├── dashboard.js   # Telemetry state store, 2h risk calculation engine
│   │       ├── charts.js      # Dynamic SVG charts for Potassium & Autonomic trends
│   │       └── modals.js      # Accessible dialog management & toasts
│   └── index.original.html    # Original monolithic reference
│
├── backend/                   # REST API server for clinical telemetry & models
│   ├── server.js              # Express API server (port 4000)
│   ├── package.json           # Backend dependencies (express, cors)
│   ├── data/
│   │   └── mockStore.js       # In-memory clinical telemetry database
│   └── routes/
│       ├── auth.js            # Patient sign-in and session verification
│       ├── telemetry.js       # Live sensor data, vitals, autonomic trends
│       ├── potassium.js       # Potassium querying & 2.5–7.0 mmol/L logging
│       ├── risk.js            # 2-hour clinical attack probability ML model
│       └── care.js            # Care plan checklist, hydration, alerts, messaging
│
└── package.json               # Root monorepo workspace orchestration
```

---

## 🚀 Quick Start

### 1. Run the Frontend (Vite)
```bash
# From workspace root:
npm run dev:frontend

# Or directly in frontend/:
cd frontend
npm run dev
```
Accessible at: **http://localhost:3000**

### 2. Run the Backend API Server (Express)
```bash
# From workspace root:
npm run dev:backend

# Or directly in backend/:
cd backend
npm start
```
Accessible at: **http://localhost:4000**
Health Check: **http://localhost:4000/api/health**

---

## 📡 Backend API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Server health check and uptime status |
| `POST` | `/api/auth/login` | Patient sign-in and session generation |
| `GET` | `/api/telemetry/vitals` | Live sensor vitals (HR, HRV, QTc, SpO2, Temp, Respiration) |
| `GET` | `/api/telemetry/trends/:range` | Autonomic trends (`24h`, `7d`, `14d`) with clinical annotations |
| `GET` | `/api/potassium` | Current potassium reading & 14-day history array |
| `POST` | `/api/potassium` | Log new reading (validates 2.5–7.0 mmol/L range) |
| `GET` | `/api/risk` | Current 2-hour attack probability and contributing factors |
| `POST` | `/api/risk/evaluate` | Recalculate risk based on dynamic triggers & potassium |
| `GET` | `/api/care/plan` | Daily care plan tasks & hydration progress |
| `POST` | `/api/care/task/:id` | Toggle task completion |
| `POST` | `/api/care/hydration` | Log water intake (+250 ml increments) |
| `GET` | `/api/care/alerts` | Active and acknowledged clinical alerts |
| `POST` | `/api/care/alerts/:id/ack` | Acknowledge clinical alert |
| `POST` | `/api/care/symptoms` | Log symptom check-in (weakness, cramps, severity) |
| `POST` | `/api/care/messages` | Dispatch message to care circle (endocrinologist/partner) |
