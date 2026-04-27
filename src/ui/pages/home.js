/**
 * TasteGraph — Home Page
 * Clean entry point: two primary actions, nothing more.
 */
export function renderHomePage(container) {
  container.innerHTML = `
    <div class="page" id="page-home" style="
      min-height: calc(100vh - 40px);
      display: flex;
      flex-direction: column;
      justify-content: center;
      max-width: 600px;
      padding-top: var(--space-12);
    ">

      <div style="margin-bottom: var(--space-10);">
        <h1 style="
          font-size: 2.25rem;
          font-weight: var(--font-weight-extrabold);
          letter-spacing: -0.04em;
          line-height: 1.15;
          margin-bottom: var(--space-3);
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        ">Agent Music</h1>
        <p style="
          font-size: var(--font-size-base);
          color: var(--text-secondary);
          line-height: 1.6;
          max-width: 420px;
        ">Rate artists head-to-head, then get a personalized playlist with a breakdown of every recommendation.</p>
      </div>

      <div style="display: flex; flex-direction: column; gap: var(--space-3); max-width: 320px;">
        <button class="btn btn-primary btn-lg" onclick="location.hash='#/playlist'" style="justify-content: flex-start; box-shadow: var(--shadow-glow-strong);">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <path d="M2 4h12M2 8h8M2 12h5"/>
            <circle cx="13" cy="11" r="2"/>
            <path d="M13 9V5l2 1"/>
          </svg>
          Generate Playlist
        </button>
        <button class="btn btn-secondary btn-lg" onclick="location.hash='#/game'" style="justify-content: flex-start;">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <circle cx="4" cy="8" r="3"/><circle cx="12" cy="8" r="3"/>
            <path d="M7 8h2"/>
          </svg>
          Compare Artists
        </button>
        <button class="btn btn-ghost" onclick="location.hash='#/profile'" style="justify-content: flex-start; font-size: var(--font-size-sm);">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <circle cx="8" cy="5" r="3"/><path d="M1 14c0-3.314 3.134-6 7-6s7 2.686 7 6"/>
          </svg>
          View Sonic Profile
        </button>
      </div>

    </div>
  `;
}
