/**
 * Agent Music — Vertical Sidebar Navigation
 * "Deep Space Pro" — replaces bottom nav with a fixed left sidebar.
 * Renders both a desktop sidebar AND a mobile bottom nav from the same data.
 */
import { DataStore } from '../../data/data-store.js';

const NAV_ITEMS = [
  {
    id: 'home', label: 'Discover', hash: '#/',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 6.5L8 1l7 5.5V14a1 1 0 01-1 1H2a1 1 0 01-1-1V6.5z"/>
    </svg>`,
  },
  {
    id: 'game', label: 'Compare', hash: '#/game',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="4" cy="8" r="3"/><circle cx="12" cy="8" r="3"/>
      <path d="M7 8h2"/>
    </svg>`,
  },
  {
    id: 'playlist', label: 'Playlists', hash: '#/playlist',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 4h12M2 8h8M2 12h5"/>
      <circle cx="13" cy="11" r="2"/>
      <path d="M13 9V5l2 1"/>
    </svg>`,
  },
  {
    id: 'profile', label: 'Sonic Profile', hash: '#/profile',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="5" r="3"/>
      <path d="M1 14c0-3.314 3.134-6 7-6s7 2.686 7 6"/>
    </svg>`,
  },
];

// ── Sidebar (desktop) ───────────────────────────────────────────

export function createNavBar() {
  // Desktop sidebar
  const sidebar = document.createElement('aside');
  sidebar.id = 'sidebar';
  sidebar.setAttribute('aria-label', 'Main navigation');

  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-text">Agent Music</div>
    </div>

    <div class="sidebar-section-label">Navigation</div>

    <nav id="sidebar-nav">
      ${NAV_ITEMS.map(item => `
        <button class="nav-item" data-route="${item.hash}" id="nav-${item.id}" aria-label="${item.label}">
          <span class="nav-icon-svg">${item.icon}</span>
          <span>${item.label}</span>
          ${item.id === 'home' ? '<span id="nav-discover-badge" class="nav-badge" style="display:none"></span>' : ''}
        </button>
      `).join('')}
    </nav>

    <div class="sidebar-footer" style="display:flex; flex-direction: column; gap: var(--space-2);">
      <button class="nav-item" onclick="window.agentmusicLogout && window.agentmusicLogout()" aria-label="Sign out" style="padding: var(--space-2) var(--space-3); color: var(--text-muted); font-size: var(--font-size-xs);">
        <span class="nav-icon-svg" style="width: 14px; height: 14px; margin-right: 8px;">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6"/>
          </svg>
        </span>
        <span>Sign Out</span>
      </button>
      <div style="font-size: var(--font-size-2xs); color: var(--text-muted); display: flex; align-items: center; padding: 0 var(--space-3);">
        <span class="sidebar-status-dot"></span>
        Pipeline Ready
      </div>
    </div>
  `;

  sidebar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-route]');
    if (!btn) return;
    window.location.hash = btn.dataset.route;
  });

  // Mobile bottom nav (separate DOM element, same data)
  const bottomNav = document.createElement('nav');
  bottomNav.className = 'bottom-nav';
  bottomNav.id = 'main-nav';
  bottomNav.setAttribute('aria-label', 'Main navigation');

  bottomNav.innerHTML = NAV_ITEMS.map(item => `
    <button class="nav-item" data-route="${item.hash}" id="mobile-nav-${item.id}" aria-label="${item.label}">
      <span class="nav-icon-svg">${item.icon}</span>
      <span>${item.label}</span>
      ${item.id === 'home' ? '<span id="mobile-nav-discover-badge" class="nav-badge" style="display:none"></span>' : ''}
    </button>
  `).join('');

  bottomNav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-route]');
    if (!btn) return;
    window.location.hash = btn.dataset.route;
  });

  // Return a fragment containing both
  const frag = document.createDocumentFragment();
  frag.appendChild(sidebar);
  frag.appendChild(bottomNav);

  // Initial badge update (after the DOM fragment is added)
  requestAnimationFrame(() => _updateDiscoverBadge());

  // Keep badge live as the scheduler generates playlists
  window.addEventListener('agentmusic:library-updated', _updateDiscoverBadge);

  return frag;
}

/**
 * Update the unlistened-playlist count badge on the Discover nav item.
 * Shows the number of new, unlistened playlists. Hides when zero.
 */
function _updateDiscoverBadge() {
  try {
    const count = DataStore.getUnlistenedCount();
    const text  = count > 0 ? String(count) : '';
    const show  = count > 0;

    for (const id of ['nav-discover-badge', 'mobile-nav-discover-badge']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.textContent  = text;
      el.style.display = show ? 'inline-flex' : 'none';
    }
  } catch (e) {
    // DataStore not available (tests, server-side) — ignore
  }
}

export function updateNavActive(hash) {
  // Desktop sidebar
  document.querySelectorAll('#sidebar-nav .nav-item').forEach(item => {
    const isActive = item.dataset.route === hash ||
                     (hash === '#/' && item.dataset.route === '#/');
    item.classList.toggle('active', isActive);
  });

  // Mobile bottom nav
  document.querySelectorAll('#main-nav .nav-item').forEach(item => {
    const isActive = item.dataset.route === hash ||
                     (hash === '#/' && item.dataset.route === '#/');
    item.classList.toggle('active', isActive);
  });
}
