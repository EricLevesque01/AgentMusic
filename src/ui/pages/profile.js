/**
 * TasteGraph — Profile Page (placeholder, built out in Phase 8)
 */
import { ProfileView } from '../components/profile-view.js';

export function renderProfilePage(container) {
  container.innerHTML = `
    <div class="page" id="page-profile">
      <header class="page-header">
        <h1 class="page-title">Profile</h1>

      </header>
      <div id="profile-content"></div>
    </div>
  `;

  const view = new ProfileView(document.getElementById('profile-content'));
  view.render();
}
