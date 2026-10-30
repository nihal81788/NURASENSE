/**
 * NuraSense — Patient Dashboard Engine
 * Reactive clinical telemetry state, real-time 2-hour attack risk calculation,
 * potassium tracking, autonomic trends, care plan, alerts & care circle messaging
 */

import { svgNode, clearNode, drawKChart, drawTrend } from './charts.js';
import { showToast, setError, visible, focusAfterClose, currentTimeValue } from './modals.js';

export const TRIGGER_META = [
  { key: 'meal', label: 'High-carb meal', pts: 8 },
  { key: 'sleep', label: 'Short sleep', pts: 6 },
  { key: 'dose', label: 'Missed dose', pts: 7 },
  { key: 'cold', label: 'Cold exposure', pts: 4 },
  { key: 'exercise', label: 'Hard exercise', pts: 5 }
];

export const dashState = {
  potassium: 3.3,
  lastKTime: '04:12',
  hrv: 31,
  triggers: { meal: true, sleep: true, dose: false, cold: false, exercise: false },
  symptomPenalty: 0,
  symptomLabel: '',
  hydration: 1.4,
  kSeries: [3.9, 3.8, 3.7, 3.8, 3.6, 3.5, 3.6, 3.5, 3.4, 3.5, 3.4, 3.2, 3.3, 3.3],
  kReadings: [
    { when: '24 Oct · 04:12', value: 3.3 },
    { when: '23 Oct · 08:05', value: 3.6 },
    { when: '21 Oct · 09:10', value: 3.8 }
  ],
  alerts: [
    { id: 'a1', time: '24 Oct · 04:12', title: 'Elevated risk', detail: 'Alert sent to care circle', score: '62%', status: 'open' },
    { id: 'a2', time: '22 Oct · 03:20', title: 'Watch', detail: 'Monitoring, no alert raised', score: '41%', status: 'done' },
    { id: 'a3', time: '18 Oct · 23:40', title: 'Elevated risk', detail: 'Alert sent to care circle', score: '57%', status: 'done' }
  ],
  alertSeq: 3,
  homeScroll: 0,
  lastTrigger: null
};

export const TREND_DATA = {
  '24h': {
    hr: [82, 79, 76, 74, 72, 71, 73, 78, 84, 88, 86, 84, 86],
    hrv: [36, 38, 40, 43, 45, 44, 42, 38, 33, 30, 31, 32, 31],
    ticks: [0, 4, 8, 12],
    tickLabels: ['00:00', '08:00', '16:00', 'Now'],
    events: [
      { i: 2, label: 'Risk alert' },
      { i: 9, label: 'High-carb meal' }
    ],
    foot: 'Events: high-carb meal 19:40 · risk alert 04:12'
  },
  '7d': {
    hr: [84, 82, 79, 85, 88, 86, 87],
    hrv: [32, 34, 36, 33, 30, 31, 31],
    ticks: [0, 2, 4, 6],
    tickLabels: ['Mon', 'Wed', 'Fri', 'Sun'],
    events: [],
    foot: 'Weekly view · your baseline is 84–90 bpm'
  },
  '14d': {
    hr: [83, 82, 84, 81, 79, 82, 85, 87, 86, 84, 83, 85, 87, 86],
    hrv: [34, 33, 35, 32, 30, 31, 33, 32, 30, 29, 30, 31, 32, 31],
    ticks: [0, 4, 8, 13],
    tickLabels: ['11 Oct', '15 Oct', '19 Oct', 'Today'],
    events: [],
    foot: 'Two-week view · potassium readings are trending low'
  }
};

let currentTrendRange = '24h';
let kOpener = null;
let symptomOpener = null;
let messageOpener = null;

export function riskLevel(total) {
  if (total < 25) return { key: 'low', label: 'Low risk' };
  if (total < 50) return { key: 'watch', label: 'Watch' };
  if (total < 75) return { key: 'elevated', label: 'Elevated' };
  return { key: 'severe', label: 'High risk' };
}

export function riskBreakdown() {
  const factors = [];
  if (dashState.potassium < 3.5) {
    const kPts = dashState.potassium < 3.2 ? 18 : dashState.potassium < 3.4 ? 14 : 10;
    factors.push({ label: 'Potassium ' + dashState.potassium.toFixed(1) + ' mmol/L', pts: kPts });
  }
  TRIGGER_META.forEach(function (t) {
    if (dashState.triggers[t.key]) factors.push({ label: t.label, pts: t.pts });
  });
  if (dashState.hrv < 35) factors.push({ label: 'HRV ' + dashState.hrv + ' ms', pts: 5 });
  if (dashState.symptomPenalty) factors.push({ label: dashState.symptomLabel, pts: dashState.symptomPenalty });
  let total = 17;
  factors.forEach(function (factor) { total += factor.pts; });
  total = Math.max(4, Math.min(94, total));
  return { total: total, factors: factors };
}

export function renderRisk() {
  const riskPanel = document.getElementById('dash-risk');
  const riskGauge = document.getElementById('riskGauge');
  const riskValue = document.getElementById('riskValue');
  const riskChip = document.getElementById('riskChip');
  const riskStatus = document.getElementById('riskStatus');
  const riskFactors = document.getElementById('riskFactors');

  if (!riskPanel || !riskGauge) return { total: 0, factors: [] };

  const info = riskBreakdown();
  const level = riskLevel(info.total);
  riskPanel.dataset.level = level.key;
  riskGauge.style.setProperty('--risk', (info.total / 100).toFixed(3));
  riskGauge.setAttribute('aria-label', 'Attack probability ' + info.total + ' percent, ' + level.label.toLowerCase());
  riskValue.textContent = info.total;
  riskChip.textContent = level.label;
  riskStatus.textContent = level.key === 'low'
    ? 'Within your usual range'
    : level.key === 'watch'
      ? 'Slightly above your baseline'
      : level.key === 'elevated'
        ? 'Above your 7-day median'
        : 'Well above your baseline';

  clearNode(riskFactors);
  if (!info.factors.length) {
    const empty = document.createElement('li');
    empty.className = 'risk-factor risk-factor--empty';
    empty.textContent = 'No active risk factors logged right now.';
    riskFactors.appendChild(empty);
    return info;
  }
  info.factors.forEach(function (factor) {
    const li = document.createElement('li');
    li.className = 'risk-factor';
    const dot = document.createElement('span');
    dot.className = 'risk-factor__dot';
    const label = document.createElement('span');
    label.className = 'risk-factor__label';
    label.textContent = factor.label;
    const pts = document.createElement('span');
    pts.className = 'risk-factor__pts';
    pts.textContent = '+' + factor.pts;
    li.appendChild(dot);
    li.appendChild(label);
    li.appendChild(pts);
    riskFactors.appendChild(li);
  });
  return info;
}

export function kStatusFor(value) {
  if (value < 3.5) return { label: 'Below range', ok: false };
  if (value > 5.1) return { label: 'Above range', ok: false };
  return { label: 'In range', ok: true };
}

export function renderKReadings() {
  const kReadings = document.getElementById('kReadings');
  if (!kReadings) return;
  clearNode(kReadings);
  dashState.kReadings.slice(0, 3).forEach(function (reading) {
    const row = document.createElement('div');
    row.className = 'k-reading';
    const when = document.createElement('span');
    when.textContent = reading.when;
    const value = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = reading.value.toFixed(1);
    value.appendChild(strong);
    value.appendChild(document.createTextNode(' mmol/L'));
    if (reading.value < 3.5) {
      const flag = document.createElement('em');
      flag.textContent = ' · low';
      value.appendChild(flag);
    }
    row.appendChild(when);
    row.appendChild(value);
    kReadings.appendChild(row);
  });
}

export function renderK() {
  const kValue = document.getElementById('kValue');
  const kStatusChip = document.getElementById('kStatusChip');
  const kMeta = document.getElementById('kMeta');
  const kChart = document.getElementById('kChart');
  if (!kValue) return;

  const status = kStatusFor(dashState.potassium);
  kValue.textContent = dashState.potassium.toFixed(1);
  kStatusChip.textContent = status.label;
  kStatusChip.classList.toggle('k-chip--ok', status.ok);
  kMeta.textContent = 'Range 3.5–5.1 · logged ' + dashState.lastKTime;
  drawKChart(kChart, dashState.kSeries);
  renderKReadings();
}

export function renderTrend(range) {
  currentTrendRange = range;
  const trendChart = document.getElementById('trendChart');
  const trendFoot = document.getElementById('trendFoot');
  drawTrend(trendChart, range, TREND_DATA);
  if (trendFoot && TREND_DATA[range]) trendFoot.textContent = TREND_DATA[range].foot;
  document.querySelectorAll('.range-tab').forEach(function (button) {
    button.setAttribute('aria-pressed', button.getAttribute('data-range') === range ? 'true' : 'false');
  });
}

export function updateAlertCount() {
  const alertCount = document.getElementById('alertCount');
  if (!alertCount) return;
  const open = dashState.alerts.filter(function (alert) { return alert.status === 'open'; }).length;
  alertCount.textContent = open === 0 ? 'All clear' : open + ' open';
  alertCount.classList.toggle('tag--sample', open > 0);
}

export function renderAlerts() {
  const alertList = document.getElementById('alertList');
  if (!alertList) return;
  clearNode(alertList);
  dashState.alerts.forEach(function (alert) {
    const row = document.createElement('div');
    row.className = 'alert-row';
    row.setAttribute('data-alert-id', alert.id);

    const time = document.createElement('span');
    time.className = 'alert-time';
    time.textContent = alert.time;

    const body = document.createElement('span');
    body.className = 'alert-body';
    const title = document.createElement('span');
    title.className = 'alert-title';
    title.textContent = alert.title;
    const detail = document.createElement('span');
    detail.className = 'alert-detail';
    detail.textContent = alert.detail;
    body.appendChild(title);
    body.appendChild(detail);

    const score = document.createElement('span');
    score.className = 'alert-score';
    score.textContent = alert.score;

    row.appendChild(time);
    row.appendChild(body);
    row.appendChild(score);

    if (alert.status === 'open') {
      const ack = document.createElement('button');
      ack.type = 'button';
      ack.className = 'alert-ack';
      ack.setAttribute('data-ack', alert.id);
      ack.textContent = 'Acknowledge';
      row.appendChild(ack);
    } else {
      const chip = document.createElement('span');
      chip.className = 'status-chip status-chip--done';
      chip.textContent = 'Acknowledged';
      row.appendChild(chip);
    }
    alertList.appendChild(row);
  });
  updateAlertCount();
}

export function renderNotif() {
  const notifList = document.getElementById('dashNotifList');
  const bellBadge = document.getElementById('bellBadge');
  const dashBell = document.getElementById('dashBell');
  const markAllRead = document.getElementById('markAllRead');
  if (!notifList) return;

  clearNode(notifList);
  dashState.alerts.slice(0, 3).forEach(function (alert) {
    const item = document.createElement('div');
    item.className = 'notif-item';
    const dot = document.createElement('span');
    dot.className = 'notif-dot' + (alert.status === 'done' ? ' notif-dot--read' : '');
    const body = document.createElement('span');
    body.className = 'od-fill';
    const title = document.createElement('span');
    title.className = 'notif-item__title';
    title.textContent = alert.title + (alert.score !== '—' ? ' · ' + alert.score : '');
    const meta = document.createElement('span');
    meta.className = 'notif-item__meta';
    meta.textContent = alert.time + ' · ' + alert.detail;
    body.appendChild(title);
    body.appendChild(meta);
    item.appendChild(dot);
    item.appendChild(body);
    notifList.appendChild(item);
  });

  const unread = dashState.alerts.filter(function (alert) { return alert.status === 'open'; }).length;
  if (bellBadge) {
    bellBadge.hidden = unread === 0;
    bellBadge.textContent = unread;
  }
  if (dashBell) {
    dashBell.setAttribute('aria-label', unread ? 'Notifications, ' + unread + ' unread' : 'Notifications');
  }
  if (markAllRead) {
    markAllRead.disabled = unread === 0;
    markAllRead.textContent = unread ? 'Mark all read' : 'All read';
  }
}

export function addAlert(title, detail, score) {
  dashState.alertSeq += 1;
  const now = new Date();
  const time = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' · ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  dashState.alerts.unshift({
    id: 'a' + dashState.alertSeq,
    time: time,
    title: title,
    detail: detail,
    score: score || '—',
    status: 'open'
  });
  renderAlerts();
  renderNotif();
}

export function renderPlan() {
  const taskK = document.getElementById('taskK');
  const taskDose = document.getElementById('taskDose');
  const taskKLabel = document.getElementById('taskKLabel');
  const taskDoseLabel = document.getElementById('taskDoseLabel');
  const taskKTag = document.getElementById('taskKTag');
  const taskDoseTag = document.getElementById('taskDoseTag');
  const planProgress = document.getElementById('planProgress');
  const hydrationValue = document.getElementById('hydrationValue');
  const hydrationFill = document.getElementById('hydrationFill');
  const hydrationBar = document.getElementById('hydrationBar');
  const addWater = document.getElementById('addWater');
  const vitalsHydrationValue = document.getElementById('vitalsHydrationValue');
  const vitalsHydrationFill = document.getElementById('vitalsHydrationFill');
  const hydrationFlag = document.getElementById('vitalsHydrationFlag');

  if (!taskK || !planProgress) return;

  const done = (taskK.checked ? 1 : 0) + (taskDose.checked ? 1 : 0) + (dashState.hydration >= 2.5 ? 1 : 0);
  planProgress.textContent = done + ' of 3 done';
  taskKLabel.classList.toggle('is-done', taskK.checked);
  taskDoseLabel.classList.toggle('is-done', taskDose.checked);
  taskKTag.textContent = taskK.checked ? 'Taken' : 'Due';
  taskDoseTag.textContent = taskDose.checked ? 'Taken' : 'Due';

  const pct = Math.min(100, (dashState.hydration / 2.5) * 100);
  hydrationValue.textContent = dashState.hydration.toFixed(1) + ' / 2.5 L';
  hydrationFill.style.width = pct + '%';
  hydrationBar.setAttribute('aria-valuenow', dashState.hydration.toFixed(1));
  addWater.disabled = dashState.hydration >= 2.5;
  addWater.textContent = dashState.hydration >= 2.5 ? 'Goal met' : '+250 ml';

  if (vitalsHydrationValue) vitalsHydrationValue.textContent = dashState.hydration.toFixed(1);
  if (vitalsHydrationFill) vitalsHydrationFill.style.width = pct + '%';
  if (hydrationFlag) {
    const goalMet = dashState.hydration >= 2.5;
    hydrationFlag.textContent = goalMet ? 'Goal met' : 'Behind';
    hydrationFlag.classList.toggle('vital-tile__flag--warn', !goalMet);
  }
}

export function updateDashIdentity(patientName) {
  const name = patientName || 'Maya Roberts';
  const first = name.split(' ')[0];
  const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();

  const dashGreetingText = document.getElementById('dashGreetingText');
  const dashPatientFirst = document.getElementById('dashPatientFirst');
  const dashAvatar = document.getElementById('dashAvatar');
  const dashRailAvatar = document.getElementById('dashRailAvatar');
  const dashProfileName = document.getElementById('dashProfileName');
  const dashRailName = document.getElementById('dashRailName');
  const dashMenuName = document.getElementById('dashMenuName');

  const hr = new Date().getHours();
  if (dashGreetingText) dashGreetingText.textContent = hr < 12 ? 'Morning' : hr < 18 ? 'Afternoon' : 'Evening';
  if (dashPatientFirst) dashPatientFirst.textContent = first;
  if (dashAvatar) dashAvatar.textContent = initials;
  if (dashRailAvatar) dashRailAvatar.textContent = initials;
  if (dashProfileName) dashProfileName.textContent = name;
  if (dashRailName) dashRailName.textContent = name;
  if (dashMenuName) dashMenuName.textContent = name;
}

export function updateDashDate() {
  const dashDate = document.getElementById('dashDate');
  if (dashDate) {
    dashDate.textContent = new Date().toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  }
}

export function renderAll() {
  dashState.potassium = Math.round(dashState.potassium * 10) / 10;
  renderRisk();
  renderK();
  renderTrend(currentTrendRange);
  renderAlerts();
  renderNotif();
  renderPlan();
}

export function setActiveNav(id) {
  document.querySelectorAll('.app-nav__btn, .app-tab').forEach(function (button) {
    const active = button.getAttribute('data-dash-target') === id;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
  });
}

export function closePopovers() {
  const dashNotif = document.getElementById('dashNotif');
  const dashBell = document.getElementById('dashBell');
  const dashProfileMenu = document.getElementById('dashProfileMenu');
  const dashProfileBtn = document.getElementById('dashProfileBtn');

  if (dashNotif) dashNotif.hidden = true;
  if (dashBell) dashBell.setAttribute('aria-expanded', 'false');
  if (dashProfileMenu) dashProfileMenu.hidden = true;
  if (dashProfileBtn) dashProfileBtn.setAttribute('aria-expanded', 'false');
}

export function initDashboardListeners() {
  /* trigger toggles */
  TRIGGER_META.forEach(function (t) {
    const input = document.getElementById('trig-' + t.key);
    if (input) {
      input.checked = !!dashState.triggers[t.key];
      input.addEventListener('change', function () {
        dashState.triggers[t.key] = input.checked;
        renderRisk();
      });
    }
  });

  /* potassium logger */
  const logKBtn = document.getElementById('logKBtn');
  const logKCard = document.getElementById('logKCard');
  const kDialog = document.getElementById('kDialog');
  const kForm = document.getElementById('kForm');
  const kInput = document.getElementById('kInput');
  const kError = document.getElementById('kError');
  const kTime = document.getElementById('kTime');
  const kDialogClose = document.getElementById('kDialogClose');

  function kMessage() {
    const raw = kInput.value.trim();
    if (!raw) return 'Enter the potassium value from your meter.';
    const value = Number(raw);
    if (!isFinite(value)) return 'Enter a number, like 3.6.';
    if (value < 2.5 || value > 7) return 'Enter a value between 2.5 and 7.0 mmol/L.';
    return '';
  }

  function validateK() {
    const message = kMessage();
    setError(kInput, kError, message);
    return !message;
  }

  function openKDialog(trigger) {
    kOpener = trigger || null;
    kForm.reset();
    kInput.value = dashState.potassium.toFixed(1);
    kTime.value = currentTimeValue();
    setError(kInput, kError, '');
    if (!kDialog.open) kDialog.showModal();
    window.requestAnimationFrame(function () {
      kInput.focus();
      kInput.select();
    });
  }

  if (logKBtn) logKBtn.addEventListener('click', () => openKDialog(logKBtn));
  if (logKCard) logKCard.addEventListener('click', () => openKDialog(logKCard));
  if (kInput) {
    kInput.addEventListener('blur', validateK);
    kInput.addEventListener('input', () => {
      if (kInput.getAttribute('aria-invalid') === 'true') validateK();
    });
  }
  if (kForm) {
    kForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!validateK()) {
        kInput.focus();
        return;
      }
      const value = Math.round(Number(kInput.value) * 10) / 10;
      const time = kTime.value || currentTimeValue();
      dashState.potassium = value;
      dashState.lastKTime = time;
      dashState.kSeries[dashState.kSeries.length - 1] = value;
      dashState.kReadings.unshift({ when: 'Today · ' + time, value: value });
      renderK();
      const info = renderRisk();
      kDialog.close();
      showToast('Reading saved · attack probability now ' + info.total + '%.');
    });
  }
  if (kDialogClose) kDialogClose.addEventListener('click', () => kDialog.close());
  if (kDialog) {
    kDialog.addEventListener('click', (event) => {
      if (event.target === kDialog) kDialog.close();
    });
    kDialog.addEventListener('close', () => focusAfterClose(kOpener, logKBtn));
  }

  /* symptom check */
  const symptomBtn = document.getElementById('symptomBtn');
  const symptomDialog = document.getElementById('symptomDialog');
  const symptomForm = document.getElementById('symptomForm');
  const symptomType = document.getElementById('symptomType');
  const symptomSeverity = document.getElementById('symptomSeverity');
  const severityValue = document.getElementById('severityValue');
  const symptomDialogClose = document.getElementById('symptomDialogClose');

  function updateSeverityLabel() {
    const value = Number(symptomSeverity.value);
    const names = { 1: 'Mild', 2: 'Mild', 3: 'Moderate', 4: 'Marked', 5: 'Severe' };
    if (severityValue) severityValue.textContent = value + ' · ' + names[value];
  }

  function openSymptomDialog(trigger) {
    symptomOpener = trigger || null;
    symptomForm.reset();
    updateSeverityLabel();
    if (!symptomDialog.open) symptomDialog.showModal();
    window.requestAnimationFrame(() => { symptomType.focus(); });
  }

  if (symptomBtn) symptomBtn.addEventListener('click', () => openSymptomDialog(symptomBtn));
  if (symptomSeverity) symptomSeverity.addEventListener('input', updateSeverityLabel);
  if (symptomForm) {
    symptomForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const type = symptomType.value;
      const severity = Number(symptomSeverity.value);
      if (type === 'No symptoms') {
        dashState.symptomPenalty = 0;
        dashState.symptomLabel = '';
        showToast('Check-in saved. No new symptoms reported.');
      } else {
        const pts = type === 'Muscle weakness' ? (severity >= 4 ? 12 : 6) : type === 'Cramps' ? (severity >= 4 ? 8 : 4) : 4;
        dashState.symptomPenalty = pts;
        dashState.symptomLabel = 'Symptoms · ' + type.toLowerCase();
        addAlert('Symptom check-in', type + ' · severity ' + severity + '/5', '—');
        const info = renderRisk();
        showToast(type + ' logged · attack probability now ' + info.total + '%.');
      }
      renderRisk();
      symptomDialog.close();
    });
  }
  if (symptomDialogClose) symptomDialogClose.addEventListener('click', () => symptomDialog.close());
  if (symptomDialog) {
    symptomDialog.addEventListener('click', (event) => {
      if (event.target === symptomDialog) symptomDialog.close();
    });
    symptomDialog.addEventListener('close', () => focusAfterClose(symptomOpener, symptomBtn));
  }

  /* care message dialog */
  const messageBtn = document.getElementById('messageBtn');
  const messageDialog = document.getElementById('messageDialog');
  const messageForm = document.getElementById('messageForm');
  const messageTo = document.getElementById('messageTo');
  const messageText = document.getElementById('messageText');
  const messageError = document.getElementById('messageError');
  const careLast = document.getElementById('careLast');
  const messageDialogClose = document.getElementById('messageDialogClose');

  function openMessageDialog(trigger) {
    messageOpener = trigger || null;
    messageForm.reset();
    setError(messageText, messageError, '');
    if (!messageDialog.open) messageDialog.showModal();
    window.requestAnimationFrame(() => { messageTo.focus(); });
  }

  if (messageBtn) messageBtn.addEventListener('click', () => openMessageDialog(messageBtn));
  if (messageText) {
    messageText.addEventListener('input', () => {
      if (messageText.getAttribute('aria-invalid') === 'true') setError(messageText, messageError, '');
    });
  }
  if (messageForm) {
    messageForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!messageText.value.trim()) {
        setError(messageText, messageError, 'Write a short message before sending.');
        messageText.focus();
        return;
      }
      const recipient = messageTo.value.split(' · ')[0];
      setError(messageText, messageError, '');
      if (careLast) careLast.textContent = 'Last message · just now · ' + recipient + ' notified in this preview.';
      messageDialog.close();
      showToast('Message sent to ' + recipient + '.');
    });
  }
  if (messageDialogClose) messageDialogClose.addEventListener('click', () => messageDialog.close());
  if (messageDialog) {
    messageDialog.addEventListener('click', (event) => {
      if (event.target === messageDialog) messageDialog.close();
    });
    messageDialog.addEventListener('close', () => focusAfterClose(messageOpener, messageBtn));
  }

  /* alert acknowledgment */
  const alertList = document.getElementById('alertList');
  if (alertList) {
    alertList.addEventListener('click', function (event) {
      const button = event.target.closest('[data-ack]');
      if (!button || button.getAttribute('aria-disabled') === 'true') return;
      const id = button.getAttribute('data-ack');
      let targetAlert = null;
      dashState.alerts.forEach((item) => { if (item.id === id) targetAlert = item; });
      if (!targetAlert || targetAlert.status !== 'open') return;
      targetAlert.status = 'done';
      renderAlerts();
      renderNotif();
      showToast('Alert acknowledged.');
    });
  }

  /* care plan tasks & hydration */
  const taskK = document.getElementById('taskK');
  const taskDose = document.getElementById('taskDose');
  const addWater = document.getElementById('addWater');

  if (taskK) taskK.addEventListener('change', renderPlan);
  if (taskDose) taskDose.addEventListener('change', renderPlan);
  if (addWater) {
    addWater.addEventListener('click', function () {
      if (dashState.hydration >= 2.5) return;
      dashState.hydration = Math.min(2.5, Math.round((dashState.hydration + 0.25) * 100) / 100);
      renderPlan();
      showToast('Water logged · ' + dashState.hydration.toFixed(2) + ' of 2.5 L');
    });
  }

  /* notifications bell & popovers */
  const dashBell = document.getElementById('dashBell');
  const dashNotif = document.getElementById('dashNotif');
  const markAllRead = document.getElementById('markAllRead');
  const dashProfileBtn = document.getElementById('dashProfileBtn');
  const dashProfileMenu = document.getElementById('dashProfileMenu');

  if (dashBell && dashNotif) {
    dashBell.addEventListener('click', function (event) {
      event.stopPropagation();
      const open = dashNotif.hidden;
      closePopovers();
      dashNotif.hidden = !open;
      dashBell.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  if (markAllRead) {
    markAllRead.addEventListener('click', function () {
      dashState.alerts.forEach((a) => { a.status = 'done'; });
      renderAlerts();
      renderNotif();
      showToast('All notifications marked read.');
    });
  }

  if (dashProfileBtn && dashProfileMenu) {
    dashProfileBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      const open = dashProfileMenu.hidden;
      closePopovers();
      dashProfileMenu.hidden = !open;
      dashProfileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  document.addEventListener('click', function (event) {
    if (!event.target.closest('.app-pop-wrap')) {
      closePopovers();
    }
  });

  /* range tabs (24h, 7d, 14d) */
  document.querySelectorAll('.range-tab').forEach(function (button) {
    button.addEventListener('click', function () {
      const range = button.getAttribute('data-range');
      renderTrend(range);
    });
  });

  /* ECG pause button */
  const ecgPause = document.getElementById('ecgPause');
  const ecgMonitor = document.getElementById('ecgMonitor');
  const ecgPauseLabel = document.getElementById('ecgPauseLabel');
  const ecgState = document.getElementById('ecgState');
  if (ecgPause && ecgMonitor) {
    ecgPause.addEventListener('click', function () {
      const paused = ecgMonitor.classList.toggle('is-paused');
      ecgPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
      if (ecgPauseLabel) ecgPauseLabel.textContent = paused ? 'Resume' : 'Pause';
      if (ecgState) ecgState.textContent = paused ? 'Paused' : 'Live';
    });
  }

  /* navigation rail and bottom tab bar */
  document.querySelectorAll('.app-nav__btn, .app-tab').forEach(function (button) {
    button.addEventListener('click', function () {
      const targetId = button.getAttribute('data-dash-target');
      setActiveNav(targetId);
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const focusable = targetEl.querySelector('h1, h2, button, a');
        if (focusable) focusable.focus({ preventScroll: true });
      }
    });
  });
}

/**
 * Connects directly to Galaxy Watch telemetry WebSocket (ws://localhost:8000/ws)
 * and dynamically updates live HR, RMSSD, SpO2, and Skin Temperature across the UI.
 */
export function initLiveTelemetryStream() {
  const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + (window.location.hostname || 'localhost') + ':8000/ws';
  try {
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.heartRate && data.heartRate > 0) {
          document.querySelectorAll('.vital-hr-val').forEach(el => { el.textContent = data.heartRate; });
        }
        if (data.rmssd && data.rmssd > 0) {
          dashState.hrv = Math.round(data.rmssd);
          document.querySelectorAll('.vital-rmssd-val').forEach(el => { el.textContent = Math.round(data.rmssd); });
        }
        if (data.spo2 && data.spo2 > 0) {
          document.querySelectorAll('.vital-spo2-val').forEach(el => { el.textContent = data.spo2; });
          const flag = document.getElementById('tileSpo2Flag');
          if (flag) {
            flag.textContent = data.spo2 >= 95 ? 'Normal' : 'Low';
            flag.className = data.spo2 >= 95 ? 'vital-tile__flag' : 'vital-tile__flag vital-tile__flag--warn';
          }
        }
        if (data.skin_temp && data.skin_temp > 0) {
          document.querySelectorAll('.vital-temp-val').forEach(el => { el.textContent = data.skin_temp.toFixed(1); });
        }
        if (data.sweat_loss !== undefined && data.sweat_loss !== null) {
          document.querySelectorAll('.vital-sweat-val').forEach(el => { el.textContent = data.sweat_loss.toFixed(1) + ' mL'; });
        }
      } catch (err) {}
    };
    ws.onclose = () => {
      setTimeout(initLiveTelemetryStream, 3000);
    };
    ws.onerror = () => {
      ws.close();
    };
  } catch (e) {}
}
