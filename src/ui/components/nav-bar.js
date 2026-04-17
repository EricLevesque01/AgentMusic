/**
 * TasteGraph — Navigation Bar Component
 * Bottom navigation with 4 tabs: Home, Game, Playlist, Profile
 */

const NAV_ITEMS = [
  { id: 'home',     icon: '🏠', label: 'Home',     hash: '#/' },
  { id: 'game',     icon: '⚔️', label: 'Compare',    hash: '#/game' },
  { id: 'playlist', icon: '🎵', label: 'Playlist', hash: '#/playlist' },
  { id: 'profile',  icon: '👤', label: 'Profile',  hash: '#/profile' },
];

export function createNavBar() {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.id = 'main-nav';
  nav.setAttribute('aria-label', 'Main navigation');

  nav.innerHTML = NAV_ITEMS.map(item => `
    <button class="nav-item" data-route="${item.hash}" id="nav-${item.id}" aria-label="${item.label}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    </button>
  `).join('');

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    const route = btn.dataset.route;
    if (route) {
      window.location.hash = route;
    }
  });

  return nav;
}

export function updateNavActive(hash) {
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  nav.querySelectorAll('.nav-item').forEach(item => {
    const isActive = item.dataset.route === hash || 
                     (hash === '' && item.dataset.route === '#/');
    item.classList.toggle('active', isActive);
  });
}
