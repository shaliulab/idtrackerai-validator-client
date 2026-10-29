// api.js
import axios from 'axios';

// Empty string = same origin, which is the packaged/production case.
// Set REACT_APP_API_BASE at build time (e.g. http://localhost:5000) to point a
// dev frontend at a backend on another origin.
export const API_BASE = import.meta.env.REACT_APP_API_BASE || '';

// For URLs that end up in element attributes — <img src>, <video src>, <a href>
// — rather than going through axios. Those bypass the instance's baseURL
// entirely, so they need the prefix applied explicitly.
export const apiUrl = (path) => `${API_BASE}${path}`;

const api = axios.create({
  baseURL: API_BASE,
});

// The session ended (expired, signed out in another tab, server secret changed):
// back to the login page, then to where we were.
api.interceptors.response.use(undefined, (error) => {
  if (error.response?.status === 401 && error.response.data?.login) {
    const next = window.location.pathname + window.location.search;
    window.location.assign(`${API_BASE}/login?next=${encodeURIComponent(next)}`);
  }
  return Promise.reject(error);
});

export default api;