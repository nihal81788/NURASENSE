/**
 * NuraSense — Application Entry Point
 * Orchestrates Landing interactions, Patient Dashboard state, and Modal Authentication
 */

import '../styles/main.css';
import { initLandingInteractions } from './landing.js';
import {
  initDashboardListeners,
  initLiveTelemetryStream,
  renderAll,
  updateDashIdentity,
  updateDashDate,
  dashState,
  closePopovers,
  setActiveNav
} from './dashboard.js';
import {
  setError,
  displayNameFromEmail,
  initialsFrom,
  visible,
  showToast
} from './modals.js';

const DEMO_EMAIL = 'patient@nurasense.app';
const DEMO_PASSWORD = 'nura-demo';
const ORIGINAL_TITLE = document.title;

const authState = {
  signedIn: false,
  name: '',
  email: ''
};

let lastLoginTrigger = null;
let pendingTimer = null;

function renderHeader() {
  const signedInCluster = document.getElementById('signedInCluster');
  const headerLogin = document.getElementById('headerLogin');
  const headerName = document.getElementById('headerName');
  const headerAvatar = document.getElementById('headerAvatar');
  const whoami = document.getElementById('whoami');
  const loginLabels = document.querySelectorAll('.js-login-label');

  if (signedInCluster) signedInCluster.hidden = !authState.signedIn;
  if (headerLogin) headerLogin.hidden = authState.signedIn;
  loginLabels.forEach((label) => {
    label.textContent = authState.signedIn ? 'Your account' : 'Patient login';
  });
  if (authState.signedIn) {
    if (headerName) headerName.textContent = authState.name;
    if (headerAvatar) headerAvatar.textContent = initialsFrom(authState.name);
    if (whoami) whoami.textContent = authState.name;
  }
}

function syncPanels() {
  const loginPanel = document.getElementById('loginPanel');
  const successPanel = document.getElementById('successPanel');
  const dialog = document.getElementById('loginDialog');

  if (loginPanel) loginPanel.hidden = authState.signedIn;
  if (successPanel) successPanel.hidden = !authState.signedIn;
  if (dialog) {
    dialog.setAttribute('aria-labelledby', authState.signedIn ? 'successTitle' : 'loginTitle');
  }
}

function resetForm() {
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const passwordToggle = document.getElementById('passwordToggle');
  const eyeOpen = passwordToggle?.querySelector('.js-eye-open');
  const eyeClosed = passwordToggle?.querySelector('.js-eye-closed');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const submitBtn = document.getElementById('submitBtn');
  const submitLabel = document.getElementById('submitLabel');
  const spinner = document.getElementById('spinner');
  const googleBtn = document.getElementById('googleBtn');
  const googleLabel = document.getElementById('googleLabel');
  const googleSpinner = document.getElementById('googleSpinner');
  const rememberInput = document.getElementById('remember');

  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  if (form) form.reset();
  if (emailInput) {
    emailInput.readOnly = false;
    setError(emailInput, emailError, '');
  }
  if (passwordInput) {
    passwordInput.readOnly = false;
    passwordInput.type = 'password';
    setError(passwordInput, passwordError, '');
  }
  if (passwordToggle) {
    passwordToggle.setAttribute('aria-pressed', 'false');
    passwordToggle.setAttribute('aria-label', 'Show password');
  }
  if (eyeOpen) eyeOpen.hidden = false;
  if (eyeClosed) eyeClosed.hidden = true;
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.removeAttribute('aria-busy');
  }
  if (submitLabel) submitLabel.textContent = 'Sign in';
  if (spinner) spinner.hidden = true;
  if (googleBtn) {
    googleBtn.disabled = false;
    googleBtn.removeAttribute('aria-busy');
  }
  if (googleLabel) googleLabel.textContent = 'Continue with Google';
  if (googleSpinner) googleSpinner.hidden = true;
  if (rememberInput) rememberInput.checked = true;
}

export function openLoginDialog(trigger) {
  const dialog = document.getElementById('loginDialog');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');

  lastLoginTrigger = trigger || null;
  if (!authState.signedIn) {
    if (emailInput && !emailInput.value.trim()) setError(emailInput, emailError, '');
    if (passwordInput && !passwordInput.value) setError(passwordInput, passwordError, '');
  }
  syncPanels();
  if (dialog && typeof dialog.showModal === 'function' && !dialog.open) {
    dialog.showModal();
  }
  window.requestAnimationFrame(() => {
    if (authState.signedIn) {
      const successTitle = document.getElementById('successTitle');
      if (successTitle) successTitle.focus();
    } else if (emailInput && !emailInput.value) {
      emailInput.focus();
    } else if (passwordInput) {
      passwordInput.focus();
    }
  });
}

export function closeLoginDialog() {
  const dialog = document.getElementById('loginDialog');
  if (dialog && dialog.open) dialog.close();
}

export function openDashboard(trigger) {
  const dashboardApp = document.getElementById('dashboardApp');
  const siteHeader = document.querySelector('.site-header');
  const siteMain = document.getElementById('main');
  const siteFooter = document.querySelector('.site-footer');
  const siteSkip = document.querySelector('.skip-link');
  const dashGreeting = document.getElementById('dashGreeting');

  dashState.lastTrigger = trigger || null;
  dashState.homeScroll = window.scrollY;

  if (!authState.signedIn) {
    authState.signedIn = true;
    authState.name = 'Maya Roberts';
    authState.email = DEMO_EMAIL;
  }
  renderHeader();
  syncPanels();
  closeLoginDialog();
  closePopovers();

  if (dashboardApp) dashboardApp.hidden = false;
  if (siteHeader) siteHeader.hidden = true;
  if (siteMain) siteMain.hidden = true;
  if (siteFooter) siteFooter.hidden = true;
  if (siteSkip) siteSkip.hidden = true;

  document.body.classList.add('app-mode');
  document.title = 'Patient dashboard · NuraSense';

  updateDashIdentity(authState.name);
  updateDashDate();
  renderAll();

  window.scrollTo(0, 0);
  setActiveNav('dash-overview');

  window.setTimeout(() => {
    if (dashGreeting) dashGreeting.focus({ preventScroll: true });
  }, 80);
}

export function exitDashboard() {
  const dashboardApp = document.getElementById('dashboardApp');
  const siteHeader = document.querySelector('.site-header');
  const siteMain = document.getElementById('main');
  const siteFooter = document.querySelector('.site-footer');
  const siteSkip = document.querySelector('.skip-link');
  const appToast = document.getElementById('appToast');
  const headerDashboard = document.getElementById('headerDashboard');
  const previewDashboardBtn = document.getElementById('previewDashboardBtn');

  closePopovers();
  if (appToast) appToast.hidden = true;
  if (dashboardApp) dashboardApp.hidden = true;

  document.body.classList.remove('app-mode');
  if (siteHeader) siteHeader.hidden = false;
  if (siteMain) siteMain.hidden = false;
  if (siteFooter) siteFooter.hidden = false;
  if (siteSkip) siteSkip.hidden = false;

  document.title = ORIGINAL_TITLE;
  window.scrollTo(0, dashState.homeScroll || 0);

  let target = dashState.lastTrigger;
  if (!target || !visible(target)) {
    target = authState.signedIn ? headerDashboard : previewDashboardBtn;
  }
  if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  dashState.lastTrigger = null;
}

function initAuthModalListeners() {
  const dialog = document.getElementById('loginDialog');
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const submitBtn = document.getElementById('submitBtn');
  const submitLabel = document.getElementById('submitLabel');
  const spinner = document.getElementById('spinner');
  const passwordToggle = document.getElementById('passwordToggle');
  const eyeOpen = passwordToggle?.querySelector('.js-eye-open');
  const eyeClosed = passwordToggle?.querySelector('.js-eye-closed');
  const dialogClose = document.getElementById('dialogClose');
  const demoBtn = document.getElementById('demoBtn');
  const googleBtn = document.getElementById('googleBtn');
  const googleLabel = document.getElementById('googleLabel');
  const googleSpinner = document.getElementById('googleSpinner');
  const doneBtn = document.getElementById('doneBtn');
  const signOutBtn = document.getElementById('signOutBtn');
  const headerSignOut = document.getElementById('headerSignOut');
  const headerLogin = document.getElementById('headerLogin');
  const loginTriggers = document.querySelectorAll('.js-login');

  function validateEmail() {
    const val = emailInput?.value.trim() || '';
    if (!val) {
      setError(emailInput, emailError, 'Enter the email address for your patient account.');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val)) {
      setError(emailInput, emailError, 'Use a full address, like name@example.com.');
      return false;
    }
    setError(emailInput, emailError, '');
    return true;
  }

  function validatePassword() {
    const val = passwordInput?.value || '';
    if (!val) {
      setError(passwordInput, passwordError, 'Enter your password.');
      return false;
    }
    if (val.length < 6) {
      setError(passwordInput, passwordError, 'Passwords are at least 6 characters.');
      return false;
    }
    setError(passwordInput, passwordError, '');
    return true;
  }

  loginTriggers.forEach((trigger) => {
    trigger.addEventListener('click', () => openLoginDialog(trigger));
  });

  if (dialogClose) dialogClose.addEventListener('click', closeLoginDialog);
  if (dialog) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeLoginDialog();
    });
    dialog.addEventListener('close', () => {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
        resetForm();
      }
    });
  }

  if (emailInput) {
    emailInput.addEventListener('blur', validateEmail);
    emailInput.addEventListener('input', () => {
      if (emailInput.getAttribute('aria-invalid') === 'true') validateEmail();
    });
  }

  if (passwordInput) {
    passwordInput.addEventListener('blur', validatePassword);
    passwordInput.addEventListener('input', () => {
      if (passwordInput.getAttribute('aria-invalid') === 'true') validatePassword();
    });
  }

  if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener('click', () => {
      const showing = passwordInput.type === 'text';
      passwordInput.type = showing ? 'password' : 'text';
      passwordToggle.setAttribute('aria-pressed', showing ? 'false' : 'true');
      passwordToggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      if (eyeOpen) eyeOpen.hidden = !showing;
      if (eyeClosed) eyeClosed.hidden = showing;
      passwordInput.focus();
    });
  }

  if (demoBtn && emailInput && passwordInput) {
    demoBtn.addEventListener('click', () => {
      emailInput.value = DEMO_EMAIL;
      passwordInput.value = DEMO_PASSWORD;
      setError(emailInput, emailError, '');
      setError(passwordInput, passwordError, '');
      if (submitBtn) submitBtn.focus();
    });
  }

  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      if (googleBtn.disabled || submitBtn?.disabled) return;
      setError(emailInput, emailError, '');
      setError(passwordInput, passwordError, '');
      googleBtn.disabled = true;
      googleBtn.setAttribute('aria-busy', 'true');
      if (googleLabel) googleLabel.textContent = 'Connecting to Google…';
      if (googleSpinner) googleSpinner.hidden = false;

      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        authState.signedIn = true;
        authState.name = 'Maya Roberts';
        authState.email = DEMO_EMAIL;
        renderHeader();
        syncPanels();
        resetForm();
        const successTitle = document.getElementById('successTitle');
        if (successTitle) successTitle.focus();
      }, 900);
    });
  }

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submitBtn?.disabled || googleBtn?.disabled) return;

      const emailOk = validateEmail();
      const passwordOk = validatePassword();
      if (!emailOk || !passwordOk) {
        if (!emailOk && emailInput) emailInput.focus();
        else if (passwordInput) passwordInput.focus();
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-busy', 'true');
      }
      if (submitLabel) submitLabel.textContent = 'Signing you in…';
      if (spinner) spinner.hidden = false;
      if (googleBtn) googleBtn.disabled = true;
      if (emailInput) emailInput.readOnly = true;
      if (passwordInput) passwordInput.readOnly = true;

      const submittedEmail = emailInput?.value.trim() || '';

      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        authState.signedIn = true;
        authState.email = submittedEmail;
        authState.name = displayNameFromEmail(submittedEmail);
        renderHeader();
        syncPanels();
        resetForm();
        const successTitle = document.getElementById('successTitle');
        if (successTitle) successTitle.focus();
      }, 800);
    });
  }

  if (doneBtn) {
    doneBtn.addEventListener('click', () => openDashboard(doneBtn));
  }

  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      authState.signedIn = false;
      authState.name = '';
      authState.email = '';
      renderHeader();
      syncPanels();
      resetForm();
      closeLoginDialog();
      if (headerLogin) setTimeout(() => headerLogin.focus(), 60);
    });
  }

  if (headerSignOut) {
    headerSignOut.addEventListener('click', () => {
      authState.signedIn = false;
      authState.name = '';
      authState.email = '';
      renderHeader();
      syncPanels();
      if (headerLogin) headerLogin.focus();
    });
  }
}

function initAppRouting() {
  const previewDashboardBtn = document.getElementById('previewDashboardBtn');
  const headerDashboard = document.getElementById('headerDashboard');
  const exitBtns = document.querySelectorAll('[data-exit-dashboard]');

  if (previewDashboardBtn) {
    previewDashboardBtn.addEventListener('click', () => openDashboard(previewDashboardBtn));
  }
  if (headerDashboard) {
    headerDashboard.addEventListener('click', () => openDashboard(headerDashboard));
  }
  exitBtns.forEach((btn) => {
    btn.addEventListener('click', exitDashboard);
  });

  // Global keybindings: Escape to exit or close modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePopovers();
    }
  });
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  initLandingInteractions();
  initAuthModalListeners();
  initDashboardListeners();
  initLiveTelemetryStream();
  initAppRouting();
  renderHeader();
});
