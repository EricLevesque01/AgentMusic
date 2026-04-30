/**
 * TasteGraph — Login Screen
 */
import { redirectToSpotifyLogin } from '../../auth/spotify-auth.js';

export function renderLoginScreen(container) {
  container.innerHTML = `
    <div id="page-login" style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-6);
    ">
      <div style="max-width: 380px; width: 100%; animation: scaleIn 380ms ease forwards;">

        <div style="
          width: 52px; height: 52px; border-radius: var(--radius-xl);
          background: rgba(61,139,255,0.1);
          border: 1px solid rgba(61,139,255,0.25);
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto var(--space-6);
        ">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
               stroke="var(--accent-primary)" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="8" cy="12" r="5"/>
            <circle cx="18" cy="8" r="3"/>
            <circle cx="18" cy="17" r="3"/>
            <line x1="12.5" y1="9.5" x2="15.5" y2="9.5"/>
            <line x1="12.5" y1="14.5" x2="15.5" y2="15"/>
          </svg>
        </div>

        <h1 style="
          font-size: var(--font-size-2xl);
          font-weight: var(--font-weight-extrabold);
          letter-spacing: -0.04em;
          text-align: center;
          margin-bottom: var(--space-2);
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        ">Agent Music</h1>

        <p style="
          text-align: center;
          font-size: var(--font-size-sm);
          color: var(--text-muted);
          margin-bottom: var(--space-8);
          line-height: 1.55;
        ">Connect Spotify to rank artists, curate AI-powered playlists, and export them straight to your library.</p>

        <button class="btn btn-primary btn-lg" id="spotify-login-btn"
                style="width:100%;gap:var(--space-3);margin-bottom:var(--space-4);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Connect with Spotify
        </button>

        <p style="color:var(--text-muted);font-size:var(--font-size-xs);text-align:center;line-height:1.5;">
          Your listening data stays on your device. We use Spotify to read your taste and export playlists.<br/>
          No personal data is stored on external servers.
        </p>
      </div>
    </div>
  `;

  document.getElementById('spotify-login-btn').addEventListener('click', () => {
    redirectToSpotifyLogin();
  });
}
