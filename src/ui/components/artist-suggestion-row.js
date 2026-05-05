/**
 * Agent Music — Artist Suggestion Row Component
 * Horizontal scroll row of circular artist cards with discovery reasons.
 * Each card shows: image, name, and the non-obvious connection reason.
 * Click → action modal: Add to Compare / Build playlist / Dismiss.
 */

/**
 * Render the suggested artists row into a container.
 * @param {HTMLElement} container
 * @param {Array} artists — [{ name, imageUrl, reason, category, spotifyId }]
 * @param {function} onAction — callback(artist, action) where action: 'compare' | 'playlist' | 'dismiss'
 */
export function renderSuggestionRow(container, artists, onAction) {
  if (!artists || artists.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="suggestion-section">
      <div class="suggestion-header" style="display: flex; justify-content: space-between; align-items: center;">
        <h2 class="section-label" style="margin-bottom: 0;">Suggested For You</h2>
        <div style="display: flex; align-items: center; gap: var(--space-3);">
          <button id="refresh-suggestions-btn-loaded" class="btn btn-ghost btn-sm" style="font-size: var(--font-size-xs);" title="Find new artists based on your taste graph">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
            </svg>
            Refresh
          </button>
        </div>
      </div>
      <div class="suggestion-scroll" id="suggestion-scroll">
        ${artists.map((a, i) => `
          <div class="suggestion-card" data-idx="${i}" role="button" tabindex="0">
            <div class="suggestion-img-wrap">
              ${a.imageUrl
                ? `<img class="suggestion-img" src="${a.imageUrl}" alt="${a.name}" loading="lazy" />`
                : `<div class="suggestion-img suggestion-img-placeholder">${a.name.charAt(0).toUpperCase()}</div>`
              }
            </div>
            <span class="suggestion-name">${a.name}</span>
            <span class="suggestion-reason">${a.reason}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Click handler — show action modal
  container.querySelectorAll('.suggestion-card').forEach(card => {
    const handler = () => {
      const idx = parseInt(card.dataset.idx, 10);
      const artist = artists[idx];
      if (artist) showActionModal(artist, onAction);
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

/**
 * Show a modal with actions for a suggested artist.
 */
function showActionModal(artist, onAction) {
  // Remove any existing modal
  document.getElementById('suggestion-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'suggestion-modal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: var(--z-modal); padding: var(--space-4);
    animation: fadeIn 200ms ease forwards;
  `;

  modal.innerHTML = `
    <div class="glass-card" style="padding: var(--space-6); max-width: 380px; width: 100%; text-align: center;">
      ${artist.imageUrl
        ? `<img src="${artist.imageUrl}" alt="${artist.name}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; margin: 0 auto var(--space-4); display: block; border: 2px solid var(--border-glass);" />`
        : `<div style="width: 80px; height: 80px; border-radius: 50%; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; margin: 0 auto var(--space-4); font-size: 2rem; color: var(--text-muted);">${artist.name.charAt(0)}</div>`
      }
      <h3 style="font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); margin-bottom: var(--space-2);">${artist.name}</h3>
      <p style="color: var(--text-secondary); font-size: var(--font-size-sm); margin-bottom: var(--space-5);">${artist.reason}</p>
      <div style="display: flex; flex-direction: column; gap: var(--space-3);">
        <button class="btn btn-primary" data-action="playlist" style="width: 100%;">
          Build a playlist around ${artist.name}
        </button>
        <button class="btn btn-secondary" data-action="compare" style="width: 100%;">
          Compare with other artists
        </button>
        <button class="btn btn-ghost" data-action="dismiss" style="width: 100%;">
          Not interested
        </button>
      </div>
    </div>
  `;

  modal.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      onAction(artist, btn.dataset.action);
      modal.remove();
      return;
    }
    if (e.target === modal) modal.remove();
  });

  document.body.appendChild(modal);
}
