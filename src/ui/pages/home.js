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
        <div class="empty-library">
          <div style="font-size: 2.5rem; margin-bottom: var(--space-4); opacity: 0.6;">🎵</div>
          <h3 style="font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); margin-bottom: var(--space-2);">No playlists yet</h3>
          <p style="color: var(--text-muted); margin-bottom: var(--space-5); max-width: 300px;">
            Compare some artists first, then your agents will start curating playlists for you.
          </p>
          <div style="display: flex; gap: var(--space-3);">
            <button class="btn btn-primary" onclick="location.hash='#/game'">Compare Artists</button>
            <button class="btn btn-secondary" onclick="location.hash='#/playlist'">Create Manually</button>
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
    const topArtists = Object.entries(eloRatings)
      .filter(([, d]) => d.name && d.rating > 1400)
      .sort((a, b) => b[1].rating - a[1].rating)
      .slice(0, 8)
      .map(([id, d]) => ({ id, name: d.name, genres: d.genres || [] }));

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
      DataStore.clearSuggestedArtistsCache();
      loadSuggestions();
    });

    try {
      const agent = new SuggestedArtistsAgent();
      const suggestions = await agent.generate(topArtists, eloRatings);

      renderSuggestionRow(suggestionContainer, suggestions, (artist, action) => {
        switch (action) {
          case 'playlist':
            location.hash = '#/playlist';
            // Defer to let navigation happen, then trigger generation
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

          case 'dismiss':
            // Remove from cache
            const cached = DataStore.getSuggestedArtistsCache() || [];
            DataStore.setSuggestedArtistsCache(cached.filter(a => a.name !== artist.name));
            // Re-render
            renderSuggestionRow(
              suggestionContainer,
              cached.filter(a => a.name !== artist.name),
              arguments[1]
            );
            break;
        }
      });

      const loadedBtn = document.getElementById('refresh-suggestions-btn-loaded');
      if (loadedBtn) {
        loadedBtn.addEventListener('click', () => {
          DataStore.clearSuggestedArtistsCache();
          loadSuggestions();
        });
      }
    } catch (e) {
      console.warn('Home: Failed to load suggestions:', e.message);
      suggestionContainer.innerHTML = '';
    }
  }

  // === Init ===
  renderGrid();
  renderStats();
  loadSuggestions();

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
