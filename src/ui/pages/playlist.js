import { AgentStatus } from '../components/agent-status.js';
import { PlaylistView } from '../components/playlist-view.js';
import { DataStore } from '../../data/data-store.js';

export function renderPlaylistPage(container) {
  container.innerHTML = `
    <div class="page" id="page-playlist">
      <header class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
        <h1 class="page-title">Playlists</h1>
        <button class="btn btn-ghost" id="toggle-generator-btn">+ New</button>
      </header>

      <div id="generator-section" style="display:none; background:var(--bg-card); padding:var(--space-5); border-radius:var(--radius-lg); border: 1px solid var(--border-subtle); margin-bottom:var(--space-6);">
        <h3 style="margin-bottom:var(--space-2); font-size:var(--font-size-lg); display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--accent-primary); font-size: 24px;">✨</span> What's the vibe?
        </h3>
        <p style="color: var(--text-muted); font-size: var(--font-size-sm); margin-bottom: var(--space-4);">Tell the agents exactly what kind of playlist you want right now.</p>
        
        <textarea id="vibe-input" rows="3" placeholder="e.g. 'Late night driving', 'Focusing on work, no lyrics', or 'Just play my S-Tier favorites...'" 
          style="width: 100%; background: var(--bg-surface); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: var(--space-3); color: var(--text-primary); font-family: var(--font-family); font-size: var(--font-size-md); resize: none; margin-bottom: var(--space-4); outline: none; transition: border-color var(--transition-fast);"
          onfocus="this.style.borderColor='var(--accent-primary)'" onblur="this.style.borderColor='var(--border-glass)'"></textarea>

        <div id="status-container"></div>
        <div style="text-align: center; margin-top: var(--space-4);">
          <button class="btn btn-primary btn-lg" id="generate-btn" style="width: 100%; max-width: 300px;">
            Generate Playlist
          </button>
        </div>
      </div>

      <div id="playlist-results"></div>
      
      <div id="library-section" style="margin-top: var(--space-8);">
        <h2 style="font-size: var(--font-size-xl); margin-bottom: var(--space-4); color: var(--text-secondary);">Saved Playlists</h2>
        <div id="saved-playlists-list" style="display:flex; flex-direction:column; gap:var(--space-3);"></div>
      </div>
    </div>
  `;

  const statusPanel = new AgentStatus(document.getElementById('status-container'));

  // Always reuse the global Orchestrator singleton
  // (set by main.js after Spotify auth completes)
  let orchestrator = window.TG?.orchestrator;

  // Live-bind: if the page was mounted before TG was ready, pick it up on first generate
  function getOrchestrator() {
    if (!orchestrator) orchestrator = window.TG?.orchestrator;
    if (orchestrator) {
      orchestrator.statusCallback = (stage, isDone) => statusPanel.update(stage, isDone);
      orchestrator.thoughtCallback = (thought) => statusPanel.addThought(thought);
    }
    return orchestrator;
  }

  // Wire callbacks now if already available
  if (orchestrator) {
    orchestrator.statusCallback = (stage, isDone) => statusPanel.update(stage, isDone);
    orchestrator.thoughtCallback = (thought) => statusPanel.addThought(thought);
  }

  const resultsEl    = document.getElementById('playlist-results');
  const playlistView = new PlaylistView(resultsEl);
  const generatorSection = document.getElementById('generator-section');
  const librarySection = document.getElementById('library-section');
  
  // Toggle Generator
  document.getElementById('toggle-generator-btn').addEventListener('click', () => {
    const isHidden = generatorSection.style.display === 'none';
    generatorSection.style.display = isHidden ? 'block' : 'none';
  });

  // Render Library
  function renderLibrary() {
    const listEl = document.getElementById('saved-playlists-list');
    const playlists = DataStore.getSavedPlaylists();
    if (playlists.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding:var(--space-6); color:var(--text-muted);">No playlists yet. Generate one above!</div>`;
      return;
    }

    listEl.innerHTML = playlists.map(p => {
      const title = p.context?.explanations?.playlistTitle || p.context?.playlistTitle || (p.context?.sessionIntent?.slice(0, 60) || 'Curated Playlist');
      const desc = p.context?.curatorReflection || p.context?.explanations?.playlistSummary || p.context?.playlistSummary || '';
      const trackCount = p.context?.scoredPlaylist?.length || 0;
      const date = new Date(p.createdAt).toLocaleDateString();
      return `
        <div class="glass-card" style="padding:var(--space-4); display:flex; justify-content:space-between; align-items:center;">
          <div style="flex:1; padding-right:var(--space-4);">
            <h4 style="margin:0; font-size:var(--font-size-md); font-weight:var(--font-weight-bold);">${title}</h4>
            ${desc ? `<div style="font-size:var(--font-size-sm); color:var(--text-secondary); margin-top:6px; line-height:1.4;">${desc}</div>` : ''}
            <div style="font-size:var(--font-size-xs); color:var(--text-muted); margin-top:8px;">
              ${trackCount} tracks • Generated ${date}
            </div>
          </div>
          <div style="display:flex;gap:var(--space-2);">
            <button class="btn btn-primary btn-sm view-btn" data-id="${p.id}">View</button>
            ${p.context.savedToSpotify ? `
              <button class="btn btn-ghost btn-sm" disabled style="color:var(--text-primary);">
                ✅ Saved
              </button>
            ` : `
              <button class="btn btn-ghost btn-sm export-btn" data-id="${p.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="margin-right:4px;">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>Export
              </button>
            `}
            <button class="btn btn-ghost btn-icon btn-sm delete-btn" data-id="${p.id}" aria-label="Delete">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach listeners
    listEl.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const p = DataStore.getSavedPlaylists().find(x => x.id === id);
        if (p) {
          window.TG.lastContext = p.context;
          playlistView.render(p.context);
          generatorSection.style.display = 'none';
          librarySection.style.display = 'none';
          
          // Add a back button to resultsEl
          const backBtn = document.createElement('button');
          backBtn.className = 'btn btn-ghost';
          backBtn.innerHTML = '← Back to Library';
          backBtn.style.marginBottom = 'var(--space-4)';
          backBtn.onclick = () => {
            resultsEl.innerHTML = '';
            librarySection.style.display = 'block';
            window.scrollTo(0,0);
          };
          resultsEl.insertBefore(backBtn, resultsEl.firstChild);
        }
      });
    });

    listEl.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        DataStore.deleteSavedPlaylist(id);
        renderLibrary();
      });
    });

    listEl.querySelectorAll('.export-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const p = DataStore.getSavedPlaylists().find(x => x.id === id);
        if (!p) return;
        
        const originalText = e.currentTarget.innerHTML;
        e.currentTarget.innerHTML = 'Exporting...';
        e.currentTarget.disabled = true;
        
        try {
          const { isAuthenticated, redirectToSpotifyLogin } = await import('../../auth/spotify-auth.js');
          if (!isAuthenticated()) { await redirectToSpotifyLogin(); return; }
          const { getCurrentUser, createPlaylist, addTracksToPlaylist } = await import('../../data/spotify-api.js');
          
          const user = await getCurrentUser();
          const uris = p.context.scoredPlaylist.map(c => `spotify:track:${c.track.id}`);
          const pl = await createPlaylist(user.id, `TasteGraph: ${new Date().toLocaleDateString()}`, p.context.playlistSummary || 'TasteGraph Curated Mix');
          await addTracksToPlaylist(pl.id, uris);
          
          DataStore.markPlaylistSavedToSpotify(id);
          e.currentTarget.innerHTML = '✅ Saved';
          e.currentTarget.classList.remove('export-btn');
          e.currentTarget.style.color = 'var(--text-primary)';
        } catch (err) {
          console.error(err);
          e.currentTarget.innerHTML = '❌ Failed';
          e.currentTarget.disabled = false;
        }
      });
    });
  }

  renderLibrary();

  window.addEventListener('tastegraph:playlist-updated', () => {
    const ctx = window.TG?.lastContext;
    if (ctx) {
      playlistView.render(ctx);
      // DataStore save happens down in generate block or elsewhere, but we can re-render library
      renderLibrary();
    }
  });

  document.getElementById('generate-btn').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    const vibe = document.getElementById('vibe-input').value.trim();
    
    btn.disabled = true;
    btn.innerHTML = `<span class="pipeline-dot active" style="display:inline-block;width:16px;height:16px;margin-right:8px;"></span> Working...`;
    resultsEl.innerHTML = '';

    const orch = getOrchestrator();
    if (!orch) {
      resultsEl.innerHTML = `
        <div class="glass-card" style="padding: var(--space-6); text-align: center; border-color: var(--accent-pink);">
          <div style="font-size: 2rem; margin-bottom: var(--space-3);">⚠️</div>
          <p style="color: var(--text-primary); font-weight: var(--font-weight-medium);">Pipeline not ready</p>
          <p style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: var(--space-2);">Connect Spotify first, then try again.</p>
        </div>
      `;
      btn.disabled = false;
      btn.innerHTML = 'Generate Playlist';
      return;
    }

    try {
      const context = await orch.generatePlaylist('user_local', vibe);
      window.TG.lastContext = context;
      
      // Save it to library (populates both playlist_library and legacy saved_playlists)
      DataStore.saveToLibrary(context, vibe, 'manual');
      window.dispatchEvent(new CustomEvent('tastegraph:playlist-updated'));
      
      playlistView.render(context);
      generatorSection.style.display = 'none';
      librarySection.style.display = 'none';

      // Add back button
      const backBtn = document.createElement('button');
      backBtn.className = 'btn btn-ghost';
      backBtn.innerHTML = '← Back to Library';
      backBtn.style.marginBottom = 'var(--space-4)';
      backBtn.onclick = () => {
        resultsEl.innerHTML = '';
        librarySection.style.display = 'block';
        renderLibrary();
      };
      resultsEl.insertBefore(backBtn, resultsEl.firstChild);
      
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
      btn.innerHTML = `Generate Playlist`;
    }
  });
}


