/**
 * TasteGraph — Playlist View Component (v2 — Deep Space Pro)
 * Pro-tool track list with always-visible metric bars and
 * right-panel Node Inspector integration.
 */

export class PlaylistView {
  constructor(container) {
    this.container = container;
  }

  render(context) {
    const { scoredPlaylist, explanations } = context;
    if (!scoredPlaylist || scoredPlaylist.length === 0) {
      this.container.innerHTML = `
        <div class="glass-card" style="padding: var(--space-8); text-align: center;">
          <p style="color: var(--text-muted);">No tracks found. Try a broader vibe description.</p>
        </div>
      `;
      return;
    }

    this.container.innerHTML = `
      <div id="playlist-wrap" style="animation: fadeInUp 350ms ease forwards;">

        <!-- Summary bar -->
        <div class="pro-panel" style="padding:var(--space-4) var(--space-5);
             margin-bottom:var(--space-4);display:flex;justify-content:space-between;align-items:center;gap:var(--space-4);">
          <div style="flex:1;">
            <div class="section-label" style="margin-bottom:var(--space-2); font-size:var(--font-size-lg); color:var(--text-primary); font-weight:var(--font-weight-bold);">${explanations?.playlistTitle || 'Generated Playlist'}</div>
            <p style="color:var(--text-secondary); font-size:var(--font-size-md); line-height:1.6;">
              ${explanations?.playlistSummary || 'Curated by the Agent Music pipeline based on your taste profile.'}
            </p>
          </div>
          <button id="btn-save-spotify" class="btn btn-sm"
                  style="background:#1DB954;color:#000;border-color:#1DB954;flex-shrink:0;font-weight:700;">
            Save to Spotify
          </button>
        </div>

        <!-- Track list -->
        <div style="display:flex;flex-direction:column;gap:var(--space-2);">
          ${scoredPlaylist.map((c, i) => this._renderTrack(c, i, explanations)).join('')}
        </div>
      </div>
    `;

    // Save to Spotify
    const saveBtn = document.getElementById('btn-save-spotify');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.innerText = 'Saving…';
        try {
          const { isAuthenticated, redirectToSpotifyLogin } = await import('../../auth/spotify-auth.js');
          if (!isAuthenticated()) { await redirectToSpotifyLogin(); return; }
          const { getCurrentUser, createPlaylist, addTracksToPlaylist } = await import('../../data/spotify-api.js');
          const user = await getCurrentUser();
          const uris = scoredPlaylist.map(c => `spotify:track:${c.track.id}`);
          const pl = await createPlaylist(user.id, explanations?.playlistTitle || `TasteGraph: ${new Date().toLocaleDateString()}`, explanations?.playlistSummary || '');
          await addTracksToPlaylist(pl.id, uris);
          saveBtn.innerText = 'Saved ✓';
          saveBtn.style.cssText += ';background:var(--bg-tertiary);color:var(--text-primary);border-color:var(--border-subtle);';
        } catch (err) {
          console.error('Save failed', err);
          saveBtn.innerText = 'Error';
          saveBtn.disabled = false;
        }
      });
    }
  }

  _renderTrack(candidate, index, explanations) {
    const { track, artistName, dominantFactor, finalScore, breakdown = {}, hopDistance } = candidate;
    if (!track) return ''; // Safety: skip invalid entries
    const albumImg = track.album?.images?.[0]?.url;

    return `
      <div class="glass-card" id="track-card-${index}"
           style="padding:var(--space-3) var(--space-4);"
           data-track-index="${index}">

        <div style="display:flex;align-items:center;gap:var(--space-3);">
          <div style="width:22px;text-align:center;font-size:var(--font-size-xs);
                      color:var(--text-muted);font-variant-numeric:tabular-nums;flex-shrink:0;">
            ${index + 1}
          </div>

          <div style="width:44px;height:44px;border-radius:var(--radius-md);
                      overflow:hidden;background:var(--bg-tertiary);flex-shrink:0;">
            ${albumImg
              ? `<img src="${albumImg}" alt="" style="width:100%;height:100%;object-fit:cover;">`
              : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:18px;">♪</div>`
            }
          </div>

          <div style="flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="font-weight:var(--font-weight-semibold);font-size:var(--font-size-md);
                          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-bright);">${track.name}</div>
              <div style="font-size:var(--font-size-sm);color:var(--text-secondary);margin-top:2px;">${artistName}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
