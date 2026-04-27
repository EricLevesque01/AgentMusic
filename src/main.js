/**
 * TasteGraph — Main Entry Point & Router
 * Hash-based SPA router with Spotify OAuth callback handling.
 * Mounts global: ChatPanel (Concierge) + SessionDJAgent
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
import { SessionDJAgent } from './agents/session-dj-agent.js';
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
    document.getElementById('inspector-panel')?.classList.add('hidden');
    return;
  }
  document.getElementById('sidebar')?.classList.remove('hidden');
  document.getElementById('inspector-panel')?.classList.remove('hidden');

  const route = getCurrentRoute();
  const renderFn = routes[route];
  if (pageContainer && renderFn) {
    renderFn(pageContainer);
    updateNavActive(route);
  }
}

window.tastegraphLogout = function () {
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

  // Create right inspector panel shell
  const inspector = document.createElement('aside');
  inspector.id = 'inspector-panel';
  inspector.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-title">Node Inspector</span>
      <button class="btn btn-ghost btn-icon" id="inspector-close" aria-label="Close inspector">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M1 1l10 10M11 1L1 11"/>
        </svg>
      </button>
    </div>
    <div id="inspector-content" style="flex:1;overflow-y:auto;">
      <div class="inspector-section" style="color:var(--text-muted);font-size:var(--font-size-xs);text-align:center;padding-top:var(--space-8);">
        Select a track to inspect
      </div>
    </div>
  `;
  app.appendChild(inspector);

  inspector.querySelector('#inspector-close')?.addEventListener('click', () => {
    document.body.classList.remove('inspector-open');
  });

  // Handle OAuth callback
  if (window.location.search.includes('code=')) {
    pageContainer.innerHTML = `
      <div class="page" style="display:flex;align-items:center;justify-content:center;min-height:80vh;">
        <div class="glass-card" style="padding:var(--space-8);text-align:center;">
          <div style="font-size:2rem;margin-bottom:var(--space-4);">🔄</div>
          <p style="color:var(--text-secondary);">Connecting to Spotify...</p>
        </div>
      </div>
    `;
    const success = await handleCallback();
    if (!success) {
      pageContainer.innerHTML = `
        <div class="page" style="display:flex;align-items:center;justify-content:center;min-height:80vh;">
          <div class="glass-card" style="padding:var(--space-8);text-align:center;">
            <div style="font-size:2rem;margin-bottom:var(--space-4);">❌</div>
            <p style="color:var(--text-secondary);margin-bottom:var(--space-4);">Connection failed. Please try again.</p>
            <button class="btn btn-primary" onclick="location.href='/'">Retry</button>
          </div>
        </div>
      `;
      return;
    }
  }

  // Mount global Orchestrator + Session DJ (singletons, persisted across navigation)
  if (isAuthenticated()) {
    // Shared Orchestrator instance — passed to ChatPanel and playlist page
    const orchestrator = new Orchestrator();
    window.TG.orchestrator = orchestrator;

    // Session DJ Agent
    const dj = new SessionDJAgent(async (adjustments, lastCandidate) => {
      // DJ intervention: show modal and trigger partial re-rank
      showDJModal(adjustments, orchestrator);
    });
    window.TG.dj = dj;

    // Mount Concierge Chat Panel
    const chatPanel = new ChatPanel(
      orchestrator,
      () => window.TG.lastContext || null,
    );
    chatPanel.mount(app);
    window.TG.chatPanel = chatPanel;
  }

  // Set up routing
  window.addEventListener('hashchange', () => {
    // Stop any playing audio globally on navigation
    document.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
    try { if (window.pauseTrack) window.pauseTrack(); } catch(e) {}
    navigate();
  });

  // Set up memory extraction event
  window.addEventListener('tastegraph:remember-fact', (e) => {
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
      try {
        const ctx = await orchestrator.rerank(window.TG.dj.adjustments);
        window.TG.lastContext = ctx;
        window.dispatchEvent(new CustomEvent('tastegraph:playlist-updated'));
      } catch (err) {
        console.warn('DJ re-rank failed:', err.message);
      }
    }
    if (e.target.id === 'dj-dismiss') modal.remove();
    if (e.target === modal) modal.remove(); // click outside
  });

  document.body.appendChild(modal);
}

init();
