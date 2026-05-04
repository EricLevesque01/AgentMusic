/**
 * TasteGraph — Home Page (Agentic Spotify Discovery Feed)
 * Spotify-style grid of pre-generated playlists + suggested artists row.
 * The primary discovery surface — users see curated content immediately.
 */

import { DataStore } from '../../data/data-store.js';
import { createPlaylistCard, createSkeletonCard } from '../components/playlist-card.js';
import { renderSuggestionRow } from '../components/artist-suggestion-row.js';
import { PlaylistView } from '../components/playlist-view.js';
import { SuggestedArtistsAgent } from '../../agents/suggested-artists.js';

export function renderHomePage(container) {
  container.innerHTML = `
    <div class="page" id="page-home" style="max-width: 960px; padding-top: var(--space-6);">

      <header style="margin-bottom: var(--space-6);">
        <h1 style="
          font-size: 1.75rem;
          font-weight: var(--font-weight-extrabold);
          letter-spacing: -0.04em;
          line-height: 1.15;
          margin-bottom: var(--space-1);
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        ">Discover</h1>
        <p style="font-size: var(--font-size-sm); color: var(--text-muted);">
          Playlists curated by your AI agents — powered by real music research.
        </p>
      </header>

      <!-- Suggested Artists Row -->
      <div id="suggestion-row-container"></div>

      <!-- Playlist Grid -->
      <div id="playlist-grid-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4);">
        <h2 class="section-label" style="margin: 0;">Your Playlists</h2>
        <button class="btn btn-ghost btn-sm" id="home-new-playlist-btn" style="font-size: var(--font-size-xs);">+ New</button>
      </div>
      <div id="playlist-grid" class="playlist-grid"></div>

      <!-- Discovery Stats -->
      <div id="discovery-stats" class="discovery-stats" style="margin-top: var(--space-8);"></div>

      <!-- Playlist detail view (hidden until a card is clicked) -->
      <div id="home-playlist-detail" style="display: none;"></div>
    </div>
  `;

  const gridEl = document.getElementById('playlist-grid');
  const detailEl = document.getElementById('home-playlist-detail');
  const suggestionContainer = document.getElementById('suggestion-row-container');
  const statsEl = document.getElementById('discovery-stats');
  const playlistView = new PlaylistView(detailEl);

  // === Render playlist grid ===
  function renderGrid() {
    const library = DataStore.getPlaylistLibrary();
    const legacy = DataStore.getSavedPlaylists();

    // Merge: prefer library entries, fall back to legacy
    let playlists = library.length > 0 ? library : legacy.map(p => ({
      id: p.id,
      createdAt: p.createdAt,
      listenedAt: null,
      intent: p.context?.sessionIntent || '',
      source: 'legacy',
      title: p.context?.explanations?.playlistTitle || p.context?.playlistName || 'Curated Mix',
      trackCount: p.context?.scoredPlaylist?.length || 0,
      curatorReflection: p.context?.curatorReflection || '',
      context: p.context,
    }));

    if (playlists.length === 0) {
      gridEl.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: var(--space-8) var(--space-4);">
          <div style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, rgba(61,139,255,0.2), rgba(99,102,241,0.15)); display: flex; align-items: center; justify-content: center; margin-bottom: var(--space-5); box-shadow: 0 0 30px rgba(61,139,255,0.15);">
            <span style="font-size: 2rem;">✨</span>
          </div>
          <h3 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); margin-bottom: var(--space-2); color: var(--text-bright);">Your Discovery Feed</h3>
          <p style="color: var(--text-secondary); margin-bottom: var(--space-5); max-width: 360px; line-height: 1.6;">
            AI agents will curate personalized playlists here. Get started by ranking your favorite artists or describing a vibe.
          </p>
          <div style="display: flex; gap: var(--space-3); flex-wrap: wrap; justify-content: center;">
            <button class="btn btn-primary btn-lg" onclick="location.hash='#/playlist'; setTimeout(() => document.getElementById('toggle-generator-btn')?.click(), 200)">
              <span style="margin-right: 6px;">🎵</span> Generate a Playlist
            </button>
            <button class="btn btn-secondary" onclick="location.hash='#/game'">Compare Artists</button>
          </div>
        </div>
      `;
      return;
    }

    gridEl.innerHTML = '';
    for (const p of playlists) {
      const card = createPlaylistCard(p, (playlist) => openPlaylistDetail(playlist));
      gridEl.appendChild(card);
    }

    // If scheduler is running, show skeleton
    const state = DataStore.getSchedulerState();
    if (state.isRunning) {
      gridEl.appendChild(createSkeletonCard());
    }
  }

  // === Open playlist detail ===
  function openPlaylistDetail(playlist) {
    // Mark as listened
    DataStore.markPlaylistListened(playlist.id);

    // Hide grid, show detail
    gridEl.style.display = 'none';
    suggestionContainer.style.display = 'none';
    statsEl.style.display = 'none';
    document.querySelector('#page-home > header').style.display = 'none';
    document.getElementById('playlist-grid-header')?.style.setProperty('display', 'none');

    detailEl.style.display = 'block';
    detailEl.innerHTML = '';

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-ghost';
    backBtn.innerHTML = '← Back to Discover';
    backBtn.style.marginBottom = 'var(--space-4)';
    backBtn.onclick = () => {
      detailEl.style.display = 'none';
      detailEl.innerHTML = '';
      gridEl.style.display = '';
      suggestionContainer.style.display = '';
      statsEl.style.display = '';
      document.querySelector('#page-home > header').style.display = '';
      document.getElementById('playlist-grid-header')?.style.removeProperty('display');
      renderGrid(); // Refresh to update NEW badges
      window.scrollTo(0, 0);
    };
    detailEl.appendChild(backBtn);

    // Load context and render
    if (playlist.context) {
      window.TG.lastContext = playlist.context;
      playlistView.render(playlist.context);
    }
  }

  // === Render discovery stats ===
  function renderStats() {
    const eloRatings = DataStore.getEloRatings();
    const library = DataStore.getPlaylistLibrary();
    const ratedCount = Object.keys(eloRatings).length;
    const playlistCount = library.length;
    const listenedCount = library.filter(p => p.listenedAt).length;

    if (ratedCount === 0 && playlistCount === 0) {
      statsEl.innerHTML = '';
      return;
    }

    statsEl.innerHTML = `
      <div class="glass-card" style="padding: var(--space-4); display: flex; gap: var(--space-6); justify-content: center; flex-wrap: wrap;">
        <div style="text-align: center;">
          <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--text-accent);">${ratedCount}</div>
          <div style="font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em;">Artists Rated</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--accent-green);">${playlistCount}</div>
          <div style="font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em;">Playlists Created</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--accent-violet);">${listenedCount}</div>
          <div style="font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em;">Explored</div>
        </div>
      </div>
    `;
  }

  // === Suggested Artists ===
  async function loadSuggestions() {
    const eloRatings = DataStore.getEloRatings();
    let topArtists = Object.entries(eloRatings)
      .filter(([, d]) => d.name && d.rating > 1400)
      .sort((a, b) => b[1].rating - a[1].rating)
      .slice(0, 8)
      .map(([id, d]) => ({ id, name: d.name, genres: d.genres || [] }));

    // Fallback: use Spotify top artists if Elo data is too thin
    if (topArtists.length < 3) {
      try {
        const cached = DataStore.getTopArtists();
        if (cached && cached.length >= 3) {
          topArtists = cached.slice(0, 8).map(a => ({
            id: a.id, name: a.name, genres: a.genres || [],
          }));
        }
      } catch (e) { /* Spotify data not cached yet */ }
    }

    if (topArtists.length < 3) {
      suggestionContainer.innerHTML = '';
      return;
    }

    // Show loading state
    suggestionContainer.innerHTML = `
      <div class="suggestion-section">
        <div class="suggestion-header" style="display: flex; justify-content: space-between; align-items: center;">
          <h2 class="section-label" style="margin-bottom: 0;">Suggested For You</h2>
          <button id="refresh-suggestions-btn" class="btn btn-ghost btn-sm" style="font-size: var(--font-size-xs);" title="Find new artists based on your taste graph">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
            </svg>
            Refresh
          </button>
        </div>
        <div class="suggestion-scroll">
          ${Array(5).fill(`
            <div class="suggestion-card">
              <div class="suggestion-img-wrap"><div class="suggestion-img suggestion-img-placeholder skeleton-shimmer">&nbsp;</div></div>
              <span class="skeleton-shimmer" style="width: 60px; height: 10px; border-radius: 4px; display: inline-block;"></span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.getElementById('refresh-suggestions-btn').addEventListener('click', () => {
      _triggerRefresh();
    });

    try {
      const agent = new SuggestedArtistsAgent();
      const suggestions = await agent.generate(topArtists, eloRatings);

      renderSuggestionRow(suggestionContainer, suggestions, _handleAction);

      const loadedBtn = document.getElementById('refresh-suggestions-btn-loaded');
      if (loadedBtn) {
        loadedBtn.addEventListener('click', () => _triggerRefresh());
      }
    } catch (e) {
      console.warn('Home: Failed to load suggestions:', e.message);
      suggestionContainer.innerHTML = '';
    }
  }

  // Shared action handler (extracted so dismiss can re-register it)
  function _handleAction(artist, action) {
    switch (action) {
      case 'playlist':
        location.hash = '#/playlist';
        setTimeout(() => {
          const vibeInput = document.getElementById('vibe-input');
          if (vibeInput) vibeInput.value = `Build a playlist around ${artist.name} — ${artist.reason}`;
          document.getElementById('toggle-generator-btn')?.click();
        }, 200);
        break;

      case 'compare':
        if (typeof window !== 'undefined' && artist.spotifyId) {
          window.dispatchEvent(new CustomEvent('tastegraph:inject-artists', {
            detail: [artist.name],
          }));
          location.hash = '#/game';
        }
        break;

      case 'dismiss': {
        const cached = DataStore.getSuggestedArtistsCache() || [];
        const updated = cached.filter(a => a.name !== artist.name);
        DataStore.setSuggestedArtistsCache(updated);
        renderSuggestionRow(suggestionContainer, updated, _handleAction);
        // Re-wire refresh button after re-render
        document.getElementById('refresh-suggestions-btn-loaded')
          ?.addEventListener('click', () => _triggerRefresh());
        break;
      }
    }
  }

  // Stale-while-revalidate refresh:
  // Keep old row visible → spin the button → generate in background → crossfade when ready
  let _refreshInProgress = false;
  function _triggerRefresh() {
    if (_refreshInProgress) return; // debounce
    _refreshInProgress = true;

    // Animate refresh button to show work is happening
    const btn = document.getElementById('refresh-suggestions-btn-loaded')
               || document.getElementById('refresh-suggestions-btn');
    const btnSvg = btn?.querySelector('svg');
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.6';
      if (btnSvg) btnSvg.style.animation = 'spin 0.9s linear infinite';
    }

    // Build seed list — same logic as loadSuggestions (with Spotify fallback)
    const eloRatings = DataStore.getEloRatings();
    let topArtists = Object.entries(eloRatings)
      .filter(([, d]) => d.name && d.rating > 1400)
      .sort((a, b) => b[1].rating - a[1].rating)
      .slice(0, 8)
      .map(([id, d]) => ({ id, name: d.name, genres: d.genres || [] }));

    if (topArtists.length < 3) {
      try {
        const spotifyCached = DataStore.getTopArtists();
        if (spotifyCached && spotifyCached.length >= 3) {
          topArtists = spotifyCached.slice(0, 8).map(a => ({
            id: a.id, name: a.name, genres: a.genres || [],
          }));
        }
      } catch (_) { /* not yet cached */ }
    }

    if (topArtists.length < 3) {
      _refreshInProgress = false;
      if (btn) { btn.disabled = false; btn.style.opacity = ''; if (btnSvg) btnSvg.style.animation = ''; }
      return;
    }

    const agent = new SuggestedArtistsAgent();
    agent.generate(topArtists, eloRatings, { force: true })
      .then(suggestions => {
        // Crossfade: fade out old row, swap, fade in
        const scroll = suggestionContainer.querySelector('.suggestion-scroll');
        if (scroll) {
          scroll.style.transition = 'opacity 200ms ease';
          scroll.style.opacity = '0';
        }
        setTimeout(() => {
          renderSuggestionRow(suggestionContainer, suggestions, _handleAction);
          // Re-wire the loaded refresh button after the DOM is replaced
          document.getElementById('refresh-suggestions-btn-loaded')
            ?.addEventListener('click', () => _triggerRefresh());
          // Re-enable happens here, AFTER the DOM swap (not in finally which races)
          _refreshInProgress = false;
        }, 200);
      })
      .catch(err => {
        console.warn('Refresh failed:', err.message);
        _refreshInProgress = false;
        // Restore button on error
        const errBtn = document.getElementById('refresh-suggestions-btn-loaded')
                      || document.getElementById('refresh-suggestions-btn');
        if (errBtn) {
          errBtn.disabled = false;
          errBtn.style.opacity = '';
          const svg = errBtn.querySelector('svg');
          if (svg) svg.style.animation = '';
        }
      });
  }

  // === Init ===
  renderGrid();
  renderStats();

  // Defer suggestions load — let the grid paint first so the page feels instant
  const _loadSuggestionsDeferred = () => loadSuggestions();
  if ('requestIdleCallback' in window) {
    requestIdleCallback(_loadSuggestionsDeferred, { timeout: 1000 });
  } else {
    setTimeout(_loadSuggestionsDeferred, 300);
  }

  // Listen for library updates (from scheduler)
  const libraryHandler = () => {
    renderGrid();
    renderStats();
  };
  window.addEventListener('tastegraph:library-updated', libraryHandler);

  // New playlist button → navigate to playlist page
  document.getElementById('home-new-playlist-btn')?.addEventListener('click', () => {
    location.hash = '#/playlist';
    setTimeout(() => document.getElementById('toggle-generator-btn')?.click(), 200);
  });
}
