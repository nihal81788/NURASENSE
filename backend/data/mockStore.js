/**
 * NuraSense — In-Memory Clinical Store
 * Simulates clinical database for patient telemetry, baseline, potassium, and alerts
 */

export const mockStore = {
  patient: {
    id: "pat_94821",
    name: "Maya Roberts",
    firstName: "Maya",
    email: "patient@nurasense.app",
    role: "patient",
    baseline: {
      restingHeartRate: { min: 84, max: 90, unit: "bpm" },
      medianHrv: { value: 42, unit: "ms" },
      normalQtc: { value: 420, unit: "ms" },
      targetPotassium: { min: 3.5, max: 5.1, unit: "mmol/L" }
    },
    sensor: {
      type: "Single-Lead ECG Patch",
      lead: "Lead I (Chest)",
      batteryLevel: 86,
      signalQuality: 98,
      lastSync: new Date().toISOString()
    }
  },

  vitals: {
    heartRate: 86,
    hrvRmssd: 31,
    qtc: 458,
    lfHfRatio: 3.4,
    spo2: 97,
    respirationRate: 15,
    skinTemperature: 36.7,
    sleepHours: 5.2,
    weightKg: 64.2
  },

  potassium: {
    current: 3.3,
    lastLogged: "04:12",
    history: [3.9, 3.8, 3.7, 3.8, 3.6, 3.5, 3.6, 3.5, 3.4, 3.5, 3.4, 3.2, 3.3, 3.3],
    readings: [
      { id: "k_1", when: "24 Oct · 04:12", value: 3.3, status: "low" },
      { id: "k_2", when: "23 Oct · 08:05", value: 3.6, status: "normal" },
      { id: "k_3", when: "21 Oct · 09:10", value: 3.8, status: "normal" }
    ]
  },

  triggers: {
    meal: true,       // High-carb meal (+8 pts)
    sleep: true,      // Short sleep (+6 pts)
    dose: false,      // Missed dose (+7 pts)
    cold: false,      // Cold exposure (+4 pts)
    exercise: false   // Hard exercise (+5 pts)
  },

  carePlan: {
    tasks: [
      { id: "task_k", title: "Potassium supplement taken with dinner", time: "20:00", completed: false, tag: "Due" },
      { id: "task_dose", title: "Evening anti-thyroid dose", time: "21:30", completed: false, tag: "Due" }
    ],
    hydration: {
      currentLiters: 1.4,
      targetLiters: 2.5
    }
  },

  alerts: [
    {
      id: "a1",
      time: "24 Oct · 04:12",
      title: "Elevated risk",
      detail: "Alert sent to care circle",
      score: "62%",
      status: "open",
      level: "elevated"
    },
    {
      id: "a2",
      time: "22 Oct · 03:20",
      title: "Watch",
      detail: "Monitoring, no alert raised",
      score: "41%",
      status: "done",
      level: "watch"
    },
    {
      id: "a3",
      time: "18 Oct · 23:40",
      title: "Elevated risk",
      detail: "Alert sent to care circle",
      score: "57%",
      status: "done",
      level: "elevated"
    }
  ],

  careCircle: [
    { id: "c1", name: "Dr. Sarah Lin", role: "Primary Endocrinologist", phone: "+1 (555) 234-5678", email: "slin@metabolic.health" },
    { id: "c2", name: "David Roberts", role: "Partner / Emergency Contact", phone: "+1 (555) 876-5432" },
    { id: "c3", name: "Emergency Dispatch (911)", role: "Emergency Services", priority: "critical" }
  ],

  messages: []
};
