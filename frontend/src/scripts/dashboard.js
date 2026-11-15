/**
 * NuraSense — Patient Dashboard Engine
 * Reactive clinical telemetry state, real-time 2-hour attack risk calculation,
 * potassium tracking, autonomic trends, care plan, alerts & care circle messaging
 */

import { svgNode, clearNode, drawKChart, drawTrend } from './charts.js';
import { showToast, setError, visible, focusAfterClose, currentTimeValue } from './modals.js';
import { supabase } from './supabase.js';

export const TRIGGER_META = [
  { key: 'meal', label: 'High-carb meal', pts: 8 },
  { key: 'sleep', label: 'Short sleep', pts: 6 },
  { key: 'dose', label: 'Missed dose', pts: 7 },
  { key: 'cold', label: 'Cold exposure', pts: 4 },
  { key: 'exercise', label: 'Hard exercise', pts: 5 }
];

export const dashState = {
  potassium: 4.2,
  lastKTime: '',
  hrv: 31,
  triggers: { meal: true, sleep: true, dose: false, cold: false, exercise: false },
  symptomPenalty: 0,
  symptomLabel: '',
  hydration: 1.4,
  kSeries: [],
  kReadings: [],
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

  if (!dashState.kReadings || dashState.kReadings.length === 0) {
    const emptyRow = document.createElement('div');
    emptyRow.className = 'k-reading';
    emptyRow.innerHTML = '<span style="color:var(--muted); font-size:12px;">Syncing recorded telemetry…</span>';
    kReadings.appendChild(emptyRow);
    return;
  }

  dashState.kReadings.slice(0, 5).forEach(function (reading) {
    const row = document.createElement('div');
    row.className = 'k-reading';
    const when = document.createElement('span');
    when.textContent = reading.when;
    const value = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = Number(reading.value).toFixed(1);
    value.appendChild(strong);
    value.appendChild(document.createTextNode(' mmol/L'));

    const risk = reading.risk || (reading.value < 3.5 ? 'hypokalemia' : reading.value > 5.1 ? 'hyperkalemia' : 'normal');
    const flag = document.createElement('em');
    if (risk === 'hypokalemia' || reading.value < 3.5) {
      flag.textContent = ' · low';
      flag.style.color = '#ff6b6b';
      value.appendChild(flag);
    } else if (risk === 'hyperkalemia' || reading.value > 5.1) {
      flag.textContent = ' · high';
      flag.style.color = '#ffa726';
      value.appendChild(flag);
    } else {
      flag.textContent = ' · in range';
      flag.style.color = '#00ff88';
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

  const currentK = Number(dashState.potassium || 4.2);
  const status = kStatusFor(currentK);
  kValue.textContent = currentK.toFixed(1);
  if (kStatusChip) {
    kStatusChip.textContent = status.label;
    kStatusChip.className = `k-chip ${status.ok ? 'k-chip--ok' : ''}`;
  }
  if (kMeta) {
    kMeta.textContent = 'Range 3.5–5.1 · ' + (dashState.lastKTime ? `logged ${dashState.lastKTime}` : 'live telemetry');
  }
  if (kChart) {
    drawKChart(kChart, dashState.kSeries);
  }
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

export function updateDashIdentity(patientName, avatarUrl) {
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

  const renderAvatarContent = (el) => {
    if (!el) return;
    if (avatarUrl) {
      el.innerHTML = `<img src="${avatarUrl}" alt="${name}" class="avatar-photo" />`;
    } else {
      el.textContent = initials;
    }
  };

  renderAvatarContent(dashAvatar);
  renderAvatarContent(dashRailAvatar);

  if (dashProfileName) dashProfileName.textContent = first;
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

  /* Emergency Contacts modal & dispatch test */
  const btnAddContact = document.getElementById('btnAddContact');
  const contactDialog = document.getElementById('contactDialog');
  const contactDialogClose = document.getElementById('contactDialogClose');
  const contactForm = document.getElementById('contactForm');
  const contactFormStatus = document.getElementById('contactFormStatus');
  const contactSubmitBtn = document.getElementById('contactSubmitBtn');
  const btnTestAlert = document.getElementById('btnTestAlert');

  if (btnAddContact && contactDialog) {
    btnAddContact.addEventListener('click', () => {
      if (contactForm) contactForm.reset();
      if (contactFormStatus) contactFormStatus.hidden = true;
      if (!contactDialog.open) contactDialog.showModal();
    });
  }

  if (contactDialogClose && contactDialog) {
    contactDialogClose.addEventListener('click', () => contactDialog.close());
  }

  if (contactDialog) {
    contactDialog.addEventListener('click', (e) => {
      if (e.target === contactDialog) contactDialog.close();
    });
  }

  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('contactNameInput')?.value.trim();
      const phone = document.getElementById('contactPhoneInput')?.value.trim();
      const email = document.getElementById('contactEmailInput')?.value.trim();
      const relationship = document.getElementById('contactRelSelect')?.value || 'Family';
      const isPatient = document.getElementById('contactIsPatientCheck')?.checked || false;

      if (!name || !phone) {
        if (contactFormStatus) {
          contactFormStatus.textContent = 'Name and phone number are required.';
          contactFormStatus.className = 'pair-status-msg pair-status-msg--error';
          contactFormStatus.hidden = false;
        }
        return;
      }

      if (contactSubmitBtn) {
        contactSubmitBtn.disabled = true;
        contactSubmitBtn.textContent = 'Saving…';
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          showToast('Please sign in to save emergency contacts.', 'warn');
          return;
        }

        // Check count constraint: max 5 contacts
        const { count, error: countErr } = await supabase
          .from('emergency_contacts')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId);

        if (!countErr && count >= 5) {
          if (contactFormStatus) {
            contactFormStatus.textContent = 'Maximum 5 emergency contacts allowed.';
            contactFormStatus.className = 'pair-status-msg pair-status-msg--error';
            contactFormStatus.hidden = false;
          }
          return;
        }

        const { error: insertErr } = await supabase
          .from('emergency_contacts')
          .insert({
            user_id: userId,
            name,
            phone,
            email: email || null,
            relationship,
            is_patient: isPatient
          });

        if (insertErr) {
          if (contactFormStatus) {
            contactFormStatus.textContent = 'Error: ' + insertErr.message;
            contactFormStatus.className = 'pair-status-msg pair-status-msg--error';
            contactFormStatus.hidden = false;
          }
        } else {
          showToast(`Emergency contact ${name} added!`, 'success');
          contactDialog.close();
          fetchEmergencyContacts(userId);
        }
      } catch (err) {
        if (contactFormStatus) {
          contactFormStatus.textContent = 'Failed: ' + err.message;
          contactFormStatus.className = 'pair-status-msg pair-status-msg--error';
          contactFormStatus.hidden = false;
        }
      } finally {
        if (contactSubmitBtn) {
          contactSubmitBtn.disabled = false;
          contactSubmitBtn.textContent = 'Save Contact';
        }
      }
    });
  }

  if (btnTestAlert) {
    btnTestAlert.addEventListener('click', async () => {
      btnTestAlert.disabled = true;
      btnTestAlert.textContent = '🚨 Dispatching test alert…';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id || '0d6ccd26-016f-4223-825a-1d4c8c7bcf60';
        const railwayHost = localStorage.getItem('nurasense_railway_url') || 'https://nurasense-production.up.railway.app';
        const cleanHost = railwayHost.replace(/\/+$/, '');

        const resp = await fetch(`${cleanHost}/alerts/${userId}/test`, { method: 'POST' });
        const resJson = await resp.json();
        if (resJson.status === 'cooldown_active') {
          showToast(`Cooldown active: ${resJson.remaining_seconds}s remaining before next alert.`, 'warn');
        } else {
          showToast(`Test alert sent! Fast2SMS: ${resJson.sms_sent ? 'Sent' : 'Skipped'}, Twilio: ${resJson.call_sent ? 'Called' : 'Skipped'}`, 'success');
          fetchAlertHistory(userId);
          triggerLiveCriticalAlert(2.9);
        }
      } catch (err) {
        showToast('Test alert request error: ' + err.message, 'danger');
      } finally {
        btnTestAlert.disabled = false;
        btnTestAlert.textContent = '🚨 Send Test Emergency Alert';
      }
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

/**
 * Authentication Gate for Dashboard:
 * Checks active Supabase session. If unauthenticated, immediately redirects to / (login page).
 * If authenticated, displays user Google profile photo & name in the navbar.
 */
export async function checkDashboardAuth() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user) {
      if (window.location.pathname.startsWith('/dashboard')) {
        window.location.replace('/');
      }
      return null;
    }

    const user = session.user;
    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || user.email?.split('@')[0] || 'Patient';
    const avatar = meta.avatar_url || meta.picture || '';

    updateDashIdentity(name, avatar);

    // Fetch telemetry and emergency history once on dashboard load after auth check
    const userId = session?.user?.id;
    fetchKHistory(userId);
    fetchAlertHistory(userId);
    fetchEmergencyContacts(userId);
    captureLocation();

    // Subscribe to realtime updates on potassium_predictions, alert_logs & emergency_contacts
    try {
      supabase
        .channel('realtime_k_channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'potassium_predictions' }, () => {
          fetchKHistory();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_logs' }, () => {
          fetchAlertHistory();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_contacts' }, () => {
          fetchEmergencyContacts();
        })
        .subscribe();
    } catch (_) {}

    return session;
  } catch (err) {
    console.warn('Dashboard auth check note:', err);
    return null;
  }
}

export async function fetchKHistory() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    let query = supabase
      .from('potassium_predictions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('Supabase potassium_predictions fetch:', error.message);
      return;
    }

    if (data && data.length > 0) {
      const latest = data[0];
      dashState.potassium = Number(latest.predicted_level);

      const d = new Date(latest.created_at);
      const dStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const tStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      dashState.lastKTime = `${dStr} · ${tStr}`;

      dashState.kReadings = data.map(p => {
        const pd = new Date(p.created_at);
        const pdStr = pd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        const ptStr = pd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        return {
          when: `${pdStr} · ${ptStr}`,
          value: Number(p.predicted_level),
          risk: p.risk_class
        };
      });

      // kSeries: chronological (oldest to newest)
      const chronological = [...data].reverse();
      dashState.kSeries = chronological.map(p => Number(p.predicted_level));
      if (dashState.kSeries.length === 1) {
        dashState.kSeries = [dashState.kSeries[0], dashState.kSeries[0]];
      }

      renderK();
      renderKHistory(data.slice(0, 5));
    }
  } catch (err) {
    console.warn('fetchKHistory error:', err);
  }
}

export function renderKHistory(predictions) {
  const container = document.getElementById('k-history') || document.querySelector('[data-k-history]');
  if (!container || !Array.isArray(predictions)) return;
  container.innerHTML = predictions.map(p => {
    const d = new Date(p.created_at);
    const dStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const tStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="k-history-item k-history-item--${p.risk_class}">
        <span class="k-history-val">${Number(p.predicted_level).toFixed(1)} mmol/L</span>
        <span class="k-history-risk">${p.risk_class}</span>
        <span class="k-history-time">${dStr} · ${tStr}</span>
      </div>
    `;
  }).join('');
}

/**
 * Browser Geolocation Capture for Emergency Services
 * Stores latitude & longitude in window._nurasenseLocation and transmits via WebSocket
 */
export async function captureLocation() {
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        window._nurasenseLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
        console.log('[Location] Geolocation captured:', window._nurasenseLocation);
        if (window._nurasenseWs && window._nurasenseWs.readyState === WebSocket.OPEN) {
          window._nurasenseWs.send(JSON.stringify({
            type: 'location',
            location: window._nurasenseLocation
          }));
        }
      },
      err => {
        console.warn('Geolocation capture notice:', err.message);
        window._nurasenseLocation = null;
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }
}

/**
 * Emergency Alert System History & Live Banner
 */
export function triggerLiveCriticalAlert(potassiumMmol) {
  const banner = document.getElementById('criticalAlertBanner');
  const alertText = document.getElementById('criticalAlertText');
  if (banner) {
    banner.style.display = 'block';
    if (alertText && potassiumMmol) {
      alertText.textContent = `CRITICAL: Potassium level dropped to ${Number(potassiumMmol).toFixed(1)} mmol/L. Fast2SMS to family, automated Twilio voice reminder, and emergency email dispatched.`;
    }
  }
  showToast(`🚨 CRITICAL EMERGENCY ALERT SENT: K+ ${potassiumMmol ? Number(potassiumMmol).toFixed(1) : ''} mmol/L! Family notified with live location.`, 'danger');
}

export async function fetchAlertHistory(explicitUserId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = explicitUserId || session?.user?.id;

    const railwayHost = localStorage.getItem('nurasense_railway_url') || 'https://nurasense-production.up.railway.app';
    const cleanHost = railwayHost.replace(/\/+$/, '');

    let alertLogs = [];
    if (userId) {
      try {
        const resp = await fetch(`${cleanHost}/alerts/${userId}/history`, {
          headers: { 'Content-Type': 'application/json' }
        });
        if (resp.ok) {
          const resJson = await resp.json();
          alertLogs = resJson.history || [];
        }
      } catch (_) {}

      if (!alertLogs.length) {
        const { data, error } = await supabase
          .from('alert_logs')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10);
        if (!error && data) {
          alertLogs = data;
        }
      }
    }

    renderAlertHistory(alertLogs);
  } catch (err) {
    console.warn('fetchAlertHistory note:', err);
  }
}

export function renderAlertHistory(alertLogs) {
  const alertList = document.getElementById('alertList');
  const alertCount = document.getElementById('alertCount');
  if (!alertList) return;

  clearNode(alertList);

  if (!alertLogs || alertLogs.length === 0) {
    const emptyRow = document.createElement('div');
    emptyRow.className = 'alert-row';
    emptyRow.innerHTML = `
      <span class="alert-body" style="grid-column: 1 / -1; padding: 12px 0; color: var(--muted); font-size: 12px;">
        No emergency alerts triggered yet. System monitoring 24/7.
      </span>
    `;
    alertList.appendChild(emptyRow);
    if (alertCount) {
      alertCount.textContent = 'All clear';
      alertCount.classList.remove('tag--sample');
    }
    return;
  }

  if (alertCount) {
    alertCount.textContent = `${alertLogs.length} logged`;
    alertCount.classList.add('tag--sample');
  }

  alertLogs.forEach(alert => {
    const row = document.createElement('div');
    row.className = 'alert-row';

    const d = new Date(alert.created_at || Date.now());
    const dStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const tStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const timeSpan = document.createElement('span');
    timeSpan.className = 'alert-time';
    timeSpan.textContent = `${dStr} · ${tStr}`;

    const bodySpan = document.createElement('span');
    bodySpan.className = 'alert-body';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'alert-title';
    titleSpan.innerHTML = `🚨 Hypokalemia Alert · <strong style="color:#ff6b6b">${Number(alert.potassium_level).toFixed(1)} mmol/L</strong>`;

    const detailSpan = document.createElement('span');
    detailSpan.className = 'alert-detail';
    detailSpan.textContent = `${alert.contacts_notified || 0} family/contacts notified`;

    // Channels tags
    const channelDiv = document.createElement('div');
    channelDiv.className = 'alert-channels';

    const smsTag = document.createElement('span');
    smsTag.className = `alert-tag ${alert.sms_sent ? 'alert-tag--sms' : 'alert-tag--off'}`;
    smsTag.textContent = alert.sms_sent ? 'SMS ✓' : 'SMS —';

    const callTag = document.createElement('span');
    callTag.className = `alert-tag ${alert.call_sent ? 'alert-tag--call' : 'alert-tag--off'}`;
    callTag.textContent = alert.call_sent ? 'Voice Call ✓' : 'Call —';

    const emailTag = document.createElement('span');
    emailTag.className = `alert-tag ${alert.email_sent ? 'alert-tag--email' : 'alert-tag--off'}`;
    emailTag.textContent = alert.email_sent ? 'Email ✓' : 'Email —';

    channelDiv.appendChild(smsTag);
    channelDiv.appendChild(callTag);
    channelDiv.appendChild(emailTag);

    bodySpan.appendChild(titleSpan);
    bodySpan.appendChild(detailSpan);
    bodySpan.appendChild(channelDiv);

    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'alert-score';
    scoreSpan.style.color = '#ff6b6b';
    scoreSpan.textContent = 'HIGH RISK';

    row.appendChild(timeSpan);
    row.appendChild(bodySpan);
    row.appendChild(scoreSpan);
    alertList.appendChild(row);
  });
}

/**
 * Emergency Contacts Management (Supabase)
 */
export async function fetchEmergencyContacts(explicitUserId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = explicitUserId || session?.user?.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from('emergency_contacts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('fetchEmergencyContacts error:', error.message);
      return;
    }

    renderEmergencyContacts(data || []);
  } catch (err) {
    console.warn('fetchEmergencyContacts exception:', err);
  }
}

export function renderEmergencyContacts(contacts) {
  const list = document.getElementById('emergencyContactsList');
  if (!list) return;

  clearNode(list);

  if (!contacts || contacts.length === 0) {
    const emptyRow = document.createElement('div');
    emptyRow.className = 'care-row';
    emptyRow.innerHTML = `
      <span class="care-avatar" aria-hidden="true">+</span>
      <span class="od-stack" style="--od-gap:0">
        <span class="care-name">No emergency contacts saved</span>
        <span class="care-role">Add 1 to 5 contacts for automated Fast2SMS & Twilio dispatch</span>
      </span>
    `;
    list.appendChild(emptyRow);
    return;
  }

  contacts.forEach(c => {
    const row = document.createElement('div');
    row.className = 'contact-item';

    const meta = document.createElement('div');
    meta.className = 'contact-meta';

    const nameRow = document.createElement('div');
    nameRow.className = 'contact-name-row';

    const name = document.createElement('span');
    name.className = 'contact-name';
    name.textContent = c.name;
    nameRow.appendChild(name);

    if (c.relationship) {
      const relBadge = document.createElement('span');
      relBadge.className = 'contact-badge';
      relBadge.textContent = c.relationship;
      nameRow.appendChild(relBadge);
    }

    if (c.is_patient) {
      const patBadge = document.createElement('span');
      patBadge.className = 'contact-badge contact-badge--patient';
      patBadge.textContent = 'Voice Call Target';
      nameRow.appendChild(patBadge);
    }

    const detail = document.createElement('span');
    detail.className = 'contact-detail';
    detail.textContent = `${c.phone}${c.email ? ' · ' + c.email : ''}`;

    meta.appendChild(nameRow);
    meta.appendChild(detail);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'contact-del-btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (confirm(`Remove ${c.name} from emergency contacts?`)) {
        await deleteEmergencyContact(c.id);
      }
    });

    row.appendChild(meta);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

export async function deleteEmergencyContact(contactId) {
  try {
    const { error } = await supabase
      .from('emergency_contacts')
      .delete()
      .eq('id', contactId);
    if (error) {
      showToast('Error removing contact: ' + error.message, 'danger');
    } else {
      showToast('Contact removed.', 'success');
      fetchEmergencyContacts();
    }
  } catch (err) {
    showToast('Failed to remove contact.', 'danger');
  }
}

/**
 * Cloud ECG Live Streaming & Waveform Engine
 * Connects to Railway FastAPI WebSocket at /ws/{user_id}
 * Rolling buffer: 750 samples (3.0s at 250Hz)
 * Renders every 40ms via requestAnimationFrame
 * Dark background #0d1117, green trace #00ff88
 * Color-coded BPM:
 *   <60   -> #4fc3f7 (blue)
 *   60-100 -> #00ff88 (green)
 *   >100  -> #ff6b6b (red)
 * Auto-reconnects every 3s on disconnect.
 */
export function initCloudEcgMonitor(userId) {
  if (!userId) return;

  const canvas = document.getElementById('liveEcgCanvas');
  const bpmEl = document.getElementById('liveEcgBpm');
  const statusEl = document.getElementById('liveEcgStatus');
  const liveDot = document.getElementById('ecgLiveDot');
  const linkStatus = document.getElementById('liveEcgLinkStatus');
  const ecgState = document.getElementById('ecgState');
  const rawAdcEl = document.getElementById('liveRawAdcVal');
  const btnModeRaw = document.getElementById('btnModeRaw');
  const btnModeFiltered = document.getElementById('btnModeFiltered');
  const specsLabel = document.getElementById('ecgSpecsLabel');

  // Display mode: 'raw' (default as requested: plots raw ESP32 data) or 'filtered'
  let displayMode = 'raw';

  if (btnModeRaw) {
    btnModeRaw.addEventListener('click', () => {
      displayMode = 'raw';
      btnModeRaw.classList.add('is-active');
      if (btnModeFiltered) btnModeFiltered.classList.remove('is-active');
      if (specsLabel) specsLabel.textContent = 'ESP32 250 Hz RAW ADC (0–4095) · DIRECT SENSOR TELEMETRY';
    });
  }
  if (btnModeFiltered) {
    btnModeFiltered.addEventListener('click', () => {
      displayMode = 'filtered';
      btnModeFiltered.classList.add('is-active');
      if (btnModeRaw) btnModeRaw.classList.remove('is-active');
      if (specsLabel) specsLabel.textContent = '250 Hz Lead I · 50Hz Notch (Q=10) · 0.5–35Hz Clinical Bandpass';
    });
  }

  // Buffer of 500 samples (250Hz * 2.0 seconds - displays ~2 to 3 distinct spaced beats)
  const BUFFER_SIZE = 500;
  const samples = new Float32Array(BUFFER_SIZE);
  let sampleIndex = 0;
  let currentBpm = 0;
  let isReceivingSignal = false;
  let lastSignalTime = 0;
  let ws = null;
  let reconnectTimer = null;
  let animFrameId = null;
  let isPaused = false;

  // Fill with flat baseline initially
  samples.fill(0);

  // Setup pause toggle
  const ecgPauseBtn = document.getElementById('ecgPause');
  if (ecgPauseBtn) {
    ecgPauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      if (ecgState) ecgState.textContent = isPaused ? 'Paused' : (isReceivingSignal ? 'Live' : 'Waiting for signal...');
      if (ecgPauseBtn) ecgPauseBtn.setAttribute('aria-pressed', isPaused ? 'true' : 'false');
      const pauseLabel = document.getElementById('ecgPauseLabel');
      if (pauseLabel) pauseLabel.textContent = isPaused ? 'Resume' : 'Pause';
    });
  }

  // Determine WebSocket URL
  // Uses localhost:8765 if on localhost, otherwise connects to live Railway Cloud Engine
  const customRailwayUrl = localStorage.getItem('nurasense_railway_url') || '';
  const defaultRailwayHost = 'nurasense-production.up.railway.app';
  const railwayHost = customRailwayUrl.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '') || defaultRailwayHost;

  const wsUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'ws://localhost:8765/ws/' + userId
    : `wss://${railwayHost}/ws/${userId}`;

  function updateBpmDisplay(bpm, isLeadsOff = false) {
    if (!bpmEl || !statusEl) return;

    if (isLeadsOff) {
      bpmEl.innerHTML = `-- <span class="ecg-metric__unit">bpm</span>`;
      bpmEl.style.color = '#ffa726';
      statusEl.textContent = '⚠️ Leads Disconnected';
      statusEl.style.color = '#ffa726';
      return;
    }

    if (!bpm || bpm <= 0 || !isReceivingSignal) {
      bpmEl.innerHTML = `-- <span class="ecg-metric__unit">bpm</span>`;
      bpmEl.style.color = 'var(--muted)';
      statusEl.textContent = 'Waiting for signal...';
      statusEl.style.color = 'var(--muted)';
      return;
    }

    const rounded = Math.round(bpm);
    bpmEl.innerHTML = `${rounded} <span class="ecg-metric__unit">bpm</span>`;

    if (rounded < 60) {
      // Bradycardia (<60) -> blue #4fc3f7
      bpmEl.style.color = '#4fc3f7';
      statusEl.textContent = '⚠ Bradycardia';
      statusEl.style.color = '#4fc3f7';
    } else if (rounded <= 100) {
      // Normal (60-100) -> green #00ff88
      bpmEl.style.color = '#00ff88';
      statusEl.textContent = 'Normal ✓';
      statusEl.style.color = '#00ff88';
    } else {
      // Tachycardia (>100) -> red #ff6b6b
      bpmEl.style.color = '#ff6b6b';
      statusEl.textContent = '⚠ Tachycardia';
      statusEl.style.color = '#ff6b6b';
    }
  }

  function setConnectionState(state) {
    if (state === 'connected') {
      if (linkStatus) linkStatus.textContent = 'Connected';
      if (linkStatus) linkStatus.style.color = '#00ff88';
      if (liveDot) liveDot.className = 'live-dot';
      if (ecgState && !isPaused) ecgState.textContent = 'Waiting for signal...';
    } else if (state === 'streaming') {
      if (linkStatus) linkStatus.textContent = 'Streaming';
      if (linkStatus) linkStatus.style.color = '#00ff88';
      if (liveDot) liveDot.className = 'live-dot active';
      if (ecgState && !isPaused) ecgState.textContent = 'Live';
    } else {
      // Offline / disconnected
      if (linkStatus) linkStatus.textContent = 'Device offline';
      if (linkStatus) linkStatus.style.color = '#ff6b6b';
      if (liveDot) liveDot.className = 'live-dot offline';
      if (ecgState && !isPaused) ecgState.textContent = 'Device offline';
      if (statusEl) {
        statusEl.textContent = 'Device offline';
        statusEl.style.color = 'var(--muted)';
      }
    }
  }

  function connectWs() {
    if (ws) {
      try { ws.close(); } catch (_) {}
    }

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        window._nurasenseWs = ws;
        setConnectionState('connected');
        if (window._nurasenseLocation) {
          try {
            ws.send(JSON.stringify({
              type: 'location',
              location: window._nurasenseLocation
            }));
          } catch (_) {}
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const rawBatch = data.raw_samples || data.samples;
          const filteredBatch = data.filtered_samples;

          // Update live Raw ADC level readout
          if (rawAdcEl && rawBatch && rawBatch.length > 0) {
            const latestRaw = Math.round(rawBatch[rawBatch.length - 1]);
            rawAdcEl.innerHTML = `${latestRaw} <span class="ecg-metric__unit">cts</span>`;
          }

          const currentBatch = (displayMode === 'filtered' && filteredBatch) ? filteredBatch : rawBatch;

          if (currentBatch && Array.isArray(currentBatch)) {
            isReceivingSignal = true;
            lastSignalTime = Date.now();

            // Shift new batch of samples into rolling buffer
            for (let i = 0; i < currentBatch.length; i++) {
              samples[sampleIndex] = currentBatch[i];
              sampleIndex = (sampleIndex + 1) % BUFFER_SIZE;
            }

            if (data.leads_off && displayMode === 'filtered') {
              if (linkStatus) {
                linkStatus.textContent = 'Leads Off';
                linkStatus.style.color = '#ffa726';
              }
              if (liveDot) liveDot.className = 'live-dot warning';
              if (ecgState && !isPaused) ecgState.textContent = 'Attach Electrodes';
              updateBpmDisplay(0, true);
            } else {
              setConnectionState('streaming');
              if (data.bpm !== undefined && data.bpm !== null) {
                currentBpm = data.bpm;
                updateBpmDisplay(currentBpm, false);
              }
            }

            // Potassium handling from WebSocket (Live Real-Time Inference)
            if (!data.leads_off && data.potassium) {
              const k = data.potassium;
              dashState.potassium = Number(k.mmol);
              const now = new Date();
              const dStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              const tStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
              dashState.lastKTime = `${dStr} · ${tStr}`;
              dashState.kSource = 'ecg-ml';

              // Prepend live prediction to real readings list
              dashState.kReadings.unshift({
                when: `${dStr} · ${tStr}`,
                value: Number(k.mmol),
                risk: k.risk
              });
              if (dashState.kReadings.length > 20) dashState.kReadings.pop();

              // Append to real trending series
              dashState.kSeries.push(Number(k.mmol));
              if (dashState.kSeries.length > 20) dashState.kSeries.shift();

              // Update all UI elements with real recorded telemetry
              renderK();

              // If alert: show danger toast and bump risk score
              if (k.alert) {
                showToast(`⚠️ Low potassium detected: ${Number(k.mmol).toFixed(1)} mmol/L — ECG suggests hypokalemia`, 'danger');
                dashState.riskScore = Math.min(100, (dashState.riskScore || 0) + 15);
              }
            }

            // Real-time Emergency Alert System Trigger
            if (data.alert_triggered) {
              triggerLiveCriticalAlert(data.potassium?.mmol);
              fetchAlertHistory(userId);
            }
          }
        } catch (err) {}
      };

      ws.onclose = () => {
        isReceivingSignal = false;
        setConnectionState('offline');
        // Auto-reconnect WebSocket every 3s on disconnect
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectWs, 3000);
      };

      ws.onerror = () => {
        try { ws.close(); } catch (_) {}
      };

    } catch (e) {
      setConnectionState('offline');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWs, 3000);
    }
  }

  // High-performance 250Hz ECG Canvas Renderer (updates every ~40ms / 60 FPS)
  let lastDrawTime = 0;
  function renderEcgWaveform(timestamp) {
    animFrameId = requestAnimationFrame(renderEcgWaveform);

    if (isPaused || !canvas) return;

    // Rate-limit redraw to ~40ms (25 FPS is sufficient and smooth)
    if (timestamp - lastDrawTime < 38) return;
    lastDrawTime = timestamp;

    // Signal timeout: if no samples in 6 seconds (ONLY when tab is visible)
    if (!document.hidden && isReceivingSignal && Date.now() - lastSignalTime > 6000) {
      isReceivingSignal = false;
      if (ecgState) ecgState.textContent = 'Waiting for signal...';
      updateBpmDisplay(0);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const midY = height / 2;

    // 1. Dark Medical Background #0d1117
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    // 2. Clinical ECG Grid (major & minor subdivisions)
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.05)';
    ctx.beginPath();
    const smallStep = 10;
    for (let x = 0; x < width; x += smallStep) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += smallStep) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 255, 136, 0.12)';
    ctx.beginPath();
    const bigStep = 50;
    for (let x = 0; x < width; x += bigStep) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += bigStep) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // 3. Draw Green ECG Waveform #00ff88
    ctx.save();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#00ff88';
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 8;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const dx = width / BUFFER_SIZE;
    const scaleY = (height / 2) * 0.86;

    // In Raw ADC mode, calculate rolling baseline and dynamic span across current buffer
    let minRaw = Infinity;
    let maxRaw = -Infinity;
    let sumRaw = 0;
    let countRaw = 0;
    if (displayMode === 'raw') {
      for (let j = 0; j < BUFFER_SIZE; j++) {
        const val = samples[j];
        if (val > 0) {
          if (val < minRaw) minRaw = val;
          if (val > maxRaw) maxRaw = val;
          sumRaw += val;
          countRaw++;
        }
      }
    }
    const baseline = countRaw > 10 ? (sumRaw / countRaw) : 2048;
    const dynamicSpan = countRaw > 10 ? (maxRaw - minRaw) : 400;
    // Effective span: at least 250 ADC counts tall so ambient noise doesn't blow up
    const effectiveSpan = Math.max(250, dynamicSpan * 1.15);

    for (let i = 0; i < BUFFER_SIZE; i++) {
      // Circular read relative to current sampleIndex for continuous scrolling
      const readIdx = (sampleIndex + i) % BUFFER_SIZE;
      let rawVal = samples[readIdx];

      let y;
      if (displayMode === 'raw') {
        // Direct Raw ADC stream from ESP32:
        // Centered around moving baseline, inverted so physiological R-peaks spike upwards
        const delta = (rawVal - baseline) * -1.0;
        const normalized = delta / (effectiveSpan * 0.55);
        y = midY - (normalized * (height / 2) * 0.85);
      } else {
        // 5-point binomial smoothing filter (eliminates fine DAC/EMG ripple while preserving sharp R-peak needles)
        if (i >= 2 && i < BUFFER_SIZE - 2) {
          const im2 = (sampleIndex + i - 2) % BUFFER_SIZE;
          const im1 = (sampleIndex + i - 1) % BUFFER_SIZE;
          const ip1 = (sampleIndex + i + 1) % BUFFER_SIZE;
          const ip2 = (sampleIndex + i + 2) % BUFFER_SIZE;
          rawVal = 0.06 * samples[im2] + 0.24 * samples[im1] + 0.40 * rawVal + 0.24 * samples[ip1] + 0.06 * samples[ip2];
        }

        // Enhanced gain (1.9x) with soft hyperbolic tangent ceiling: R-peaks spike tall without rail clipping
        const normalizedVal = Math.tanh(rawVal * 1.85);
        y = midY - (normalizedVal * scaleY);
      }

      const clampedY = Math.max(4, Math.min(height - 4, y));
      const x = i * dx;

      if (i === 0) {
        ctx.moveTo(x, clampedY);
      } else {
        ctx.lineTo(x, clampedY);
      }
    }
    ctx.stroke();
    ctx.restore();

    // 4. Sweep line / Cursor indicator at leading edge
    const cursorX = width - 4;
    ctx.fillStyle = 'rgba(0, 255, 136, 0.8)';
    ctx.fillRect(cursorX, 0, 2, height);
  }

  // Handle tab switching & window blur/focus so streaming never freezes or resets
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      lastDrawTime = performance.now();
      lastSignalTime = Date.now();
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        connectWs();
      }
      fetchKHistory();
      fetchAlertHistory();
      fetchEmergencyContacts();
      captureLocation();
    }
  };

  const onWindowFocus = () => {
    lastDrawTime = performance.now();
    lastSignalTime = Date.now();
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      connectWs();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onWindowFocus);

  // Start WebSocket connection, fetch latest recorded telemetry & render loop
  connectWs();
  fetchKHistory(userId);
  fetchAlertHistory(userId);
  fetchEmergencyContacts(userId);
  captureLocation();
  animFrameId = requestAnimationFrame(renderEcgWaveform);

  // Return teardown function if needed
  return () => {
    if (ws) ws.close();
    clearTimeout(reconnectTimer);
    if (animFrameId) cancelAnimationFrame(animFrameId);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onWindowFocus);
  };
}

