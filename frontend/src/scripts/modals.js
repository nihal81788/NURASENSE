/**
 * NuraSense — Accessible Modal Dialogs & Toast Notifications
 * Handles Patient Sign-in, Potassium logging, Symptom check, and Care messages
 */

export function visible(el) {
  return !!(el && el.offsetParent !== null);
}

export function setError(input, errorEl, message) {
  if (!errorEl) return;
  if (message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    input.setAttribute('aria-invalid', 'true');
  } else {
    errorEl.textContent = '';
    errorEl.hidden = true;
    input.removeAttribute('aria-invalid');
  }
}

export function showToast(message) {
  const appToast = document.getElementById('appToast');
  const appToastText = document.getElementById('appToastText');
  if (!appToast || !appToastText) return;
  appToastText.textContent = message;
  appToast.hidden = false;
  if (window._nuraToastTimer) clearTimeout(window._nuraToastTimer);
  window._nuraToastTimer = setTimeout(function () {
    appToast.hidden = true;
  }, 3200);
}

export function initialsFrom(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'PT';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function displayNameFromEmail(email) {
  if (email.trim().toLowerCase() === 'patient@nurasense.app') return 'Maya Roberts';
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  if (!local) return 'Patient';
  return local.split(' ').map(function (part) {
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}

export function focusAfterClose(opener, fallback) {
  let target = opener;
  if (!target || !visible(target)) target = fallback;
  if (target && visible(target)) target.focus();
}

export function currentTimeValue() {
  const now = new Date();
  return ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
}
