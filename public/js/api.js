// Smart Hospital Waste Management System - Common Client Utilities
function getBackendOrigin() {
  try {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get('api');
    if (apiParam && /^https?:\/\//i.test(apiParam)) {
      const cleaned = apiParam.replace(/\/+$/, '');
      localStorage.setItem('bmw_backend_url', cleaned);
      return cleaned;
    }
  } catch (e) {}

  const configured = (window.APP_CONFIG && window.APP_CONFIG.RENDER_BACKEND_URL)
    ? window.APP_CONFIG.RENDER_BACKEND_URL.trim().replace(/\/+$/, '')
    : '';

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return '';
  }

  if (configured) {
    return configured;
  }

  // Fallback for separate Vercel deployment if user connected via ?api=...
  if (host.endsWith('.vercel.app')) {
    const saved = localStorage.getItem('bmw_backend_url');
    if (saved) return saved.replace(/\/+$/, '');
  }

  return '';
}

const BACKEND_ORIGIN = getBackendOrigin();
const API_BASE = `${BACKEND_ORIGIN}/api`;

function resolveAssetUrl(assetPath) {
  if (!assetPath) return '';
  if (/^(https?:|data:|blob:)/i.test(assetPath)) return assetPath;
  if (assetPath.startsWith('/api/') || assetPath.startsWith('/uploads/')) {
    return `${BACKEND_ORIGIN}${assetPath}`;
  }
  return assetPath;
}

// Auth State Management
function getToken() {
  return localStorage.getItem('bmw_token');
}

function setToken(token) {
  if (token) {
    localStorage.setItem('bmw_token', token);
  } else {
    localStorage.removeItem('bmw_token');
  }
}

function getUser() {
  const userStr = localStorage.getItem('bmw_user');
  try {
    return userStr ? JSON.parse(userStr) : null;
  } catch (e) {
    return null;
  }
}

function setUser(user) {
  if (user) {
    localStorage.setItem('bmw_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bmw_user');
  }
}

function logout() {
  localStorage.removeItem('bmw_token');
  localStorage.removeItem('bmw_user');
  window.location.href = '/index.html';
}

// Check auth and redirect if not permitted
function requireAuth(allowedRoles = []) {
  const token = getToken();
  const user = getUser();

  if (!token || !user) {
    window.location.href = '/index.html?loginRequired=1';
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    // Redirect to permitted portal
    if (user.role === 'staff') window.location.href = '/staff-dashboard.html';
    else if (user.role === 'collector') window.location.href = '/collector-dashboard.html';
    else if (user.role === 'admin') window.location.href = '/admin-dashboard.html';
    else window.location.href = '/index.html';
    return null;
  }

  return user;
}

// Universal API fetch wrapper
async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = options.headers || {};

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // If body is not FormData, default to application/json
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });

    if (res.status === 401) {
      // Token invalid or expired
      logout();
      return { success: false, message: 'Session expired. Please log in again.' };
    }

    // For file downloads (like Excel)
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('spreadsheetml')) {
      return res.blob();
    }

    const data = await res.json();
    return data;
  } catch (error) {
    console.error('API Error:', error);
    return { success: false, message: error.message || 'Network request failed' };
  }
}

// Toast Notification System
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
  } else if (type === 'warning') {
    iconSvg = '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';
  } else {
    iconSvg = '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
  }

  toast.innerHTML = `${iconSvg}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Real Device GPS Capture Helper
function getDeviceGPSCoordinates() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser or device.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed || 0,
          timestamp: position.timestamp
        });
      },
      (error) => {
        let msg = 'Unable to retrieve your location.';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            msg = 'User denied Geolocation access. Please allow location permissions in your browser.';
            break;
          case error.POSITION_UNAVAILABLE:
            msg = 'Location information is unavailable on this device.';
            break;
          case error.TIMEOUT:
            msg = 'The request to get device location timed out.';
            break;
        }
        reject(new Error(msg));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

// 8 Stages definition
const WORKFLOW_STAGES = [
  'Request Submitted',
  'Request Accepted',
  'Collector Assigned',
  'Collection in Progress',
  'Waste Collected',
  'Transported',
  'Handed Over to Authorized Treatment Facility',
  'Completed'
];

function getStageBadge(status) {
  const index = WORKFLOW_STAGES.indexOf(status);
  const stageNum = index >= 0 ? index + 1 : 1;
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold badge-stage-${stageNum}">
    <span class="w-1.5 h-1.5 mr-1.5 rounded-full bg-current"></span>
    ${status}
  </span>`;
}

function getCategoryBadge(categoryColor, categoryName) {
  const color = (categoryColor || '').toLowerCase();
  let bgClass = 'bg-slate-100 text-slate-800 border-slate-300';
  let dotColor = '#64748b';

  if (color === 'yellow') {
    bgClass = 'bg-amber-100 text-amber-900 border-amber-300';
    dotColor = '#eab308';
  } else if (color === 'red') {
    bgClass = 'bg-red-100 text-red-900 border-red-300';
    dotColor = '#ef4444';
  } else if (color === 'blue') {
    bgClass = 'bg-blue-100 text-blue-900 border-blue-300';
    dotColor = '#2563eb';
  } else if (color === 'white') {
    bgClass = 'bg-slate-100 text-slate-900 border-slate-400';
    dotColor = '#475569';
  }

  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${bgClass}">
    <span class="w-2 h-2 rounded-full mr-1.5" style="background-color: ${dotColor};"></span>
    ${categoryColor ? categoryColor.toUpperCase() : ''} - ${categoryName || ''}
  </span>`;
}

// Format Dates
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const d = new Date(dateString);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Quick Login Demo Trigger
async function triggerDemoLogin(role) {
  let email = '';
  let password = 'Password@123';

  if (role === 'staff') email = 'staff@hospital.com';
  else if (role === 'collector') email = 'collector@hospital.com';
  else if (role === 'admin') email = 'admin@hospital.com';

  showToast(`Authenticating demo ${role} account...`, 'info');

  const res = await apiRequest('/auth/login', {
    method: 'POST',
    body: {
      identifier: email,
      password: password,
      expectedRole: role
    }
  });

  if (res.success) {
    setToken(res.token);
    setUser(res.user);
    showToast(res.message, 'success');
    setTimeout(() => {
      if (role === 'staff') window.location.href = '/staff-dashboard.html';
      else if (role === 'collector') window.location.href = '/collector-dashboard.html';
      else if (role === 'admin') window.location.href = '/admin-dashboard.html';
    }, 600);
  } else {
    showToast(res.message || 'Login failed', 'error');
  }
}

