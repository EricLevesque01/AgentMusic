import { SliderPanel } from '../components/slider-panel.js';
import { AgentStatus } from '../components/agent-status.js';
import { Orchestrator } from '../../agents/orchestrator.js';
import { PlaylistView } from '../components/playlist-view.js';

/**
 * TasteGraph — Playlist Page
 */
export function renderPlaylistPage(container) {
  container.innerHTML = `
    <div class="page" id="page-playlist">
      <header class="page-header text-center">
        <h1 class="page-title">Curate</h1>
        <p class="page-subtitle">Dial in your vibe</p>
      </header>

      <div id="slider-container"></div>
      
      <div id="status-container"></div>

      <div style="text-align: center; margin-top: var(--space-6);">
        <button class="btn btn-primary btn-lg" id="generate-btn" style="width: 100%; max-width: 300px;">
          <span style="font-size: 1.25rem; margin-right: 8px;">✨</span> Generate Playlist
        </button>
      </div>

      <div id="playlist-results" style="margin-top: var(--space-8);"></div>
    </div>
  `;

  // Use the global Orchestrator singleton (shared with ChatPanel)
  const sliderPanel = new SliderPanel(document.getElementById('slider-container'));
  sliderPanel.render();

  const statusPanel = new AgentStatus(document.getElementById('status-container'));

  // Use global orchestrator if available, else create local one
  const orchestrator = window.TG?.orchestrator || new Orchestrator((stage, isDone) => {
    statusPanel.update(stage, isDone);
  });

  // Wire status callback into global orchestrator
  if (window.TG?.orchestrator) {
    window.TG.orchestrator.statusCallback = (stage, isDone) => statusPanel.update(stage, isDone);
  }

  // Handle generation
  const resultsEl    = document.getElementById('playlist-results');
  const playlistView = new PlaylistView(resultsEl);

  // Re-render when Concierge/DJ updates the playlist
  window.addEventListener('tastegraph:playlist-updated', () => {
    const ctx = window.TG?.lastContext;
    if (ctx) playlistView.render(ctx);
  });

  document.getElementById('generate-btn').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    btn.disabled = true;
    btn.innerHTML = `<span class="pipeline-dot active" style="display:inline-block;width:16px;height:16px;margin-right:8px;"></span> Working...`;
    resultsEl.innerHTML = '';

    try {
      const context = await orchestrator.generatePlaylist('user_local', sliderPanel.getValues());
      window.TG.lastContext = context; // share with ChatPanel + DJ
      playlistView.render(context);
    } catch (err) {
      resultsEl.innerHTML = `
        <div class="glass-card" style="padding: var(--space-6); text-align: center; border-color: var(--accent-pink);">
          <div style="font-size: 2rem; margin-bottom: var(--space-3);">⚠️</div>
          <p style="color: var(--text-primary); font-weight: var(--font-weight-medium);">Generation failed</p>
          <p style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: var(--space-2);">${err.message}</p>
        </div>
      `;
      console.error('Pipeline error:', err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span style="font-size: 1.25rem; margin-right: 8px;">✨</span> Regenerate`;
    }
  });
}

