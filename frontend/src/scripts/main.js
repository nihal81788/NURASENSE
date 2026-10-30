/**
 * NuraSense — Application Entry Point
 * Orchestrates Landing interactions, Patient Dashboard state, and Modal Authentication
 */

import '../styles/main.css';
import { supabase } from './supabase.js';
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
  email: '',
  token: ''
};

let currentAuthMode = 'signin'; // 'signin' | 'signup' | 'otp'
let pendingSignup = {
  name: '',
  email: '',
  password: '',
  previewOtp: ''
};
let otpTimerInterval = null;
let otpExpiresSeconds = 600;
let lastLoginTrigger = null;
let pendingTimer = null;

// Persistent session storage helper
function saveSession(user, token) {
  try {
    localStorage.setItem('nurasense_session', JSON.stringify({
      user,
      token,
      timestamp: Date.now()
    }));
  } catch (_) {}
}

function clearSession() {
  try {
    localStorage.removeItem('nurasense_session');
  } catch (_) {}
}

async function loadStoredSession() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) {
      const u = data.session.user;
      authState.signedIn = true;
      authState.name = u.user_metadata?.name || u.user_metadata?.full_name || displayNameFromEmail(u.email);
      authState.email = u.email || '';
      authState.token = data.session.access_token || '';
      renderHeader();
      return;
    }

    const raw = localStorage.getItem('nurasense_session');
    if (raw) {
      const data = JSON.parse(raw);
      if (data?.user?.name) {
        authState.signedIn = true;
        authState.name = data.user.name;
        authState.email = data.user.email || '';
        authState.token = data.token || '';
        renderHeader();
      }
    }
  } catch (_) {}
}

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

export function switchAuthMode(mode) {
  currentAuthMode = mode;
  const authTabs = document.getElementById('authTabs');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const loginPanel = document.getElementById('loginPanel');
  const signupPanel = document.getElementById('signupPanel');
  const otpPanel = document.getElementById('otpPanel');
  const successPanel = document.getElementById('successPanel');
  const dialog = document.getElementById('loginDialog');

  if (authState.signedIn) {
    if (authTabs) authTabs.hidden = true;
    if (loginPanel) loginPanel.hidden = true;
    if (signupPanel) signupPanel.hidden = true;
    if (otpPanel) otpPanel.hidden = true;
    if (successPanel) successPanel.hidden = false;
    if (dialog) dialog.setAttribute('aria-labelledby', 'successTitle');
    return;
  }

  if (successPanel) successPanel.hidden = true;

  if (mode === 'signin') {
    if (authTabs) authTabs.hidden = false;
    tabSignIn?.classList.add('active');
    tabSignIn?.setAttribute('aria-selected', 'true');
    tabSignUp?.classList.remove('active');
    tabSignUp?.setAttribute('aria-selected', 'false');
    if (loginPanel) loginPanel.hidden = false;
    if (signupPanel) signupPanel.hidden = true;
    if (otpPanel) otpPanel.hidden = true;
    if (dialog) dialog.setAttribute('aria-labelledby', 'loginTitle');
  } else if (mode === 'signup') {
    if (authTabs) authTabs.hidden = false;
    tabSignUp?.classList.add('active');
    tabSignUp?.setAttribute('aria-selected', 'true');
    tabSignIn?.classList.remove('active');
    tabSignIn?.setAttribute('aria-selected', 'false');
    if (loginPanel) loginPanel.hidden = true;
    if (signupPanel) signupPanel.hidden = false;
    if (otpPanel) otpPanel.hidden = true;
    if (dialog) dialog.setAttribute('aria-labelledby', 'signupTitle');
  } else if (mode === 'otp') {
    if (authTabs) authTabs.hidden = true;
    if (loginPanel) loginPanel.hidden = true;
    if (signupPanel) signupPanel.hidden = true;
    if (otpPanel) otpPanel.hidden = false;
    if (dialog) dialog.setAttribute('aria-labelledby', 'otpTitle');
  }
}

function syncPanels() {
  switchAuthMode(currentAuthMode);
}

function startOtpCountdown(seconds = 600) {
  if (otpTimerInterval) clearInterval(otpTimerInterval);
  otpExpiresSeconds = seconds;
  const timerEl = document.getElementById('otpTimer');

  const tick = () => {
    const mins = Math.floor(otpExpiresSeconds / 60);
    const secs = otpExpiresSeconds % 60;
    const formatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    if (timerEl) {
      timerEl.innerHTML = `Expires in: <strong>${formatted}</strong>`;
      timerEl.style.color = otpExpiresSeconds <= 60 ? '#B4452C' : '';
    }
    if (otpExpiresSeconds <= 0) {
      clearInterval(otpTimerInterval);
      if (timerEl) timerEl.innerHTML = `<span style="color:#B4452C">Code expired. Please click Resend Code.</span>`;
    }
    otpExpiresSeconds--;
  };

  tick();
  otpTimerInterval = setInterval(tick, 1000);
}

function stopOtpCountdown() {
  if (otpTimerInterval) {
    clearInterval(otpTimerInterval);
    otpTimerInterval = null;
  }
}

function resetForm() {
  const form = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const otpForm = document.getElementById('otpForm');

  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const submitBtn = document.getElementById('submitBtn');
  const submitLabel = document.getElementById('submitLabel');
  const spinner = document.getElementById('spinner');

  const signupName = document.getElementById('signupName');
  const signupEmail = document.getElementById('signupEmail');
  const signupPassword = document.getElementById('signupPassword');
  const signupNameError = document.getElementById('signupNameError');
  const signupEmailError = document.getElementById('signupEmailError');
  const signupPasswordError = document.getElementById('signupPasswordError');
  const signupSubmitBtn = document.getElementById('signupSubmitBtn');
  const signupSubmitLabel = document.getElementById('signupSubmitLabel');
  const signupSpinner = document.getElementById('signupSpinner');

  const otpDigits = [1, 2, 3, 4, 5, 6].map(i => document.getElementById(`otp${i}`));
  const otpError = document.getElementById('otpError');
  const verifyOtpBtn = document.getElementById('verifyOtpBtn');
  const verifyOtpLabel = document.getElementById('verifyOtpLabel');
  const verifyOtpSpinner = document.getElementById('verifyOtpSpinner');

  const googleBtn = document.getElementById('googleBtn');
  const googleLabel = document.getElementById('googleLabel');
  const googleSpinner = document.getElementById('googleSpinner');
  const googleSignupBtn = document.getElementById('googleSignupBtn');
  const googleSignupLabel = document.getElementById('googleSignupLabel');
  const googleSignupSpinner = document.getElementById('googleSignupSpinner');

  stopOtpCountdown();

  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  if (form) form.reset();
  if (signupForm) signupForm.reset();
  if (otpForm) otpForm.reset();

  otpDigits.forEach(input => {
    if (input) {
      input.value = '';
      input.classList.remove('error');
    }
  });

  if (emailInput) {
    emailInput.readOnly = false;
    setError(emailInput, emailError, '');
  }
  if (passwordInput) {
    passwordInput.readOnly = false;
    passwordInput.type = 'password';
    setError(passwordInput, passwordError, '');
  }
  if (signupName) setError(signupName, signupNameError, '');
  if (signupEmail) setError(signupEmail, signupEmailError, '');
  if (signupPassword) setError(signupPassword, signupPasswordError, '');
  if (otpError) setError({ removeAttribute: () => {} }, otpError, '');

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.removeAttribute('aria-busy');
  }
  if (submitLabel) submitLabel.textContent = 'Sign in';
  if (spinner) spinner.hidden = true;

  if (signupSubmitBtn) {
    signupSubmitBtn.disabled = false;
    signupSubmitBtn.removeAttribute('aria-busy');
  }
  if (signupSubmitLabel) signupSubmitLabel.textContent = 'Send Verification Code';
  if (signupSpinner) signupSpinner.hidden = true;

  if (verifyOtpBtn) {
    verifyOtpBtn.disabled = false;
    verifyOtpBtn.removeAttribute('aria-busy');
  }
  if (verifyOtpLabel) verifyOtpLabel.textContent = 'Verify & Create Account';
  if (verifyOtpSpinner) verifyOtpSpinner.hidden = true;

  if (googleBtn) {
    googleBtn.disabled = false;
    googleBtn.removeAttribute('aria-busy');
  }
  if (googleLabel) googleLabel.textContent = 'Continue with Google';
  if (googleSpinner) googleSpinner.hidden = true;

  if (googleSignupBtn) {
    googleSignupBtn.disabled = false;
    googleSignupBtn.removeAttribute('aria-busy');
  }
  if (googleSignupLabel) googleSignupLabel.textContent = 'Sign up with Google';
  if (googleSignupSpinner) googleSignupSpinner.hidden = true;
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
  const dialogClose = document.getElementById('dialogClose');

  // Tabs & Navigation
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const switchToSignUp = document.getElementById('switchToSignUp');
  const switchToSignIn = document.getElementById('switchToSignIn');
  const otpBackBtn = document.getElementById('otpBackBtn');

  // Login form elements
  const loginForm = document.getElementById('loginForm');
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
  const demoBtn = document.getElementById('demoBtn');
  const googleBtn = document.getElementById('googleBtn');
  const googleLabel = document.getElementById('googleLabel');
  const googleSpinner = document.getElementById('googleSpinner');

  // Signup form elements
  const signupForm = document.getElementById('signupForm');
  const signupName = document.getElementById('signupName');
  const signupEmail = document.getElementById('signupEmail');
  const signupPassword = document.getElementById('signupPassword');
  const signupNameError = document.getElementById('signupNameError');
  const signupEmailError = document.getElementById('signupEmailError');
  const signupPasswordError = document.getElementById('signupPasswordError');
  const signupSubmitBtn = document.getElementById('signupSubmitBtn');
  const signupSubmitLabel = document.getElementById('signupSubmitLabel');
  const signupSpinner = document.getElementById('signupSpinner');
  const signupPasswordToggle = document.getElementById('signupPasswordToggle');
  const signupEyeOpen = signupPasswordToggle?.querySelector('.js-eye-open');
  const signupEyeClosed = signupPasswordToggle?.querySelector('.js-eye-closed');
  const googleSignupBtn = document.getElementById('googleSignupBtn');
  const googleSignupLabel = document.getElementById('googleSignupLabel');
  const googleSignupSpinner = document.getElementById('googleSignupSpinner');

  // OTP elements
  const otpForm = document.getElementById('otpForm');
  const otpEmailTarget = document.getElementById('otpEmailTarget');
  const otpCodeDisplay = document.getElementById('otpCodeDisplay');
  const otpFillBtn = document.getElementById('otpFillBtn');
  const otpDigits = [1, 2, 3, 4, 5, 6].map(i => document.getElementById(`otp${i}`));
  const otpError = document.getElementById('otpError');
  const resendOtpBtn = document.getElementById('resendOtpBtn');
  const verifyOtpBtn = document.getElementById('verifyOtpBtn');
  const verifyOtpLabel = document.getElementById('verifyOtpLabel');
  const verifyOtpSpinner = document.getElementById('verifyOtpSpinner');

  // Post-auth & Navigation
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

  // Tab switching handlers
  if (tabSignIn) tabSignIn.addEventListener('click', () => switchAuthMode('signin'));
  if (tabSignUp) tabSignUp.addEventListener('click', () => switchAuthMode('signup'));
  if (switchToSignUp) switchToSignUp.addEventListener('click', () => switchAuthMode('signup'));
  if (switchToSignIn) switchToSignIn.addEventListener('click', () => switchAuthMode('signin'));
  if (otpBackBtn) otpBackBtn.addEventListener('click', () => switchAuthMode('signup'));

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

  // Input validations
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

  // Login Password visibility toggle
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

  // Signup Password visibility toggle
  if (signupPasswordToggle && signupPassword) {
    signupPasswordToggle.addEventListener('click', () => {
      const showing = signupPassword.type === 'text';
      signupPassword.type = showing ? 'password' : 'text';
      signupPasswordToggle.setAttribute('aria-pressed', showing ? 'false' : 'true');
      signupPasswordToggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      if (signupEyeOpen) signupEyeOpen.hidden = !showing;
      if (signupEyeClosed) signupEyeClosed.hidden = showing;
      signupPassword.focus();
    });
  }

  // Demo access button
  if (demoBtn && emailInput && passwordInput) {
    demoBtn.addEventListener('click', () => {
      emailInput.value = DEMO_EMAIL;
      passwordInput.value = DEMO_PASSWORD;
      setError(emailInput, emailError, '');
      setError(passwordInput, passwordError, '');
      if (submitBtn) submitBtn.focus();
    });
  }

  // Google Sign-In & Sign-Up
  function handleGoogleAuth(btn, label, spinner) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (label) label.textContent = 'Connecting with Google…';
    if (spinner) spinner.hidden = false;

    setTimeout(() => {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (spinner) spinner.hidden = true;
      if (label) label.textContent = label.id.includes('Signup') ? 'Sign up with Google' : 'Continue with Google';

      const googleUser = {
        id: 'usr_google_maya',
        name: 'Maya Roberts',
        email: DEMO_EMAIL,
        role: 'patient'
      };
      saveSession(googleUser, 'google_jwt_session');
      authState.signedIn = true;
      authState.name = googleUser.name;
      authState.email = googleUser.email;
      renderHeader();
      syncPanels();
      resetForm();
      const successTitle = document.getElementById('successTitle');
      if (successTitle) successTitle.focus();
      showToast('Signed in via Google');
    }, 900);
  }

  if (googleBtn) {
    googleBtn.addEventListener('click', () => handleGoogleAuth(googleBtn, googleLabel, googleSpinner));
  }
  if (googleSignupBtn) {
    googleSignupBtn.addEventListener('click', () => handleGoogleAuth(googleSignupBtn, googleSignupLabel, googleSignupSpinner));
  }

  // SIGN IN SUBMISSION (Supabase Cloud PostgreSQL + Tokenization)
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitBtn?.disabled || googleBtn?.disabled) return;

      const emailVal = emailInput?.value.trim() || '';
      const passVal = passwordInput?.value || '';

      const emailOk = validateEmail();
      const passwordOk = validatePassword();
      if (!emailOk || !passwordOk) {
        if (!emailOk && emailInput) emailInput.focus();
        else if (passwordInput) passwordInput.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      if (submitLabel) submitLabel.textContent = 'Verifying with Supabase…';
      if (spinner) spinner.hidden = false;
      if (emailInput) emailInput.readOnly = true;
      if (passwordInput) passwordInput.readOnly = true;

      try {
        // Authenticate directly with Supabase Cloud
        const { data, error } = await supabase.auth.signInWithPassword({
          email: emailVal,
          password: passVal
        });

        if (error) {
          // Fallback for official demo credentials
          if (emailVal.toLowerCase() === DEMO_EMAIL && passVal === DEMO_PASSWORD) {
            const demoUser = { id: 'usr_demo_patient', name: 'Maya Roberts', email: DEMO_EMAIL, role: 'patient' };
            saveSession(demoUser, 'demo_token');
            authState.signedIn = true;
            authState.name = demoUser.name;
            authState.email = demoUser.email;
            renderHeader();
            syncPanels();
            resetForm();
            const successTitle = document.getElementById('successTitle');
            if (successTitle) successTitle.focus();
            showToast('Signed in with demo access');
            return;
          }
          throw error;
        }

        const u = data.user;
        const userName = u.user_metadata?.name || u.user_metadata?.full_name || displayNameFromEmail(u.email);
        const token = data.session?.access_token || '';

        saveSession({ id: u.id, name: userName, email: u.email }, token);
        authState.signedIn = true;
        authState.name = userName;
        authState.email = u.email;
        authState.token = token;

        renderHeader();
        syncPanels();
        resetForm();
        const successTitle = document.getElementById('successTitle');
        if (successTitle) successTitle.focus();
        showToast(`Signed in as ${authState.name}`);
      } catch (err) {
        setError(passwordInput, passwordError, err.message || 'Invalid email address or password.');
        if (passwordInput) {
          passwordInput.readOnly = false;
          passwordInput.focus();
        }
        if (emailInput) emailInput.readOnly = false;
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute('aria-busy');
        }
        if (submitLabel) submitLabel.textContent = 'Sign in';
        if (spinner) spinner.hidden = true;
        if (emailInput) emailInput.readOnly = false;
        if (passwordInput) passwordInput.readOnly = false;
      }
    });
  }

  // SIGN UP SUBMISSION -> SUPABASE SENDS 6-DIGIT EMAIL OTP
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (signupSubmitBtn?.disabled) return;

      const nameVal = signupName?.value.trim() || '';
      const emailVal = signupEmail?.value.trim() || '';
      const passVal = signupPassword?.value || '';

      let hasErr = false;
      if (!nameVal || nameVal.length < 2) {
        setError(signupName, signupNameError, 'Please enter your full name (at least 2 characters).');
        hasErr = true;
      } else {
        setError(signupName, signupNameError, '');
      }

      if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailVal)) {
        setError(signupEmail, signupEmailError, 'Please enter a valid email address.');
        hasErr = true;
      } else {
        setError(signupEmail, signupEmailError, '');
      }

      if (!passVal || passVal.length < 6) {
        setError(signupPassword, signupPasswordError, 'Password must be at least 6 characters.');
        hasErr = true;
      } else {
        setError(signupPassword, signupPasswordError, '');
      }

      if (hasErr) return;

      signupSubmitBtn.disabled = true;
      signupSubmitBtn.setAttribute('aria-busy', 'true');
      if (signupSubmitLabel) signupSubmitLabel.textContent = 'Contacting Supabase cloud…';
      if (signupSpinner) signupSpinner.hidden = false;

      try {
        const { data, error } = await supabase.auth.signUp({
          email: emailVal,
          password: passVal,
          options: {
            data: {
              name: nameVal,
              full_name: nameVal
            }
          }
        });

        if (error) {
          throw error;
        }

        pendingSignup = {
          name: nameVal,
          email: emailVal,
          password: passVal,
          previewOtp: ''
        };

        if (otpEmailTarget) otpEmailTarget.textContent = emailVal;
        if (otpCodeDisplay) otpCodeDisplay.textContent = 'Sent to Email';
        const otpDemoBanner = document.getElementById('otpDemoBanner');
        if (otpDemoBanner) {
          otpDemoBanner.innerHTML = `<span>Verification code sent to <strong>${emailVal}</strong></span><span class="otp-badge" style="cursor:default">Supabase Cloud</span>`;
        }

        otpDigits.forEach(d => { if (d) d.value = ''; });
        startOtpCountdown(600);
        switchAuthMode('otp');
        window.setTimeout(() => otpDigits[0]?.focus(), 100);
        showToast(`6-digit verification code sent to ${emailVal}`);
      } catch (err) {
        setError(signupEmail, signupEmailError, err.message || 'Registration failed.');
        if (signupEmail) signupEmail.focus();
      } finally {
        signupSubmitBtn.disabled = false;
        signupSubmitBtn.removeAttribute('aria-busy');
        if (signupSubmitLabel) signupSubmitLabel.textContent = 'Send Verification Code';
        if (signupSpinner) signupSpinner.hidden = true;
      }
    });
  }

  // OTP DIGIT INPUT NAVIGATION (0-9 advance, backspace back, paste full code)
  otpDigits.forEach((digitInput, idx) => {
    if (!digitInput) return;

    digitInput.addEventListener('input', () => {
      const val = digitInput.value.replace(/[^0-9]/g, '');
      digitInput.value = val ? val[0] : '';
      digitInput.classList.remove('error');
      if (val && idx < otpDigits.length - 1) {
        otpDigits[idx + 1].focus();
        otpDigits[idx + 1].select();
      }
      if (otpError) setError({ removeAttribute: () => {} }, otpError, '');
    });

    digitInput.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !digitInput.value && idx > 0) {
        otpDigits[idx - 1].focus();
        otpDigits[idx - 1].value = '';
      }
    });

    digitInput.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      const numbers = pasteData.replace(/[^0-9]/g, '').slice(0, 6);
      if (numbers) {
        numbers.split('').forEach((num, numIdx) => {
          if (otpDigits[numIdx]) {
            otpDigits[numIdx].value = num;
            otpDigits[numIdx].classList.remove('error');
          }
        });
        const targetIdx = Math.min(numbers.length, 5);
        otpDigits[targetIdx]?.focus();
      }
    });
  });

  // OTP Auto-fill helper
  function fillOtpCode(code) {
    if (!code) return;
    const clean = code.replace(/[^0-9]/g, '').slice(0, 6);
    clean.split('').forEach((digit, i) => {
      if (otpDigits[i]) {
        otpDigits[i].value = digit;
        otpDigits[i].classList.remove('error');
      }
    });
    if (otpDigits[5]) otpDigits[5].focus();
    if (otpError) setError({ removeAttribute: () => {} }, otpError, '');
  }

  if (otpFillBtn) {
    otpFillBtn.addEventListener('click', () => fillOtpCode(pendingSignup.previewOtp));
  }
  if (otpCodeDisplay) {
    otpCodeDisplay.addEventListener('click', () => fillOtpCode(pendingSignup.previewOtp));
  }

  // Resend OTP via Supabase
  if (resendOtpBtn) {
    resendOtpBtn.addEventListener('click', async () => {
      if (!pendingSignup.email) return;
      resendOtpBtn.disabled = true;
      resendOtpBtn.textContent = 'Resending…';
      try {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: pendingSignup.email
        });
        if (error) throw error;
        startOtpCountdown(600);
        showToast('A new 6-digit code has been emailed to your inbox');
      } catch (err) {
        showToast(err.message || 'Could not resend verification code');
      } finally {
        resendOtpBtn.disabled = false;
        resendOtpBtn.textContent = 'Resend Code';
      }
    });
  }

  // VERIFY OTP & COMPLETE REGISTRATION WITH SUPABASE
  if (otpForm) {
    otpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (verifyOtpBtn?.disabled) return;

      const code = otpDigits.map(d => d?.value || '').join('');
      if (code.length !== 6) {
        setError({ removeAttribute: () => {} }, otpError, 'Please enter all 6 digits of your verification code.');
        otpDigits.forEach(d => { if (!d?.value) d?.classList.add('error'); });
        return;
      }
      setError({ removeAttribute: () => {} }, otpError, '');

      verifyOtpBtn.disabled = true;
      verifyOtpBtn.setAttribute('aria-busy', 'true');
      if (verifyOtpLabel) verifyOtpLabel.textContent = 'Verifying with Supabase cloud…';
      if (verifyOtpSpinner) verifyOtpSpinner.hidden = false;

      try {
        let verifyResult = await supabase.auth.verifyOtp({
          email: pendingSignup.email,
          token: code,
          type: 'signup'
        });

        if (verifyResult.error) {
          verifyResult = await supabase.auth.verifyOtp({
            email: pendingSignup.email,
            token: code,
            type: 'email'
          });
        }

        if (verifyResult.error) {
          throw verifyResult.error;
        }

        const data = verifyResult.data;
        const user = data?.user || data?.session?.user;
        const token = data?.session?.access_token || 'supa_token_' + Date.now();
        const userName = user?.user_metadata?.name || user?.user_metadata?.full_name || pendingSignup.name || displayNameFromEmail(pendingSignup.email);

        stopOtpCountdown();
        saveSession({ id: user?.id, name: userName, email: pendingSignup.email }, token);
        authState.signedIn = true;
        authState.name = userName;
        authState.email = pendingSignup.email;
        authState.token = token;

        renderHeader();
        switchAuthMode('signin');
        const successPanel = document.getElementById('successPanel');
        const whoami = document.getElementById('whoami');
        if (whoami) whoami.textContent = authState.name;
        if (successPanel) successPanel.hidden = false;
        const successTitle = document.getElementById('successTitle');
        if (successTitle) successTitle.focus();

        showToast(`Welcome, ${authState.name}! Account verified in Supabase.`);
      } catch (err) {
        setError({ removeAttribute: () => {} }, otpError, err.message || 'Incorrect verification code.');
        otpDigits.forEach(d => d?.classList.add('error'));
      } finally {
        verifyOtpBtn.disabled = false;
        verifyOtpBtn.removeAttribute('aria-busy');
        if (verifyOtpLabel) verifyOtpLabel.textContent = 'Verify & Create Account';
        if (verifyOtpSpinner) verifyOtpSpinner.hidden = true;
      }
    });
  }

  // Done & Sign Out handlers
  if (doneBtn) {
    doneBtn.addEventListener('click', () => openDashboard(doneBtn));
  }

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
    } catch (_) {}
    clearSession();
    stopOtpCountdown();
    authState.signedIn = false;
    authState.name = '';
    authState.email = '';
    authState.token = '';
    renderHeader();
    switchAuthMode('signin');
    resetForm();
    closeLoginDialog();
    showToast('Signed out of NuraSense');
    if (headerLogin) setTimeout(() => headerLogin.focus(), 60);
  }

  if (signOutBtn) signOutBtn.addEventListener('click', handleSignOut);
  if (headerSignOut) headerSignOut.addEventListener('click', handleSignOut);
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
  loadStoredSession();
  initLandingInteractions();
  initAuthModalListeners();
  initDashboardListeners();
  initLiveTelemetryStream();
  initAppRouting();
  renderHeader();
});
