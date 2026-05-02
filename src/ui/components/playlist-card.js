/**
 * TasteGraph — Playlist Card Component
 * Glassmorphic card for the discovery feed grid.
 * Shows title, track count, curator reflection, and a "NEW" badge for unlistened playlists.
 */

// Genre-to-gradient map for visual variety
const GENRE_GRADIENTS = {
  rock:        'linear-gradient(135deg, #dc2626 0%, #7c3aed 100%)',
  jazz:        'linear-gradient(135deg, #d97706 0%, #1d4ed8 100%)',
  electronic:  'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
  hip:         'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  pop:         'linear-gradient(135deg, #ec4899 0%, #f97316 100%)',
  indie:       'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)',
  metal:       'linear-gradient(135deg, #374151 0%, #991b1b 100%)',
  classical:   'linear-gradient(135deg, #6366f1 0%, #a78bfa 100%)',
  folk:        'linear-gradient(135deg, #92400e 0%, #16a34a 100%)',
  soul:        'linear-gradient(135deg, #9333ea 0%, #e11d48 100%)',
  country:     'linear-gradient(135deg, #ca8a04 0%, #ea580c 100%)',
  ambient:     'linear-gradient(135deg, #0f766e 0%, #1e40af 100%)',
  punk:        'linear-gradient(135deg, #dc2626 0%, #000000 100%)',
  default:     'linear-gradient(135deg, #3d8bff 0%, #6366f1 100%)',
};

function pickGradient(intent = '', reflection = '') {
  const text = `${intent} ${reflection}`.toLowerCase();
  for (const [key, grad] of Object.entries(GENRE_GRADIENTS)) {
    if (key !== 'default' && text.includes(key)) return grad;
  }
  // Hash-based fallback for visual variety
  const keys = Object.keys(GENRE_GRADIENTS).filter(k => k !== 'default');
  const hash = text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return GENRE_GRADIENTS[keys[hash % keys.length]] || GENRE_GRADIENTS.default;
}

/**
 * Render a single playlist card.
 * @param {object} playlist — { id, title, trackCount, curatorReflection, intent, listenedAt, source, createdAt, context }
 * @param {function} onClick — callback when card is clicked
 * @returns {HTMLElement}
 */
export function createPlaylistCard(playlist, onClick) {
  const card = document.createElement('div');
  card.className = 'playlist-card glass-card glow';
  card.dataset.playlistId = playlist.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  const gradient = pickGradient(playlist.intent, playlist.curatorReflection);
  const isNew = !playlist.listenedAt;
  const date = new Date(playlist.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  card.innerHTML = `
    <div class="playlist-card-gradient" style="background: ${gradient};"></div>
    <div class="playlist-card-content">
      ${isNew ? '<span class="playlist-card-badge">NEW</span>' : ''}
      <h3 class="playlist-card-title">${playlist.title || 'Curated Mix'}</h3>
      <p class="playlist-card-reflection">${truncate(playlist.curatorReflection || playlist.intent || '', 100)}</p>
      <div class="playlist-card-meta">
        <span>${playlist.trackCount || 0} tracks</span>
        <span>${date}</span>
      </div>
    </div>
  `;

  card.addEventListener('click', () => onClick(playlist));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(playlist); }
  });

  return card;
}

/**
 * Render a generating-in-progress skeleton card.
 * @param {string} intent — the seed being generated
 * @returns {HTMLElement}
 */
export function createSkeletonCard(intent = '') {
  const card = document.createElement('div');
  card.className = 'playlist-card glass-card playlist-card-skeleton';

  card.innerHTML = `
    <div class="playlist-card-gradient" style="background: var(--bg-tertiary); opacity: 0.5;"></div>
    <div class="playlist-card-content">
      <div class="skeleton-shimmer" style="width: 60%; height: 16px; margin-bottom: 8px; border-radius: 4px;"></div>
      <div class="skeleton-shimmer" style="width: 80%; height: 12px; margin-bottom: 6px; border-radius: 4px;"></div>
      <div class="skeleton-shimmer" style="width: 40%; height: 12px; border-radius: 4px;"></div>
      ${intent ? `<p class="playlist-card-meta" style="margin-top: var(--space-3);"><span style="animation: pulse 1.5s ease infinite;">Generating: "${truncate(intent, 40)}"</span></p>` : ''}
    </div>
  `;

  return card;
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
