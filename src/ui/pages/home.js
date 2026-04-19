/**
 * TasteGraph — Home Page
 */
export function renderHomePage(container) {
  container.innerHTML = `
    <div class="page" id="page-home">
      <header class="page-header text-center">
        <h1 class="page-title">TasteGraph</h1>
        <p class="page-subtitle">Multi-Agent Playlist Curator</p>
      </header>

      <div class="section">
        <div class="glass-card" style="padding: var(--space-6); text-align: center;">
          <div style="font-size: 3rem; margin-bottom: var(--space-4); display: flex; justify-content: center;">🎧</div>
          <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); margin-bottom: var(--space-3);">
            Welcome to TasteGraph
          </h2>
          <p style="color: var(--text-secondary); max-width: 480px; margin: 0 auto var(--space-6);">
            Discover music through six specialized AI agents that understand your taste,
            explore new sounds, and explain every recommendation.
          </p>
          <div class="flex justify-center gap-4" style="flex-wrap: wrap;">
            <button class="btn btn-primary btn-lg" onclick="location.hash='#/game'" style="display: flex; align-items: center; gap: 8px;">
              ⚔️ Compare Artists
            </button>
            <button class="btn btn-secondary btn-lg" onclick="location.hash='#/playlist'" style="display: flex; align-items: center; gap: 8px;">
              🎵 Generate Playlist
            </button>
          </div>
        </div>
      </div>

      <div class="section">
        <h3 class="section-title">Your Agent Crew</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-4);">
          ${agentCard('🔍', 'Profiler', 'Builds your taste identity from Spotify data and game results.')}
          ${agentCard('🧭', 'Scout', 'Explores the music graph to discover new candidates.')}
          ${agentCard('🎯', 'Curator', 'Scores and ranks tracks using your preferences and sliders.')}
          ${agentCard('💬', 'Narrator', 'Explains why every track was chosen for you.')}
          ${agentCard('🎧', 'Session DJ', 'Adapts in real-time when the vibe is off.')}
          ${agentCard('🤖', 'Concierge', 'Chat naturally to fine-tune your recommendations.')}
        </div>
      </div>
    </div>
  `;
}

function agentCard(emoji, name, desc) {
  return `
    <div class="glass-card" style="padding: var(--space-4);">
      <div style="font-size: 1.75rem; margin-bottom: var(--space-2); color: var(--accent-primary);">${emoji}</div>
      <div style="font-weight: var(--font-weight-semibold); margin-bottom: var(--space-1);">${name}</div>
      <div style="font-size: var(--font-size-sm); color: var(--text-secondary);">${desc}</div>
    </div>
  `;
}
