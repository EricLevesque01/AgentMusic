/**
 * TasteGraph — Playlist View Component
 * Renders the scored playlist with explanations, score breakdowns, and feedback buttons.
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
          <p style="color: var(--text-muted);">No tracks found. Try broadening your Discovery slider.</p>
        </div>
      `;
      return;
    }

    this.container.innerHTML = `
      <div id="playlist-wrap" style="animation: fadeInUp 400ms ease forwards;">
        <div class="glass-card" style="padding: var(--space-5); margin-bottom: var(--space-6); border-left: 3px solid var(--accent-primary);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="font-size: var(--font-size-sm); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: var(--space-2); font-weight: var(--font-weight-semibold);">Playlist Summary</div>
              <p style="color: var(--text-primary); font-style: italic;">${explanations.playlistSummary}</p>
            </div>
            <button id="btn-save-spotify" class="btn" style="background: #1DB954; color: black; border-color: #1DB954; flex-shrink: 0; margin-left: var(--space-4);">
              Save to Spotify
            </button>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: var(--space-3);">
          ${scoredPlaylist.map((c, i) => this._renderTrack(c, i, explanations)).join('')}
        </div>
      </div>
    `;

    // Attach Save to Spotify listener
    const saveBtn = document.getElementById('btn-save-spotify');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.innerText = 'Saving...';
        
        try {
          const { isAuthenticated, redirectToSpotifyLogin } = await import('../../auth/spotify-auth.js');
          if (!isAuthenticated()) {
            saveBtn.innerText = 'Redirecting to Spotify...';
            await redirectToSpotifyLogin();
            return;
          }

          const { getCurrentUser, createPlaylist, addTracksToPlaylist } = await import('../../data/spotify-api.js');
          
          const user = await getCurrentUser();
          const uris = scoredPlaylist.map(c => `spotify:track:${c.track.id}`);
          
          const playlistName = `TasteGraph Agent: ${new Date().toLocaleDateString()}`;
          const playlistDesc = `Curated by TasteGraph AI: ${explanations.playlistSummary}`;
          
          const newPlaylist = await createPlaylist(user.id, playlistName, playlistDesc);
          await addTracksToPlaylist(newPlaylist.id, uris);
          
          saveBtn.innerText = 'Saved!';
          saveBtn.style.background = 'var(--bg-tertiary)';
          saveBtn.style.color = 'var(--text-primary)';
          saveBtn.style.borderColor = 'var(--border-subtle)';
        } catch (err) {
          console.error("Failed to save playlist", err);
          saveBtn.innerText = 'Error';
          saveBtn.disabled = false;
        }
      });
    }

    // Attach expand listeners
    scoredPlaylist.forEach((c, i) => {
      const card = document.getElementById(`track-card-${i}`);
      const details = document.getElementById(`track-details-${i}`);
      if (card && details) {
        card.addEventListener('click', () => {
          const isOpen = details.style.display !== 'none';
          details.style.display = isOpen ? 'none' : 'block';
        });
      }
    });
  }

  _renderTrack(candidate, index, explanations) {
    const { track, artistName, dominantFactor, finalScore, breakdown, source, hopDistance } = candidate;
    const explanation = explanations.trackExplanations.get(track.id) || '';
    const albumImg = track.album?.images?.[0]?.url;

    const factorColors = {
      elo:     'var(--accent-primary)',
      graph:   'var(--accent-secondary)',
      audio:   'var(--accent-amber)',
      session: 'var(--accent-pink)',
    };
    const factorEmoji = { elo: '⭐', graph: '🕸️', audio: '🎵', session: '🎯' };
    const factorColor = factorColors[dominantFactor] || 'var(--accent-primary)';

    const scorePercent = Math.round(finalScore * 100);
    const eloW   = Math.round(breakdown.eloComponent * 100);
    const graphW = Math.round(breakdown.graphComponent * 100);
    const audioW = Math.round(breakdown.audioComponent * 100);
    const sessW  = Math.round(breakdown.sessionComponent * 100);

    const hopLabel = hopDistance === 0 ? 'Your artist'
      : hopDistance === 1 ? '1 hop away'
      : '2 hops away';

    return `
      <div class="glass-card" id="track-card-${index}" style="padding: var(--space-4); cursor: pointer; transition: all var(--transition-base);"
           onmouseover="this.style.borderColor='${factorColor}'" onmouseout="this.style.borderColor='var(--border-glass)'">
        <div style="display: flex; align-items: center; gap: var(--space-4);">
          <!-- Index -->
          <div style="width: 28px; text-align: center; font-size: var(--font-size-sm); color: var(--text-muted); font-weight: var(--font-weight-bold); flex-shrink: 0;">
            ${index + 1}
          </div>

          <!-- Album Art -->
          <div style="width: 52px; height: 52px; border-radius: var(--radius-md); overflow: hidden; background: var(--bg-tertiary); flex-shrink: 0;">
            ${albumImg
              ? `<img src="${albumImg}" alt="" style="width:100%;height:100%;object-fit:cover;">`
              : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🎵</div>`
            }
          </div>

          <!-- Track Info -->
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: var(--font-weight-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${track.name}</div>
            <div style="font-size: var(--font-size-sm); color: var(--text-secondary);">${artistName}</div>
          </div>

          <!-- Dominant Factor Badge -->
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;">
            <span class="badge" style="background: ${factorColor}22; color: ${factorColor}; border-color: ${factorColor}44; font-size: 11px;">
              ${factorEmoji[dominantFactor]} ${dominantFactor}
            </span>
            <span style="font-size: 10px; color: var(--text-muted);">${hopLabel}</span>
          </div>
        </div>

        <!-- Expandable details -->
        <div id="track-details-${index}" style="display: none; margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border-subtle);">
          <!-- Explanation -->
          <p style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--space-3); font-style: italic;">
            💬 ${explanation}
          </p>

          <!-- Score breakdown bar -->
          <div style="margin-bottom: var(--space-2);">
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">Score breakdown (${scorePercent}%)</div>
            <div style="display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 2px;">
              <div style="width: ${eloW}%; background: var(--accent-primary); border-radius: 4px;"></div>
              <div style="width: ${graphW}%; background: var(--accent-secondary); border-radius: 4px;"></div>
              <div style="width: ${audioW}%; background: var(--accent-amber); border-radius: 4px;"></div>
              <div style="width: ${sessW}%; background: var(--accent-pink); border-radius: 4px;"></div>
            </div>
            <div style="display: flex; gap: var(--space-3); margin-top: 6px; flex-wrap: wrap;">
              ${[['⭐ Taste', eloW, 'var(--accent-primary)'], ['🕸️ Graph', graphW, 'var(--accent-secondary)'],
                 ['🎵 Audio', audioW, 'var(--accent-amber)'], ['🎯 Session', sessW, 'var(--accent-pink)']
                ].map(([l, v, c]) => `<span style="font-size:10px;color:${c};">${l}: ${v}%</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
