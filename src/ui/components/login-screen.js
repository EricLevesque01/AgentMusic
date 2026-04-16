/**
 * TasteGraph — Login Screen Component
 */
import { redirectToSpotifyLogin } from '../../auth/spotify-auth.js';

export function renderLoginScreen(container) {
  container.innerHTML = `
    <div class="page" id="page-login" style="display: flex; align-items: center; justify-content: center; min-height: 80vh;">
      <div class="glass-card" style="padding: var(--space-10); text-align: center; max-width: 460px; width: 100%;">
        <div style="font-size: 4rem; margin-bottom: var(--space-4);">🎧</div>
        <h1 class="page-title" style="font-size: var(--font-size-3xl); margin-bottom: var(--space-2);">TasteGraph</h1>
        <p style="color: var(--text-secondary); margin-bottom: var(--space-8); font-size: var(--font-size-base);">
          Multi-Agent Playlist Curator
        </p>
        
        <p style="color: var(--text-muted); font-size: var(--font-size-sm); margin-bottom: var(--space-6); line-height: 1.7;">
          Connect your Spotify account to let six specialized agents 
          analyze your taste, discover new music, and explain every recommendation.
        </p>

        <button class="btn btn-primary btn-lg" id="spotify-login-btn" style="width: 100%; gap: var(--space-3);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Connect with Spotify
        </button>

        <p style="color: var(--text-muted); font-size: var(--font-size-xs); margin-top: var(--space-4);">
          We only read your top artists and tracks. No data is stored on any server.
        </p>
      </div>
    </div>
  `;

  document.getElementById('spotify-login-btn').addEventListener('click', () => {
    redirectToSpotifyLogin();
  });
}
