/**
 * TasteGraph — Playlist View Component
 * Track list with audio previews and Session DJ integration.
 */

export class PlaylistView {
  constructor(container) {
    this.container = container;
    this._currentAudio = null;
    this._currentBtn = null;
    this._currentCandidate = null;
    this._listenStart = null;
  }


  /** Detect boilerplate curator reflection strings. */
  _isGenericReflection(text) {
    if (!text) return true;
    const generic = [
      'curated automatically based on intent and taste profile',
      'curated by the agent music pipeline',
    ];
    return generic.some(g => text.toLowerCase().includes(g));
  }

  /** Detect generic per-track explanation text. */
  _isGenericText(text) {
    if (!text) return true;
    const generic = [
      'selected based on your taste profile',
      'selected for this playlist based on your taste profile',
      'added to reach target playlist length',
    ];
    return generic.some(g => text.toLowerCase().includes(g));
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

    // Derive the best available title and summary from the context
    const playlistTitle = explanations?.playlistTitle
      || context.playlistName
      || context.sessionIntent?.slice(0, 60)
      || 'Your Playlist';

    // Best summary: playlistSummary → curatorReflection (if non-generic) → intent → nothing
    const playlistSummary = (() => {
      const s = explanations?.playlistSummary;
      if (s && !this._isGenericReflection(s)) return s;
      const r = context.curatorReflection;
      if (r && !this._isGenericReflection(r)) return r;
      return context.sessionIntent || '';
    })();

    this.container.innerHTML = `
      <div id="playlist-wrap" style="animation: fadeInUp 350ms ease forwards;">

        <!-- Summary bar -->
        <div class="pro-panel" style="padding:var(--space-4) var(--space-5);
             margin-bottom:var(--space-4);display:flex;justify-content:space-between;align-items:center;gap:var(--space-4);">
          <div style="flex:1;">
            <div class="section-label" style="margin-bottom:var(--space-1); font-size:var(--font-size-lg); color:var(--text-primary);">${playlistTitle}</div>
            ${playlistSummary ? `
            <p style="color:var(--text-secondary);font-size:var(--font-size-sm);
                      font-style:italic;margin-bottom:var(--space-2);">${playlistSummary}</p>` : ''}
          </div>
          ${context.savedToSpotify ? `
          <button id="btn-save-spotify" class="btn btn-sm" disabled
                  style="background:var(--bg-tertiary);color:var(--text-primary);border-color:var(--border-subtle);flex-shrink:0;font-weight:700;">
            Saved ✓
          </button>
          ` : `
          <button id="btn-save-spotify" class="btn btn-sm"
                  style="background:#1DB954;color:#000;border-color:#1DB954;flex-shrink:0;font-weight:700;">
            Save to Spotify
          </button>
          `}
        </div>

        <!-- Track list -->
        <div style="display:flex;flex-direction:column;gap:var(--space-2);">
          ${scoredPlaylist.map((c, i) => this._renderTrack(c, i, explanations)).join('')}
        </div>
      </div>
    `;

    // Save to Spotify
    const saveBtn = document.getElementById('btn-save-spotify');
    if (saveBtn && !context.savedToSpotify) {
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.innerText = 'Saving…';
        try {
          const { isAuthenticated, redirectToSpotifyLogin } = await import('../../auth/spotify-auth.js');
          if (!isAuthenticated()) { await redirectToSpotifyLogin(); return; }
          const { getCurrentUser, createPlaylist, addTracksToPlaylist } = await import('../../data/spotify-api.js');
          const { DataStore } = await import('../../data/data-store.js');

          const user = await getCurrentUser();
          const uris = scoredPlaylist.map(c => `spotify:track:${c.track.id}`);
          const pl = await createPlaylist(user.id, explanations?.playlistTitle || `Agent Music: ${new Date().toLocaleDateString()}`, explanations?.playlistSummary || '');
          await addTracksToPlaylist(pl.id, uris);
          
          context.savedToSpotify = true;
          if (context.id) DataStore.markPlaylistSavedToSpotify(context.id);

          saveBtn.innerText = 'Saved ✓';
          saveBtn.style.cssText += ';background:var(--bg-tertiary);color:var(--text-primary);border-color:var(--border-subtle);';
        } catch (err) {
          console.error('Save failed', err);
          saveBtn.innerText = 'Error';
          saveBtn.disabled = false;
        }
      });
    }

    // Wire up audio play/skip buttons
    this._attachAudioListeners(scoredPlaylist);
  }

  _renderTrack(candidate, index, explanations) {
    const { track, artistName, dominantFactor } = candidate;
    if (!track) return ''; // Safety: skip invalid entries
    const albumImg = track.album?.images?.[0]?.url;
    const previewUrl = track.preview_url || '';
    // Priority: Curator's dominantFactor (primary) > explanations map (fallback) > context-aware generic
    const mapExplanation = explanations?.trackExplanations instanceof Map
      ? explanations.trackExplanations.get(track.id)
      : explanations?.trackExplanations?.[track.id];
    // Use the real Curator reason, or silence the fallback — the badge provides visual context
    const explanation = (dominantFactor && !this._isGenericText(dominantFactor))
      ? dominantFactor
      : (mapExplanation && !this._isGenericText(mapExplanation))
        ? mapExplanation
        : '';

    return `
      <div class="glass-card" id="track-card-${index}"
           style="padding:var(--space-4);margin-bottom:var(--space-3);
                  border-left:2px solid transparent;
                  transition:border-color var(--transition-fast),background var(--transition-fast);"
           data-track-index="${index}"
           onmouseover="this.style.borderLeftColor='var(--accent-primary)';this.style.background='var(--bg-card-hover)';"
           onmouseout="this.style.borderLeftColor='transparent';this.style.background='';">

        <div style="display:flex;gap:var(--space-4);">
          <!-- Track Number -->
          <div style="width:24px;text-align:center;font-size:var(--font-size-md);
                      color:var(--text-muted);font-variant-numeric:tabular-nums;flex-shrink:0;padding-top:4px;">
            ${index + 1}
          </div>

          <!-- Album Art -->
          <div style="width:56px;height:56px;border-radius:var(--radius-md);
                      overflow:hidden;background:var(--bg-tertiary);flex-shrink:0;box-shadow:0 4px 12px rgba(0,0,0,0.2);">
            ${albumImg
              ? `<img src="${albumImg}" alt="" style="width:100%;height:100%;object-fit:cover;">`
              : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:24px;">♪</div>`
            }
          </div>

          <!-- Track Info & Explanation -->
          <div style="flex:1;min-width:0;">
            <div style="font-weight:var(--font-weight-bold);font-size:var(--font-size-md);
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-bright);">${track.name}</div>
            <div style="font-size:var(--font-size-sm);color:var(--text-secondary);margin-top:2px;${explanation ? 'margin-bottom:var(--space-2)' : ''};">${artistName}</div>
            ${explanation ? `<p style="font-size:var(--font-size-sm);color:var(--text-primary);line-height:1.5;">${explanation}</p>` : ''}
            ${previewUrl ? `
            <div style="margin-top:var(--space-2);">
              <audio id="audio-pl-${index}" src="${previewUrl}" preload="none"></audio>
              <button class="btn btn-ghost btn-sm playlist-play-btn" data-index="${index}"
                style="font-size:11px; padding:3px 10px; border:1px solid var(--border-glass); border-radius:var(--radius-full);
                       transition:all 0.2s;"
              >▶ Preview</button>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Wire audio play buttons to the Session DJ for skip/listen tracking.
   */
  _attachAudioListeners(scoredPlaylist) {
    const buttons = this.container.querySelectorAll('.playlist-play-btn');

    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        const audio = document.getElementById(`audio-pl-${idx}`);
        if (!audio) return;

        const isPlaying = btn.dataset.playing === 'true';

        // Stop any currently playing audio and report it to the DJ
        this._stopCurrent();

        if (!isPlaying) {
          // Start playing
          audio.play();
          btn.dataset.playing = 'true';
          btn.innerHTML = '⏸ Playing…';
          btn.style.borderColor = 'var(--accent-primary)';
          btn.style.color = 'var(--accent-primary)';
          this._currentAudio = audio;
          this._currentBtn = btn;
          this._currentCandidate = scoredPlaylist[idx];
          this._listenStart = Date.now();

          // When preview ends naturally → full listen → positive signal
          audio.onended = () => {
            btn.dataset.playing = 'false';
            btn.innerHTML = '▶ Preview';
            btn.style.borderColor = 'var(--border-glass)';
            btn.style.color = '';
            const candidate = scoredPlaylist[idx];
            if (candidate && window.TG?.dj) {
              window.TG.dj.recordListen(candidate);
            }
            this._currentAudio = null;
            this._currentBtn = null;
          };
        }
      });
    });
  }

  /**
   * Stop the currently playing preview and report skip duration to the DJ.
   */
  _stopCurrent() {
    if (this._currentAudio && this._currentBtn) {
      const listenMs = Date.now() - (this._listenStart || Date.now());
      this._currentAudio.pause();
      this._currentAudio.currentTime = 0;
      this._currentBtn.dataset.playing = 'false';
      this._currentBtn.innerHTML = '▶ Preview';
      this._currentBtn.style.borderColor = 'var(--border-glass)';
      this._currentBtn.style.color = '';

      // If they listened less than 10s before switching, it's a skip
      if (listenMs < 10000 && window.TG?.dj && this._currentCandidate) {
        window.TG.dj.recordSkip(this._currentCandidate, listenMs);
      }

      this._currentAudio = null;
      this._currentBtn = null;
      this._currentCandidate = null;
    }
  }
}
