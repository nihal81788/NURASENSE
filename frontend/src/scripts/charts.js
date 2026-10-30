/**
 * NuraSense — SVG Telemetry Charts Engine
 * Pure SVG vector rendering for Potassium curve & Autonomic Trend charts
 */

export function svgNode(tag, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs || {}).forEach(function (key) {
    node.setAttribute(key, attrs[key]);
  });
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clearNode(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function drawKChart(kChart, kSeries) {
  if (!kChart) return;
  const data = kSeries;
  clearNode(kChart);
  const W = 360, H = 132, L = 26, R = 12, T = 12, B = 22;
  const min = 2.8, max = 5.6;
  function x(i) { return L + (W - L - R) * (i / (data.length - 1)); }
  function y(v) { return T + ((max - v) / (max - min)) * (H - T - B); }

  kChart.appendChild(svgNode('rect', {
    class: 'band',
    x: L,
    y: y(5.1),
    width: W - L - R,
    height: Math.max(1, y(3.5) - y(5.1)),
    rx: 3
  }));
  kChart.appendChild(svgNode('text', { class: 'band-label', x: L + 4, y: y(5.1) - 3 }, '3.5–5.1'));

  [3.5, 5.1].forEach(function (value) {
    kChart.appendChild(svgNode('line', { class: 'grid', x1: L, x2: W - R, y1: y(value), y2: y(value) }));
    kChart.appendChild(svgNode('text', { class: 'axis', x: L - 4, y: y(value) + 3, 'text-anchor': 'end' }, value.toFixed(1)));
  });

  kChart.appendChild(svgNode('text', { class: 'axis', x: L, y: H - 6 }, '14 days ago'));
  kChart.appendChild(svgNode('text', { class: 'axis', x: W - R, y: H - 6, 'text-anchor': 'end' }, 'Today'));

  const d = data.map(function (value, index) {
    return (index === 0 ? 'M' : 'L') + x(index).toFixed(1) + ' ' + y(value).toFixed(1);
  }).join(' ');
  kChart.appendChild(svgNode('path', { class: 'line', d: d }));

  data.forEach(function (value, index) {
    if (index === data.length - 1) return;
    kChart.appendChild(svgNode('circle', { class: 'dot', cx: x(index).toFixed(1), cy: y(value).toFixed(1), r: 1.5, opacity: .5 }));
  });

  const last = data[data.length - 1];
  kChart.appendChild(svgNode('circle', { class: 'dot dot--latest', cx: x(data.length - 1).toFixed(1), cy: y(last).toFixed(1), r: 3.6 }));
  kChart.setAttribute('aria-label', 'Potassium over the last 14 days, latest ' + last.toFixed(1) + ' millimoles per litre');
}

export function drawTrend(trendChart, trendRange, TREND_DATA) {
  const data = TREND_DATA[trendRange];
  if (!data || !trendChart) return;
  clearNode(trendChart);
  const W = 720, H = 220, L = 36, R = 42, T = 16, B = 30;
  const n = data.hr.length;
  function x(i) { return L + (W - L - R) * (i / (n - 1)); }
  function yHR(v) { return T + ((110 - v) / 50) * (H - T - B); }
  function yHRV(v) { return T + ((55 - v) / 35) * (H - T - B); }

  [60, 80, 100].forEach(function (value) {
    trendChart.appendChild(svgNode('line', { class: 'trend-grid', x1: L, x2: W - R, y1: yHR(value), y2: yHR(value) }));
    trendChart.appendChild(svgNode('text', { class: 'trend-axis', x: L - 5, y: yHR(value) + 3, 'text-anchor': 'end' }, value));
  });
  trendChart.appendChild(svgNode('text', { class: 'trend-axis', x: L - 5, y: T - 3, 'text-anchor': 'end' }, 'bpm'));
  trendChart.appendChild(svgNode('text', { class: 'trend-axis', x: W - R + 5, y: T - 3 }, 'HRV ms'));

  data.ticks.forEach(function (index, i) {
    trendChart.appendChild(svgNode('text', { class: 'trend-axis', x: x(index), y: H - 8, 'text-anchor': index === 0 ? 'start' : index === n - 1 ? 'end' : 'middle' }, data.tickLabels[i]));
  });

  const hrvPath = data.hrv.map(function (value, index) {
    return (index === 0 ? 'M' : 'L') + x(index).toFixed(1) + ' ' + yHRV(value).toFixed(1);
  }).join(' ');
  const hrPath = data.hr.map(function (value, index) {
    return (index === 0 ? 'M' : 'L') + x(index).toFixed(1) + ' ' + yHR(value).toFixed(1);
  }).join(' ');

  trendChart.appendChild(svgNode('path', { class: 'trend-hrv', d: hrvPath }));
  trendChart.appendChild(svgNode('path', { class: 'trend-hr', d: hrPath }));

  data.events.forEach(function (event) {
    const cx = x(event.i);
    const cy = yHR(data.hr[event.i]);
    trendChart.appendChild(svgNode('circle', { class: 'trend-anno', cx: cx, cy: cy, r: 3.4 }));
    const anchor = cx > W - 150 ? 'end' : 'start';
    trendChart.appendChild(svgNode('text', {
      class: 'trend-anno-label',
      x: anchor === 'end' ? cx - 7 : cx + 7,
      y: Math.max(14, cy - 8),
      'text-anchor': anchor
    }, event.label));
  });

  const hrvValues = data.hrv;
  const hrvMin = Math.min(...hrvValues);
  const hrvMax = Math.max(...hrvValues);
  trendChart.setAttribute('aria-label', 'Heart rate from ' + Math.min(...data.hr) + ' to ' + Math.max(...data.hr) + ' beats per minute, and HRV from ' + hrvMin + ' to ' + hrvMax + ' milliseconds, over the selected ' + trendRange + ' range');
}
