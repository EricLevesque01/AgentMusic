/**
 * Agent Music — Main Entry Point & Router
 * Hash-based SPA router with Spotify OAuth callback handling.
 * Mounts global: ChatPanel
 */
import './style.css';
import { createNavBar, updateNavActive } from './ui/components/nav-bar.js';
import { renderHomePage } from './ui/pages/home.js';
import { renderGamePage } from './ui/pages/game.js';
import { renderPlaylistPage } from './ui/pages/playlist.js';
import { renderProfilePage } from './ui/pages/profile.js';
import { renderLoginScreen } from './ui/components/login-screen.js';
import { ChatPanel } from './ui/components/chat-panel.js';
import { handleCallback, isAuthenticated, clearTokens } from './auth/spotify-auth.js';
import { Orchestrator } from './agents/orchestrator.js';

import { PlaylistScheduler } from './agents/playlist-scheduler.js';
import { DataStore } from './data/data-store.js';

// Route definitions
const routes = {
  '#/':         renderHomePage,
  '#/game':     renderGamePage,
  '#/playlist': renderPlaylistPage,
  '#/profile':  renderProfilePage,
};

// Global singletons (available to all pages via window.TG)
window.TG = {};

let pageContainer = null;
let navElement    = null;

function getCurrentRoute() {
  const hash = window.location.hash || '#/';
  return routes[hash] ? hash : '#/';
}

function navigate() {
  if (!isAuthenticated()) {
    renderLoginScreen(pageContainer);
    document.getElementById('sidebar')?.classList.add('hidden');
    return;
  }
  document.getElementById('sidebar')?.classList.remove('hidden');

  const route = getCurrentRoute();
  document.getElementById('sidebar')?.classList.remove('hidden');

  const renderFn = routes[route];
  if (pageContainer && renderFn) {
    renderFn(pageContainer);
    updateNavActive(route);
  }
}

window.agentmusicLogout = function () {
  clearTokens();
  if (window.TG?.dj) window.TG.dj.reset();
  navigate();
};

async function init() {
  const app = document.getElementById('app');

  // Mount sidebar + bottom nav (createNavBar returns a DocumentFragment)
  const navFrag = createNavBar();
  app.appendChild(navFrag);
  navElement = document.getElementById('sidebar');

  // Create center page container
  pageContainer = document.createElement('main');
  pageContainer.id = 'page-container';
  app.appendChild(pageContainer);

  // Inspector panel removed per user feedback.

  // Handle OAuth callback
  if (window.location.search.includes('code=')) {
    pageContainer.innerHTML = `
      <div class="page" style="display:flex;align-items:center;justify-content:center;min-height:80vh;">
        <div class="glass-card" style="padding:var(--space-8);text-align:center;">
          <div style="font-size:2rem;margin-bottom:var(--space-4);animation:pulse 1s infinite;">🔄</div>
          <p style="color:var(--text-secondary);">Connecting to Spotify...</p>
        </div>
      </div>
    `;
    const authResult = await handleCallback();
    if (authResult !== true && authResult !== 'no_code') {
      if (isAuthenticated()) {
        // They probably just refreshed the ?code= callback page, and are already logged in.
        // Clean up the URL and continue loading the app.
        window.history.replaceState({}, document.title, '/#/');
      } else {
        pageContainer.innerHTML = `
          <div class="page" style="display:flex;align-items:center;justify-content:center;min-height:80vh;">
            <div class="glass-card" style="padding:var(--space-8);text-align:center;">
              <div style="font-size:2rem;margin-bottom:var(--space-4);">❌</div>
              <p style="color:var(--text-secondary);margin-bottom:var(--space-2);">Connection failed or expired. Please try again.</p>
              <p style="color:var(--text-accent);font-family:monospace;font-size:0.8rem;margin-bottom:var(--space-4);background:rgba(0,0,0,0.2);padding:var(--space-2);border-radius:4px;">Error: ${authResult}</p>
              <button class="btn btn-primary" onclick="location.href='/'">Retry Login</button>
            </div>
          </div>
        `;
        return;
      }
    }
  }

  // Mount global Orchestrator + Session DJ (singletons, persisted across navigation)
  if (isAuthenticated()) {
    // Shared Orchestrator instance — passed to ChatPanel and playlist page
    const orchestrator = new Orchestrator();
    window.TG.orchestrator = orchestrator;



    // Mount Concierge Chat Panel
    const chatPanel = new ChatPanel(
      orchestrator,
      () => window.TG.lastContext || null,
    );
    chatPanel.mount(app);
    window.TG.chatPanel = chatPanel;

    // Start background playlist generation
    const scheduler = new PlaylistScheduler(orchestrator);
    scheduler.start();
    window.TG.scheduler = scheduler;

    // --- Background Profiler Warm-up ---
    // On fresh login, top_artists is empty — suggested artists, sonic profile, and
    // the Compare screen all fail silently. Run the Profiler once in the background
    // so Spotify data is cached before the user navigates to any feature.
    const needsWarmup = !DataStore.getTopArtists() || DataStore.getTopArtists().length < 5;
    if (needsWarmup) {
      setTimeout(async () => {
        try {
          const { ProfilerAgent } = await import('./agents/profiler-agent.js');
          const profiler = new ProfilerAgent();
          await profiler.buildTasteState();
          console.info('Agent Music: Background profiler warm-up complete.');
          // Refresh the Home page suggestions now that data is available
          window.dispatchEvent(new CustomEvent('agentmusic:profile-ready'));
        } catch (e) {
          console.warn('Agent Music: Background profiler warm-up failed.', e.message);
        }
      }, 200);
    }
  }

  // One-time migration: prune bloated Spotify caches from pre-stripHeavyMetadata versions.
  // This breaks the QuotaExceeded → purge → re-fetch → re-invalidate vicious cycle.
  const PRUNE_VERSION_KEY = 'tg_cache_pruned_v2';
  if (!localStorage.getItem(PRUNE_VERSION_KEY)) {
    localStorage.removeItem('tg_top_artists');
    localStorage.removeItem('tg_top_tracks');
    localStorage.setItem(PRUNE_VERSION_KEY, '1');
    console.info('DataStore: Pruned legacy bloated Spotify caches (one-time migration).');
  }

  // On boot, if suggested artists cache has fewer than 6 items, clear it
  // so it regenerates with the new higher-quantity parameters
  const cachedArtists = DataStore.getSuggestedArtistsCache();
  if (cachedArtists && cachedArtists.length < 6) {
    DataStore.clearSuggestedArtistsCache();
  }

  // Set up routing
  window.addEventListener('hashchange', () => {
    // Stop any playing audio globally on navigation
    document.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
    try { if (window.pauseTrack) window.pauseTrack(); } catch(e) {}

    // Trigger Reflection Agent if we have session data (async, fire-and-forget)
    _triggerEndSession();

    navigate();
  });

  // Trigger lightweight session save on tab close / page unload
  // (does NOT fire LLM calls — browsers kill them on unload anyway)
  window.addEventListener('beforeunload', () => {
    _triggerEndSessionLightweight();
  });

  // Set up memory extraction event
  window.addEventListener('agentmusic:remember-fact', (e) => {
    const fact = e.detail;
    if (fact) {
      const prefs = DataStore.getExplicitPreferences();
      prefs.agent_memories = prefs.agent_memories || [];
      prefs.agent_memories.push(fact);
      DataStore.setExplicitPreferences(prefs);
    }
  });

  if (!window.location.hash) {
    window.location.hash = '#/';
  } else {
    navigate();
  }
}

/**
 * DJ Intervention modal — shown when 3+ consecutive skips detected.
 */
function showDJModal(adjustments, orchestrator) {
  const existing = document.getElementById('dj-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'dj-modal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: var(--z-modal); padding: var(--space-4);
    animation: fadeIn 200ms ease forwards;
  `;
  modal.innerHTML = `
    <div class="glass-card" style="padding: var(--space-6); max-width: 380px; width: 100%; text-align: center;">
      <div style="font-size: 2.5rem; margin-bottom: var(--space-3);">🎧</div>
      <h3 style="font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); margin-bottom: var(--space-2);">Vibe Check</h3>
      <p style="color: var(--text-secondary); font-size: var(--font-size-sm); margin-bottom: var(--space-5);">
        Looks like this playlist isn't quite right. What would you like to change?
      </p>
      <div style="display: flex; flex-direction: column; gap: var(--space-3);">
        ${[
          ['too_energetic',     '😴 Too energetic'],
          ['wrong_genre',       '🎸 Wrong genre'],
          ['more_like_last',    '❤️ More like the last one'],
          ['something_different','🎲 Something completely different'],
        ].map(([type, label]) => `
          <button class="btn btn-secondary" data-feedback="${type}" style="width:100%; text-align: left; padding: var(--space-3) var(--space-4);">
            ${label}
          </button>
        `).join('')}
      </div>
      <button class="btn btn-ghost mt-4" id="dj-dismiss" style="width: 100%; margin-top: var(--space-3);">Dismiss</button>
    </div>
  `;

  modal.addEventListener('click', async (e) => {
    const feedbackBtn = e.target.closest('[data-feedback]');
    if (feedbackBtn) {
      const type = feedbackBtn.dataset.feedback;
      window.TG.dj?.applyFeedback(type);
      modal.remove();
      const adjustments = window.TG.dj?.adjustments;
      if (adjustments) {
        try {
          const ctx = await orchestrator.rerank(adjustments);
          window.TG.lastContext = ctx;
          window.dispatchEvent(new CustomEvent('agentmusic:playlist-updated'));
        } catch (err) {
          console.warn('DJ re-rank failed:', err.message);
        }
      }
    }
    if (e.target.id === 'dj-dismiss') modal.remove();
    if (e.target === modal) modal.remove(); // click outside
  });

  document.body.appendChild(modal);
}

/**
 * Collect Session DJ data and trigger the Reflection Agent (fire-and-forget).
 * Called on in-app navigation (hashchange). Full reflection includes LLM calls.
 */
function _triggerEndSession() {
  try {
    const dj = window.TG?.dj;
    const orchestrator = window.TG?.orchestrator;
    if (!dj || !orchestrator) return;

    // Only reflect if there's meaningful data
    const hasData = dj.skipHistory.length > 0 || dj.listenHistory.length > 0;
    if (!hasData) return;

    const sessionData = {
      skipHistory: [...dj.skipHistory],
      listenHistory: [...dj.listenHistory],
      adjustments: { ...dj.adjustments },
    };

    // Reset DJ for next session
    dj.reset();

    // Fire-and-forget — don't await, don't block navigation
    orchestrator.endSession(sessionData).catch(e =>
      console.warn('Reflection failed:', e.message)
    );
  } catch (e) {
    // Never block navigation
  }
}

/**
 * Lightweight session end for beforeunload — saves only computational data.
 * Does NOT fire LLM calls (browsers kill them on unload anyway).
 */
function _triggerEndSessionLightweight() {
  try {
    const dj = window.TG?.dj;
    if (!dj) return;

    const hasData = dj.skipHistory.length > 0 || dj.listenHistory.length > 0;
    if (!hasData) return;

    // Persist session signals to DataStore so they survive across page loads
    dj._persistSignals();
    dj.reset();
  } catch (e) {
    // Never block unload
  }
}

init();

