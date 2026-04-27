/**
 * TasteGraph — Login Screen  (Deep Space Pro aesthetic)
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
      background: radial-gradient(ellipse at 50% -10%, rgba(61,139,255,0.12) 0%, transparent 65%);
    ">
      <div style="max-width: 420px; width: 100%; text-align: center; animation: scaleIn 400ms ease forwards;">

        <!-- Logo mark -->
        <div style="
          width: 64px; height: 64px; border-radius: var(--radius-xl);
          background: linear-gradient(135deg, rgba(61,139,255,0.15), rgba(99,102,241,0.1));
          border: 1px solid rgba(61,139,255,0.3);
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto var(--space-6);
          box-shadow: 0 0 32px rgba(61,139,255,0.15);
        ">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)"
               stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="8" cy="12" r="5"/>
            <circle cx="18" cy="8" r="3"/>
            <circle cx="18" cy="17" r="3"/>
            <line x1="12.5" y1="9.5" x2="15.5" y2="9.5"/>
            <line x1="12.5" y1="14.5" x2="15.5" y2="15"/>
          </svg>
        </div>

        <!-- Wordmark -->
        <h1 style="
          font-size: var(--font-size-3xl);
          font-weight: var(--font-weight-extrabold);
          letter-spacing: -0.04em;
          margin-bottom: var(--space-2);
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        ">TasteGraph</h1>

        <p style="
          font-size: var(--font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--text-muted);
          margin-bottom: var(--space-8);
        ">Agentic Music Discovery Engine</p>

        <!-- Feature list -->
        <div class="glass-card" style="padding: var(--space-5); margin-bottom: var(--space-6); text-align: left;">
          ${[
            ['Profiler',   'Builds your taste identity from Spotify data'],
            ['Scout',      'Maps the music graph to surface new discoveries'],
            ['Curator',    'Ranks tracks using multi-signal scoring'],
            ['Narrator',   'Explains every recommendation in plain language'],
          ].map(([name, desc]) => `
            <div style="display:flex;align-items:flex-start;gap:var(--space-3);
                        padding:var(--space-2) 0;border-bottom:1px solid var(--border-subtle);">
              <div style="width:6px;height:6px;border-radius:50%;background:var(--accent-primary);
                          margin-top:5px;flex-shrink:0;box-shadow:0 0 6px var(--accent-primary);"></div>
              <div>
                <span style="font-size:var(--font-size-xs);font-weight:var(--font-weight-semibold);
                             color:var(--text-bright);">${name}</span>
                <span style="font-size:var(--font-size-xs);color:var(--text-muted);margin-left:var(--space-2);">${desc}</span>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- CTA -->
        <button class="btn btn-primary btn-lg" id="spotify-login-btn"
                style="width:100%;gap:var(--space-3);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Connect with Spotify
        </button>

        <p style="color:var(--text-muted);font-size:var(--font-size-xs);margin-top:var(--space-4);line-height:1.5;">
          Read-only access to top artists &amp; tracks.<br>No data stored on external servers.
        </p>
      </div>
    </div>
  `;

  document.getElementById('spotify-login-btn').addEventListener('click', () => {
    redirectToSpotifyLogin();
  });
}
