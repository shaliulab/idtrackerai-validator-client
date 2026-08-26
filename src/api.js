// api.js
import axios from 'axios';

// Empty string = same origin, which is the packaged/production case.
// Set REACT_APP_API_BASE at build time (e.g. http://localhost:5000) to point a
// dev frontend at a backend on another origin.
export const API_BASE = process.env.REACT_APP_API_BASE || '';

// For URLs that end up in element attributes — <img src>, <video src>, <a href>
// — rather than going through axios. Those bypass the instance's baseURL
// entirely, so they need the prefix applied explicitly.
export const apiUrl = (path) => `${API_BASE}${path}`;

const api = axios.create({
  baseURL: API_BASE,
});

export default api;