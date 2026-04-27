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
            <div class="section-label" style="margin-bottom:var(--space-1); font-size:var(--font-size-lg); color:var(--text-primary);">${explanations?.playlistTitle || 'Generated Playlist'}</div>
            <p style="color:var(--text-secondary);font-size:var(--font-size-sm);
                      font-style:italic;">${explanations?.playlistSummary || 'Curated by the Agent Music pipeline based on your taste profile.'}</p>
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

    // Wire inspector panel
    this._wireInspector(scoredPlaylist, explanations);
  }

  _renderTrack(candidate, index, explanations) {
    const { track, artistName, dominantFactor, finalScore, breakdown = {}, hopDistance } = candidate;
    if (!track) return ''; // Safety: skip invalid entries
    const albumImg = track.album?.images?.[0]?.url;

    const factorColors = {
      elo:     'var(--accent-primary)',
      graph:   'var(--accent-cyan)',
      audio:   'var(--accent-amber)',
      session: 'var(--accent-green)',
    };
    const factorLabels = { elo: 'Taste', graph: 'Graph', audio: 'Audio', session: 'Session' };
    const factorColor = factorColors[dominantFactor] || 'var(--accent-primary)';

    const scorePercent = Math.round(finalScore * 100);
    const eloW   = Math.round((breakdown.eloComponent   || 0) * 100);
    const graphW = Math.round((breakdown.graphComponent  || 0) * 100);
    const audioW = Math.round((breakdown.audioComponent  || 0) * 100);
    const sessW  = Math.round((breakdown.sessionComponent|| 0) * 100);
    const hopLabel = ['Direct', 'Hop ×1', 'Hop ×2'][hopDistance] ?? '—';

    const metrics = [
      { label: 'Taste',   value: eloW,   color: 'var(--accent-primary)' },
      { label: 'Graph',   value: graphW, color: 'var(--accent-cyan)' },
      { label: 'Audio',   value: audioW, color: 'var(--accent-amber)' },
      { label: 'Session', value: sessW,  color: 'var(--accent-green)' },
    ];

    return `
      <div class="glass-card" id="track-card-${index}"
           style="padding:var(--space-3) var(--space-4);cursor:pointer;
                  border-left:2px solid transparent;
                  transition:border-color var(--transition-fast),background var(--transition-fast);"
           data-track-index="${index}"
           onmouseover="this.style.borderLeftColor='${factorColor}';this.style.background='var(--bg-card-hover)';"
           onmouseout="this.style.borderLeftColor='transparent';this.style.background='';">

        <!-- Top row -->
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

          <div style="flex:1;min-width:0;">
            <div style="font-weight:var(--font-weight-semibold);font-size:var(--font-size-sm);
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-bright);">${track.name}</div>
            <div style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-top:1px;">${artistName}</div>
          </div>

          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
            <span class="badge" style="background:${factorColor}18;color:${factorColor};border-color:${factorColor}30;">
              ${factorLabels[dominantFactor] || dominantFactor}
            </span>
            <span class="badge">${hopLabel}</span>
          </div>
        </div>

        <!-- Always-visible metric bars -->
        <div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--border-subtle);">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-2);">
            ${metrics.map(m => `
              <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                  <span style="font-size:var(--font-size-2xs);color:var(--text-muted);
                               text-transform:uppercase;letter-spacing:0.05em;">${m.label}</span>
                  <span style="font-size:var(--font-size-2xs);color:${m.color};
                               font-variant-numeric:tabular-nums;">${m.value}%</span>
                </div>
                <div class="metric-bar-track">
                  <div class="metric-bar-fill" style="width:${m.value}%;background:${m.color};"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  _wireInspector(scoredPlaylist, explanations) {
    scoredPlaylist.forEach((c, i) => {
      const card = document.getElementById(`track-card-${i}`);
      if (!card) return;
      card.addEventListener('click', () => this._showInspector(c, explanations));
    });
  }

  _showInspector(candidate, explanations) {
    const inspector = document.getElementById('inspector-content');
    if (!inspector) return;
    document.body.classList.add('inspector-open');

    const { track, artistName, dominantFactor, finalScore, breakdown = {}, hopDistance, tags } = candidate;
    const explanation = explanations?.trackExplanations?.get(track.id) || 'No explanation available.';
    const albumImg = track.album?.images?.[0]?.url;
    const scorePercent = Math.round(finalScore * 100);
    const hopLabel = ['Direct', 'Hop ×1', 'Hop ×2'][hopDistance] ?? '—';

    const metrics = [
      { label: 'Taste Match',    value: Math.round((breakdown.eloComponent   || 0) * 100), color: 'var(--accent-primary)' },
      { label: 'Graph Distance', value: Math.round((breakdown.graphComponent  || 0) * 100), color: 'var(--accent-cyan)' },
      { label: 'Audio Profile',  value: Math.round((breakdown.audioComponent  || 0) * 100), color: 'var(--accent-amber)' },
      { label: 'Session Match',  value: Math.round((breakdown.sessionComponent|| 0) * 100), color: 'var(--accent-green)' },
    ];

    const topTags = (tags || []).slice(0, 6).map(t => t.name || t).filter(Boolean);

    inspector.innerHTML = `
      <div style="position:relative;background:var(--bg-tertiary);">
        ${albumImg
          ? `<img src="${albumImg}" style="width:100%;aspect-ratio:1;object-fit:cover;display:block;opacity:0.65;">`
          : `<div style="width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:48px;">♪</div>`
        }
        <div style="position:absolute;bottom:0;left:0;right:0;
                    padding:var(--space-3) var(--space-4);
                    background:linear-gradient(transparent,rgba(6,13,26,0.96));">
          <div style="font-weight:var(--font-weight-bold);color:var(--text-bright);
                      font-size:var(--font-size-sm);">${track.name}</div>
          <div style="font-size:var(--font-size-xs);color:var(--text-secondary);">${artistName}</div>
        </div>
      </div>

      <div class="inspector-section">
        <div class="inspector-metric">
          <span class="inspector-metric-label">Relevance Score</span>
          <span class="inspector-metric-value" style="font-size:var(--font-size-lg);">${scorePercent}%</span>
        </div>
        <div class="metric-bar-track" style="height:4px;">
          <div class="metric-bar-fill"
               style="width:${scorePercent}%;background:linear-gradient(90deg,var(--accent-primary),var(--accent-indigo));"></div>
        </div>
      </div>

      <div class="inspector-section">
        <div class="inspector-title" style="margin-bottom:var(--space-3);">Signal Breakdown</div>
        ${metrics.map(m => `
          <div class="inspector-metric">
            <span class="inspector-metric-label">${m.label}</span>
            <span class="inspector-metric-value" style="color:${m.color};">${m.value}%</span>
          </div>
          <div class="metric-bar-track" style="margin-bottom:var(--space-3);">
            <div class="metric-bar-fill" style="width:${m.value}%;background:${m.color};"></div>
          </div>
        `).join('')}
      </div>

      <div class="inspector-section">
        <div class="inspector-title" style="margin-bottom:var(--space-3);">Discovery Path</div>
        <div class="inspector-metric">
          <span class="inspector-metric-label">Graph Distance</span>
          <span class="badge badge-blue">${hopLabel}</span>
        </div>
        <div class="inspector-metric" style="margin-top:var(--space-2);">
          <span class="inspector-metric-label">Primary Signal</span>
          <span class="badge badge-blue">${dominantFactor}</span>
        </div>
      </div>

      ${topTags.length > 0 ? `
        <div class="inspector-section">
          <div class="inspector-title" style="margin-bottom:var(--space-3);">Tags</div>
          <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">
            ${topTags.map(t => `<span class="badge">${t}</span>`).join('')}
          </div>
        </div>
      ` : ''}

      <div class="inspector-section">
        <div class="inspector-title" style="margin-bottom:var(--space-3);">Agent Rationale</div>
        <p style="font-size:var(--font-size-xs);color:var(--text-secondary);
                  line-height:1.65;font-style:italic;">${explanation}</p>
      </div>
    `;
  }
}
