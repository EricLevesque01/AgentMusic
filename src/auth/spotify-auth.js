/**
 * TasteGraph — Spotify OAuth 2.0 PKCE Flow
 * 
 * Adapted from the EchoDJ project's spotify-auth.ts.
 * Pure client-side PKCE (no server-side route needed for Vite dev server
 * since crypto.subtle is available on localhost).
 *
 * Spotify 2025 redirect_uri rules:
 *   - HTTPS required for non-loopback
 *   - http://127.0.0.1:PORT allowed (loopback exception)
 *   - "localhost" is NOT allowed — must use 127.0.0.1
 */

// --- Configuration ---
const SPOTIFY_AUTH_URL  = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

const CLIENT_ID    = import.meta.env?.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = 'http://127.0.0.1:5173/';  // Vite dev server

// Scopes needed for TasteGraph
const SCOPES = [
  'user-top-read',             // Top artists/tracks for Profiler
  'user-read-recently-played', // Novelty filter
  'streaming',                 // Web Playback SDK
  'user-read-email',           // Required for Web Playback SDK
  'user-read-private',         // Required for Web Playback SDK
  'user-modify-playback-state',// To trigger play commands
  'playlist-modify-private',   // To export playlists
  'playlist-modify-public'     // To export playlists
].join(' ');

const STORAGE_KEY    = 'tg_auth_v2';
const VERIFIER_KEY   = 'tg_code_verifier_v2';

// Refresh 10 minutes before expiry
const REFRESH_BUFFER_MS = 10 * 60 * 1000;

// --- PKCE Helpers ---

/**
 * Generate a cryptographically random code verifier (43–128 chars).
 */
function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generate the SHA-256 code challenge from the verifier.
 */
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64 URL-safe encoding (no padding).
 */
function base64UrlEncode(bytes) {
  const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// --- Public API ---

/**
 * Initiate the Spotify OAuth PKCE authorization flow.
 * Generates PKCE pair, stores verifier, and redirects to Spotify.
 */
export async function redirectToSpotifyLogin() {
  const verifier  = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  // Store verifier for callback
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    response_type:         'code',
    redirect_uri:          REDIRECT_URI,
    scope:                 SCOPES,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
    show_dialog:           'false',
  });

  window.location.href = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

/**
 * Handle the OAuth callback — exchange the auth code for tokens.
 * Returns true if tokens were successfully obtained.
 */
export async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  const error  = params.get('error');

  if (error) {
    console.error('Spotify auth error:', error);
    return false;
  }

  if (!code) {
    return false; // Not a callback, normal page load
  }

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    console.error('No code verifier found. Please restart login.');
    return false;
  }

  try {
    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error_description || err.error);
    }

    const data = await response.json();
    saveTokens(data.access_token, data.refresh_token, data.expires_in);

    // Clean up URL and verifier
    sessionStorage.removeItem(VERIFIER_KEY);
    window.history.replaceState({}, document.title, '/#/');

    return true;
  } catch (err) {
    console.error('Token exchange failed:', err);
    return false;
  }
}

/**
 * Refresh the access token using the stored refresh token.
 */
export async function refreshAccessToken() {
  const tokens = getTokens();
  if (!tokens?.refresh_token) {
    throw new Error('No refresh token available');
  }

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      grant_type:    'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error_description || err.error);
  }

  const data = await response.json();
  saveTokens(
    data.access_token,
    data.refresh_token || tokens.refresh_token,
    data.expires_in,
  );

  return data.access_token;
}

// --- Token Storage ---

function saveTokens(accessToken, refreshToken, expiresIn) {
  const auth = {
    access_token:  accessToken,
    refresh_token: refreshToken,
    expires_at:    Date.now() + expiresIn * 1000,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

/**
 * Get stored tokens. Returns null if not authenticated or expired.
 */
export function getTokens() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

let anonymousToken = null;
let anonymousExpiresAt = 0;

/**
 * Get a valid access token, refreshing if needed.
 * Fallback to anonymous client credentials token if not logged in.
 */
export async function getValidAccessToken() {
  const tokens = getTokens();

  // If user is logged in
  if (tokens && tokens.refresh_token) {
    if (tokens.expires_at - Date.now() < REFRESH_BUFFER_MS) {
      try {
        return await refreshAccessToken();
      } catch {
        clearTokens();
        // Fallthrough to anonymous
      }
    } else {
      return tokens.access_token;
    }
  }

  // Fallback to anonymous token from Local Python Backend
  if (anonymousToken && anonymousExpiresAt > Date.now() + 60000) {
    return anonymousToken;
  }
  
  try {
    const res = await fetch('http://127.0.0.1:8000/spotify/token');
    const data = await res.json();
    if (data.access_token) {
      anonymousToken = data.access_token;
      anonymousExpiresAt = Date.now() + (data.expires_in * 1000);
      return anonymousToken;
    }
  } catch (err) {
    console.warn("Failed to fetch anonymous Spotify token:", err);
  }
  
  return null;
}

/**
 * Check if the user is authenticated.
 */
export function isAuthenticated() {
  const tokens = getTokens();
  return tokens !== null && tokens.expires_at > Date.now();
}

/**
 * Clear tokens (logout).
 */
export function clearTokens() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Get the client ID (useful for components that need it).
 */
export function getClientId() {
  return CLIENT_ID;
}
