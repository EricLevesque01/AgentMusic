import { getValidAccessToken } from '../auth/spotify-auth.js';

let player = null;
let deviceId = null;
let isReady = false;
let initPromise = null;

/**
 * Initialize the Spotify Web Playback SDK.
 * Requires Spotify Premium.
 */
export async function initSpotifyPlayer() {
  if (isReady) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    // Inject Spotify SDK script
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = async () => {
      const token = await getValidAccessToken();
      if (!token) {
        reject('No token available');
        return;
      }
      
      player = new window.Spotify.Player({
        name: 'Agent Music Web Player',
        getOAuthToken: cb => { cb(token); },
        volume: 0.5
      });

      player.addListener('ready', ({ device_id }) => {
        deviceId = device_id;
        isReady = true;
        console.log('Agent Music Web Player Ready with Device ID', device_id);
        resolve();
      });

      player.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
        isReady = false;
      });
      
      player.addListener('initialization_error', ({ message }) => {
        console.error('Failed to initialize', message);
        reject(message);
      });
      
      player.addListener('authentication_error', ({ message }) => {
        console.error('Failed to authenticate', message);
        reject(message);
      });
      
      player.addListener('account_error', ({ message }) => {
        console.error('Failed to validate Spotify account (Premium required)', message);
        reject(message);
      });

      player.connect();
    };
  });
  
  return initPromise;
}

export async function playTrack(trackUri) {
  if (!isReady || !deviceId) {
    throw new Error("Spotify Player not ready or no device ID");
  }
  
  const token = await getValidAccessToken();
  const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [trackUri] }),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
  });
  
  if (!res.ok) throw new Error("Failed to play track on device");
}

export async function pauseTrack() {
  if (!player) return;
  await player.pause();
}
