// API client — behaviour is unchanged from the original App.jsx.
// All requests go to /api (Vite proxy in dev), JWT lives in localStorage under `hcm_token`.
export const API = '/api';

export function token() {
  return localStorage.getItem('hcm_token');
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('hcm_token');
      window.dispatchEvent(new Event('hcm-auth-expired'));
    }
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}

export function request(method, body) {
  return { method, body: JSON.stringify(body) };
}

export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function getCheckInLocation() {
  if (!navigator.geolocation) {
    return {
      coordinates: {},
      warning: 'Location is not available in this browser. If your office requires location, allow it and try again.'
    };
  }
  try {
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, maximumAge: 0 }));
    return {
      coordinates: { latitude: position.coords.latitude, longitude: position.coords.longitude },
      warning: ''
    };
  } catch (error) {
    const reason = error.code === 1 ? 'permission was denied' : error.code === 3 ? 'the request timed out' : 'could not be read';
    return {
      coordinates: {},
      warning: `Location ${reason}. If your office requires location, allow browser access and try again.`
    };
  }
}
