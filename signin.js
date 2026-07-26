// =====================================================
// SAFETY CHECK: Supabase CDN loaded
// =====================================================
if (!window.supabase) {
  document.body.innerHTML = '<div style="color:#ff6b6b;text-align:center;padding:40px;font-family:sans-serif;">Failed to load Supabase. Check your internet connection.</div>';
  throw new Error('Supabase CDN not loaded');
}

// =====================================================
// SUPABASE CONFIGURATION — persistSession: true
// =====================================================
const SUPABASE_URL = 'https://pfutaovwbygefummienf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmdXRhb3Z3YnlnZWZ1bW1pZW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1OTM3OTIsImV4cCI6MjA5MzE2OTc5Mn0.K6KI5Dco1-i6MGMIgXfIUenb3pfE3LtqOMRq2qfar7I';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// =====================================================
// DASHBOARD MAPPING
// =====================================================
const DASHBOARDS = {
  'buyer': 'dashboard-buyer.html',
  'seller': 'dashboard-seller.html',
  'carrier': 'dashboard-transport.html',
  'insurer': 'dashboard-insurer.html',
  'banker': 'dashboard-banker.html',
  'admin': 'dashboard-admin.html'
};

// =====================================================
// URL PARAMS & STATE
// =====================================================
const urlParams = new URLSearchParams(window.location.search);
const isLogout = urlParams.get('logout') === '1';
const isBlocked = urlParams.get('blocked') === '1';
const isExpired = urlParams.get('expired') === '1';
const isDebug = urlParams.get('debug') === '1';

let selectedRole = null;
let currentUser = null;
let authCheckComplete = false;
let signInButtonLocked = false;
let currentStep = 'step1';
let isRedirecting = false;

// =====================================================
// SEPARATE RATE LIMITERS
// =====================================================
function createRateLimiter(maxAttempts = 5, windowMs = 60000) {
  let attempts = 0;
  let resetTime = null;
  return {
    isBlocked() {
      if (!resetTime) return false;
      if (Date.now() > resetTime) {
        attempts = 0;
        resetTime = null;
        return false;
      }
      return attempts >= maxAttempts;
    },
    recordAttempt() {
      if (!resetTime) {
        resetTime = Date.now() + windowMs;
      }
      attempts++;
    },
    getRemainingTime() {
      if (!resetTime) return 0;
      return Math.max(0, Math.ceil((resetTime - Date.now()) / 1000));
    },
    reset() {
      attempts = 0;
      resetTime = null;
    }
  };
}

const signInRateLimit = createRateLimiter();
const signUpRateLimit = createRateLimiter();

// =====================================================
// BULLETPROOF SIGN OUT
// =====================================================
async function fullSignOut() {
  authCheckComplete = false;

  try {
    await supabaseClient.auth.signOut({ scope: 'global' });
  } catch (e) {
    // Ignore
  }

  await new Promise(r => setTimeout(r, 500));

  // Remove known Supabase keys directly
  const knownKeys = [
    'supabase.auth.token',
    'sb-pfutaovwbygefummienf-auth-token',
    'sb-pfutaovwbygefummienf-auth-token-code-verifier',
    'tradeaux_user',
    'tradeaux_role',
    'tradeaux_user_email'
  ];
  knownKeys.forEach(key => {
    if (localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
    }
  });

  // Also remove any keys with 'supabase' or 'sb-' in the name
  const lsKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    lsKeys.push(localStorage.key(i));
  }
  lsKeys.forEach(key => {
    if (key && (key.includes('supabase') || key.startsWith('sb-'))) {
      localStorage.removeItem(key);
    }
  });

  sessionStorage.clear();
  localStorage.setItem('logoutProcessed', '1');
}

// =====================================================
// UI HELPERS
// =====================================================
let errorTimeout = null;
let successTimeout = null;

function getLoadingTextEl() {
  return document.getElementById('loadingText');
}

function showError(msg, fieldId) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('successMsg').style.display = 'none';

  if (fieldId) {
    const field = document.getElementById(fieldId);
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', 'errorMsg');
    }
  }

  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => {
    el.style.display = 'none';
    if (fieldId) {
      const field = document.getElementById(fieldId);
      if (field) {
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');
      }
    }
  }, 12000);
}

function showSuccess(msg) {
  const el = document.getElementById('successMsg');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('errorMsg').style.display = 'none';
  clearTimeout(successTimeout);
  successTimeout = setTimeout(() => { el.style.display = 'none'; }, 12000);
}

function showLoading(show, text) {
  const loader = document.getElementById('loadingIndicator');
  const loadingTextEl = getLoadingTextEl();
  if (loader) {
    loader.style.display = show ? 'block' : 'none';
    if (text && loadingTextEl) {
      loadingTextEl.textContent = text;
    }
  }
}

function showStep(stepId) {
  // Clear any lingering error/success messages when switching steps
  document.getElementById('errorMsg').style.display = 'none';
  document.getElementById('successMsg').style.display = 'none';

  // Clear ARIA-invalid and error-field attributes from inputs
  document.querySelectorAll('.error-field, [aria-invalid="true"]').forEach(el => {
    el.classList.remove('error-field');
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
  });

  if (currentStep === 'step3' && stepId !== 'step3') {
    selectedRole = null;
    document.querySelectorAll('.role-option').forEach(function(opt) {
      opt.classList.remove('selected');
      opt.setAttribute('aria-checked', 'false');
    });
    const btn = document.getElementById('roleContinueBtn');
    btn.disabled = true;
    btn.textContent = 'Select a role first';
  }

  document.querySelectorAll('.step-container').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('visible');
  });
  showLoading(false);
  const step = document.getElementById(stepId);
  if (step) {
    currentStep = stepId;
    step.classList.remove('hidden');
    requestAnimationFrame(() => {
      step.classList.add('visible');
    });
    const focusable = step.querySelector('input, button, [tabindex="0"]');
    if (focusable) {
      setTimeout(() => focusable.focus(), 150);
    }
  }
  if (isDebug) {
    document.getElementById('debugInfo').textContent = 'Current step: ' + stepId;
  }
}

function redirectToDashboard(role) {
  isRedirecting = true;
  const url = DASHBOARDS[role];
  if (!url) {
    showError('Unknown role. Redirecting to buyer.');
    setTimeout(() => { window.location.href = 'dashboard-buyer.html'; }, 2000);
    return;
  }
  const debugEl = document.getElementById('debugInfo');
  if (isDebug) {
    debugEl.textContent = 'Redirecting to: ' + url;
    debugEl.classList.add('visible');
  }
  document.querySelectorAll('.step-container').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('visible');
  });
  showLoading(true, 'Redirecting...');
  
  // Set redirect guard before navigation
  sessionStorage.setItem('auth_redirect_done', Date.now().toString());
  
  setTimeout(() => { window.location.href = url; }, 300);
}

async function showRolePicker(user) {
  currentUser = user;
  showStep('step3');
  document.getElementById('subtitle').textContent = 'Choose your dashboard';
  if (isDebug) {
    document.getElementById('debugInfo').textContent = 'Select a role to continue';
    document.getElementById('debugInfo').classList.add('visible');
  }

  let displayName = user.email;
  try {
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', user.id)
      .maybeSingle();
    if (profile) {
      displayName = profile.full_name || profile.company_name || user.email;
    }
  } catch (e) {
    // Fallback to email
  }

  document.getElementById('userEmailDisplay').textContent = 'Welcome, ' + displayName;
  localStorage.setItem('tradeaux_user_email', displayName);

  setTimeout(() => {
    const firstOption = document.querySelector('.role-option');
    if (firstOption) firstOption.focus();
  }, 150);
}

// =====================================================
// STRIP QUERY PARAMS
// =====================================================
function stripQueryParams() {
  const currentUrl = window.location.href;
  const url = new URL(currentUrl);
  const paramsToRemove = ['logout', 'blocked', 'expired', 'debug'];
  let changed = false;
  paramsToRemove.forEach(param => {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  });
  if (changed) {
    window.history.replaceState({}, document.title, url.toString());
  }
}

// =====================================================
// VALIDATE SESSION (bulletproof expiry)
// =====================================================
function isSessionValid(session) {
  if (!session) return false;
  if (!session.expires_at) return true;
  
  let expiresAt = session.expires_at;
  if (typeof expiresAt === 'string') {
    // Try parsing as int first, then as date
    const asInt = parseInt(expiresAt, 10);
    expiresAt = isNaN(asInt) ? Math.floor(new Date(expiresAt).getTime() / 1000) : asInt;
  }
  
  const now = Math.floor(Date.now() / 1000);
  return expiresAt > now;
}

function isValidEmail(email) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

function isOnline() {
  return navigator.onLine !== false;
}

// =====================================================
// MAIN AUTH CHECK
// =====================================================
async function checkAuth() {
  // Strip dangerous query params FIRST to prevent loops
  stripQueryParams();

  showLoading(true, 'Checking authentication...');
  document.querySelectorAll('.step-container').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('visible');
  });
  isRedirecting = false;

  // Always clear logoutProcessed at the start to prevent stale flags
  if (localStorage.getItem('logoutProcessed')) {
    localStorage.removeItem('logoutProcessed');
  }

  // Check for logout/blocked/expired AFTER stripping params
  if (isLogout) {
    await fullSignOut();
    showSuccess('You have been signed out.');
    if (isDebug) {
      document.getElementById('debugInfo').textContent = 'Signed out.';
      document.getElementById('debugInfo').classList.add('visible');
    }
    showStep('step1');
    return;
  }

  if (isBlocked) {
    await fullSignOut();
    showError('Access denied. Your account is not registered on this platform.');
    if (isDebug) {
      document.getElementById('debugInfo').textContent = 'Access denied.';
      document.getElementById('debugInfo').classList.add('visible');
    }
    showStep('step1');
    return;
  }

  if (isExpired) {
    await fullSignOut();
    showError('Your session expired. Please sign in again.');
    if (isDebug) {
      document.getElementById('debugInfo').textContent = 'Session expired.';
      document.getElementById('debugInfo').classList.add('visible');
    }
    showStep('step1');
    return;
  }

  if (!isOnline()) {
    showError('You are offline. Please check your internet connection.');
    showStep('step1');
    return;
  }

  // Check for redirect guard to prevent loops
  const redirectDone = sessionStorage.getItem('auth_redirect_done');
  if (redirectDone) {
    const elapsed = Date.now() - parseInt(redirectDone, 10);
    if (elapsed < 5000) {
      showStep('step1');
      return;
    } else {
      sessionStorage.removeItem('auth_redirect_done');
    }
  }

  if (authCheckComplete) {
    showLoading(false);
    return;
  }
  authCheckComplete = true;

  try {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      showStep('step1');
      showLoading(false);
      return;
    }

    if (!data || !data.session) {
      showStep('step1');
      showLoading(false);
      return;
    }

    if (!isSessionValid(data.session)) {
      showError('Your session expired. Please sign in again.');
      await fullSignOut();
      window.location.href = 'signin.html?expired=1';
      return;
    }

    const user = data.session.user;

    // FAST PATH: Check cached role first
    const cachedRole = localStorage.getItem('tradeaux_role');
    if (cachedRole && DASHBOARDS[cachedRole]) {
      if (isDebug) {
        document.getElementById('debugInfo').textContent = 'Cached role: ' + cachedRole + ' → redirecting';
        document.getElementById('debugInfo').classList.add('visible');
      }
      redirectToDashboard(cachedRole);
      return;
    }

    // Only fetch profile if no cached role
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      showError('Could not verify account. Please sign in again.');
      showStep('step1');
      showLoading(false);
      return;
    }

    if (!profile) {
      // New user or no profile — show role picker
      showRolePicker(user);
      return;
    }

    if (profile && profile.role && DASHBOARDS[profile.role]) {
      // Cache the role and redirect
      localStorage.setItem('tradeaux_role', profile.role);
      const role = profile.role;
      if (isDebug) {
        document.getElementById('debugInfo').textContent = 'Profile role: ' + role + ' → redirecting';
        document.getElementById('debugInfo').classList.add('visible');
      }
      redirectToDashboard(role);
    } else {
      // Profile exists but role is empty/null — show role picker
      showRolePicker(user);
    }

  } catch (err) {
    showError('Could not verify account. Please sign in again.');
    showStep('step1');
  } finally {
    if (!isRedirecting) {
      showLoading(false);
    }
  }
}

// =====================================================
// CREATE PROFILE
// =====================================================
async function createProfile(user, companyName, retries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (!isOnline()) {
        return { success: false, error: new Error('Offline') };
      }
      const { error } = await supabaseClient.from('profiles').insert({
        id: user.id,
        email: user.email,
        full_name: companyName,
        company_name: companyName,
        role: '',
        wallet_balance: 0,
        created_at: new Date().toISOString()
      });
      
      if (!error) {
        return { success: true };
      }
      
      // Check for duplicate key violation — ignore, it's fine
      if (error.code === '23505' || error.code === '409' || error.status === 409 ||
          (error.message && error.message.toLowerCase().includes('duplicate')) ||
          (error.details && error.details.toLowerCase().includes('already exists'))) {
        return { success: true };
      }
      
      // Check for RLS/permission error
      if (error.code === '42501' || (error.message && error.message.toLowerCase().includes('permission denied'))) {
        return { success: false, error: error, isRlsError: true };
      }
      
      lastError = error;
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    } catch (e) {
      lastError = e;
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  return { success: false, error: lastError };
}

// =====================================================
// PASSWORD TOGGLE
// =====================================================
document.getElementById('togglePassword1').addEventListener('click', function() {
  const pw = document.getElementById('password');
  const isPassword = pw.type === 'password';
  pw.type = isPassword ? 'text' : 'password';
  this.querySelector('.toggle-text').textContent = isPassword ? 'Hide' : 'Show';
});

document.getElementById('togglePassword2').addEventListener('click', function() {
  const pw = document.getElementById('signupPassword');
  const isPassword = pw.type === 'password';
  pw.type = isPassword ? 'text' : 'password';
  this.querySelector('.toggle-text').textContent = isPassword ? 'Hide' : 'Show';
});

// =====================================================
// PAGE LOAD
// =====================================================
document.addEventListener('DOMContentLoaded', function() {
  if (isDebug) {
    document.getElementById('debugInfo').classList.add('visible');
  }

  // Character counter for company name with autofill detection
  const nameInput = document.getElementById('companyNameInput');
  const charCounter = document.getElementById('charCounter');
  if (nameInput && charCounter) {
    function updateCounter() {
      const len = nameInput.value.length;
      charCounter.textContent = len + ' / 100';
      charCounter.className = 'char-counter';
      if (len > 80) charCounter.classList.add('warning');
      if (len > 95) charCounter.classList.add('danger');
    }
    nameInput.addEventListener('input', updateCounter);
    
    // Autofill detection with time-based limit
    const startTime = Date.now();
    function checkAutofill() {
      if (nameInput.value.length > 0 || Date.now() - startTime > 1000) {
        updateCounter();
        return;
      }
      requestAnimationFrame(checkAutofill);
    }
    setTimeout(checkAutofill, 50);
    
    nameInput.addEventListener('change', updateCounter);
  }

  checkAuth();

  document.getElementById('showSignup').addEventListener('click', function(e) {
    e.preventDefault();
    showStep('step2');
    document.getElementById('subtitle').textContent = 'Create your account';
    if (isDebug) {
      document.getElementById('debugInfo').textContent = 'Create a new account';
      document.getElementById('debugInfo').classList.add('visible');
    }
  });

  document.getElementById('showSignin').addEventListener('click', function(e) {
    e.preventDefault();
    showStep('step1');
    document.getElementById('subtitle').textContent = 'Sign in to your account';
    if (isDebug) {
      document.getElementById('debugInfo').textContent = 'Sign in to your account';
      document.getElementById('debugInfo').classList.add('visible');
    }
    document.getElementById('errorMsg').style.display = 'none';
    document.getElementById('successMsg').style.display = 'none';
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      document.getElementById('errorMsg').style.display = 'none';
      document.getElementById('successMsg').style.display = 'none';
      document.querySelectorAll('.error-field, [aria-invalid="true"]').forEach(el => {
        el.classList.remove('error-field');
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      });
    }
  });

  // =====================================================
  // FORM SUBMISSION HANDLERS
  // =====================================================
  document.getElementById('step1').addEventListener('submit', function(e) {
    e.preventDefault();
    document.getElementById('signinBtn').click();
  });

  document.getElementById('step2').addEventListener('submit', function(e) {
    e.preventDefault();
    document.getElementById('signupBtn').click();
  });

  // =====================================================
  // ROLE PICKER ENTER KEY HANDLER
  // =====================================================
  document.getElementById('roleContinueBtn').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !this.disabled) {
      e.preventDefault();
      this.click();
    }
  });

  // =====================================================
  // SIGN IN
  // =====================================================
  document.getElementById('signinBtn').addEventListener('click', async function() {
    if (signInButtonLocked) return;
    signInButtonLocked = true;

    const btn = document.getElementById('signinBtn');
    const timeoutId = setTimeout(() => {
      signInButtonLocked = false;
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }, 15000);

    try {
      document.querySelectorAll('.error-field, [aria-invalid="true"]').forEach(el => {
        el.classList.remove('error-field');
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      });

      if (!isOnline()) {
        showError('You are offline. Please check your internet connection.');
        clearTimeout(timeoutId);
        signInButtonLocked = false;
        return;
      }

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      if (!email || !password) {
        if (!email) {
          document.getElementById('email').classList.add('error-field');
          document.getElementById('email').setAttribute('aria-invalid', 'true');
          document.getElementById('email').setAttribute('aria-describedby', 'errorMsg');
        }
        if (!password) {
          document.getElementById('password').classList.add('error-field');
          document.getElementById('password').setAttribute('aria-invalid', 'true');
          document.getElementById('password').setAttribute('aria-describedby', 'errorMsg');
        }
        showError('Please enter email and password');
        clearTimeout(timeoutId);
        signInButtonLocked = false;
        return;
      }

      if (!isValidEmail(email)) {
        document.getElementById('email').classList.add('error-field');
        document.getElementById('email').setAttribute('aria-invalid', 'true');
        document.getElementById('email').setAttribute('aria-describedby', 'errorMsg');
        showError('Please enter a valid email address');
        clearTimeout(timeoutId);
        signInButtonLocked = false;
        return;
      }

      if (signInRateLimit.isBlocked()) {
        const remaining = signInRateLimit.getRemainingTime();
        showError(`Too many attempts. Please wait ${remaining} seconds.`);
        clearTimeout(timeoutId);
        signInButtonLocked = false;
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Signing in...';

      const { data, error } = await supabaseClient.auth.signInWithPassword({ 
        email: email, 
        password: password 
      });

      if (error) {
        signInRateLimit.recordAttempt();
        throw error;
      }

      // Reset rate limit on success
      signInRateLimit.reset();

      // Check cached role first
      const cachedRole = localStorage.getItem('tradeaux_role');
      if (cachedRole && DASHBOARDS[cachedRole]) {
        redirectToDashboard(cachedRole);
        clearTimeout(timeoutId);
        return;
      }

      // Fetch profile
      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();

      if (profileError) {
        showError('Could not verify account. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Sign In';
        signInButtonLocked = false;
        clearTimeout(timeoutId);
        return;
      }

      if (!profile || !profile.role || !DASHBOARDS[profile.role]) {
        // No role set — show role picker
        signInButtonLocked = false;
        btn.disabled = false;
        btn.textContent = 'Sign In';
        clearTimeout(timeoutId);
        showRolePicker(data.user);
        return;
      }

      // Cache the role and redirect
      localStorage.setItem('tradeaux_role', profile.role);
      redirectToDashboard(profile.role);
      clearTimeout(timeoutId);

    } catch (error) {
      if (error.message.includes('Invalid login credentials')) {
        showError('Invalid email or password.');
      } else if (error.message.includes('Email not confirmed')) {
        showError('Please confirm your email before signing in.');
      } else if (error.message.includes('Network') || error.message.includes('fetch')) {
        showError('Network error. Please try again.');
      } else {
        showError(error.message);
      }
      btn.disabled = false;
      btn.textContent = 'Sign In';
      signInButtonLocked = false;
      clearTimeout(timeoutId);
    }
  });

  // =====================================================
  // SIGN UP
  // =====================================================
  document.getElementById('signupBtn').addEventListener('click', async function() {
    if (signUpRateLimit.isBlocked()) {
      const remaining = signUpRateLimit.getRemainingTime();
      showError(`Too many attempts. Please wait ${remaining} seconds.`);
      return;
    }

    if (!isOnline()) {
      showError('You are offline. Please check your internet connection.');
      return;
    }

    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const companyName = document.getElementById('companyNameInput').value.trim();

    document.querySelectorAll('.error-field, [aria-invalid="true"]').forEach(el => {
      el.classList.remove('error-field');
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    });

    if (!email || !password || !companyName) {
      if (!email) {
        document.getElementById('signupEmail').classList.add('error-field');
        document.getElementById('signupEmail').setAttribute('aria-invalid', 'true');
        document.getElementById('signupEmail').setAttribute('aria-describedby', 'errorMsg');
      }
      if (!password) {
        document.getElementById('signupPassword').classList.add('error-field');
        document.getElementById('signupPassword').setAttribute('aria-invalid', 'true');
        document.getElementById('signupPassword').setAttribute('aria-describedby', 'errorMsg');
      }
      if (!companyName) {
        document.getElementById('companyNameInput').classList.add('error-field');
        document.getElementById('companyNameInput').setAttribute('aria-invalid', 'true');
        document.getElementById('companyNameInput').setAttribute('aria-describedby', 'errorMsg');
      }
      showError('Please fill in all fields');
      return;
    }

    if (!isValidEmail(email)) {
      document.getElementById('signupEmail').classList.add('error-field');
      document.getElementById('signupEmail').setAttribute('aria-invalid', 'true');
      document.getElementById('signupEmail').setAttribute('aria-describedby', 'errorMsg');
      showError('Please enter a valid email address');
      return;
    }

    if (password.length < 6) {
      document.getElementById('signupPassword').classList.add('error-field');
      document.getElementById('signupPassword').setAttribute('aria-invalid', 'true');
      document.getElementById('signupPassword').setAttribute('aria-describedby', 'errorMsg');
      showError('Password must be at least 6 characters');
      return;
    }

    const sanitizedCompany = companyName
      .replace(/[<>]/g, '')
      .replace(/[&"']/g, '')
      .trim();

    const btn = document.getElementById('signupBtn');
    btn.disabled = true;
    btn.textContent = 'Creating account...';

    signUpRateLimit.recordAttempt();

    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: sanitizedCompany,
            company: sanitizedCompany
          }
        }
      });

      if (error) {
        throw error;
      }

      if (!data.user) {
        showError('Sign-up failed. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Create Account';
        return;
      }

      if (data.user && !data.session) {
        showSuccess('Account created! Check your email to confirm.');
        showStep('step1');
        document.getElementById('subtitle').textContent = 'Sign in to your account';
        btn.disabled = false;
        btn.textContent = 'Create Account';
        return;
      }

      if (data.user && data.session) {
        const result = await createProfile(data.user, sanitizedCompany);
        if (!result.success) {
          if (result.isRlsError) {
            await fullSignOut();
            showError('Account created but permission denied. Please contact support.');
          } else {
            showError('Account created but profile setup failed. Please sign in and contact support.');
          }
          btn.disabled = false;
          btn.textContent = 'Create Account';
          return;
        }

        // ✅ Profile created — show role picker for first-time user
        btn.disabled = false;
        btn.textContent = 'Create Account';
        signUpRateLimit.reset();
        showRolePicker(data.user);
      }

    } catch (error) {
      if (error.message.includes('User already registered')) {
        showError('An account with this email already exists. Please sign in.');
      } else {
        showError(error.message);
      }
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });

  // =====================================================
  // ROLE SELECTOR
  // =====================================================
  document.querySelectorAll('.role-option').forEach(function(option) {
    option.addEventListener('click', function() {
      selectRole(this);
    });

    option.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectRole(this);
        // If Enter on a role option, submit immediately if selected
        if (this.classList.contains('selected')) {
          document.getElementById('roleContinueBtn').click();
        }
        return;
      }
      const options = Array.from(document.querySelectorAll('.role-option'));
      const currentIndex = options.indexOf(this);
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = options[(currentIndex + 1) % options.length];
        if (next) next.focus();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = options[(currentIndex - 1 + options.length) % options.length];
        if (prev) prev.focus();
      }
    });
  });

  function selectRole(element) {
    document.querySelectorAll('.role-option').forEach(function(opt) {
      opt.classList.remove('selected');
      opt.setAttribute('aria-checked', 'false');
    });
    element.classList.add('selected');
    element.setAttribute('aria-checked', 'true');
    selectedRole = element.dataset.role;

    const btn = document.getElementById('roleContinueBtn');
    btn.disabled = false;
    btn.textContent = 'Go to Dashboard →';

    if (isDebug) {
      document.getElementById('debugInfo').textContent = 'Selected: ' + selectedRole;
      document.getElementById('debugInfo').classList.add('visible');
    }
  }

  document.getElementById('roleContinueBtn').addEventListener('click', async function() {
    if (!selectedRole) {
      showError('Please select a role first');
      return;
    }

    const btn = document.getElementById('roleContinueBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    if (currentUser) {
      try {
        const { error } = await supabaseClient
          .from('profiles')
          .update({ role: selectedRole })
          .eq('id', currentUser.id);

        if (error) {
          console.error('[Role save error]', error.message);
          showError('Could not save role. Please try again.');
          btn.disabled = false;
          btn.textContent = 'Go to Dashboard →';
          return;
        }
        
        // Cache the role immediately
        localStorage.setItem('tradeaux_role', selectedRole);
        redirectToDashboard(selectedRole);
      } catch (e) {
        console.error('[Role save exception]', e.message);
        showError('Could not save role. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Go to Dashboard →';
        return;
      }
    } else {
      btn.disabled = false;
      btn.textContent = 'Go to Dashboard →';
      showError('Please sign in again.');
      return;
    }
  });

  // =====================================================
  // LOGOUT
  // =====================================================
  document.getElementById('logoutAfterLogin').addEventListener('click', async function(e) {
    e.preventDefault();
    await fullSignOut();
    window.location.href = 'signin.html?logout=1&_t=' + Date.now();
  });

  // =====================================================
  // FORGOT PASSWORD
  // =====================================================
  let forgotPasswordLocked = false;
  document.getElementById('forgotLink').addEventListener('click', async function(e) {
    e.preventDefault();
    if (forgotPasswordLocked) return;

    const email = document.getElementById('email').value.trim();

    document.querySelectorAll('.error-field, [aria-invalid="true"]').forEach(el => {
      el.classList.remove('error-field');
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    });

    if (!email) {
      showError('Enter your email first');
      document.getElementById('email').classList.add('error-field');
      document.getElementById('email').setAttribute('aria-invalid', 'true');
      document.getElementById('email').setAttribute('aria-describedby', 'errorMsg');
      return;
    }

    if (!isValidEmail(email)) {
      showError('Please enter a valid email address');
      document.getElementById('email').classList.add('error-field');
      document.getElementById('email').setAttribute('aria-invalid', 'true');
      document.getElementById('email').setAttribute('aria-describedby', 'errorMsg');
      return;
    }

    forgotPasswordLocked = true;
    const link = this;
    const originalText = link.textContent;
    link.textContent = 'Sending...';

    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (error) throw error;
      showSuccess('Password reset email sent!');
      link.textContent = '✓ Sent!';
      setTimeout(() => { link.textContent = originalText; }, 3000);
    } catch (err) {
      showError(err.message);
      link.textContent = originalText;
    } finally {
      forgotPasswordLocked = false;
    }
  });

  // =====================================================
  // KEYBOARD SUPPORT
  // =====================================================
  // No global Enter handler — form submit handlers handle Enter in inputs
  // and mobile "Go" buttons. Role picker has its own Enter handler.
});
