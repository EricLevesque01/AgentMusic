import { TasteGame } from '../components/taste-game.js';

/**
 * TasteGraph — Game Page
 */
export function renderGamePage(container) {
  container.innerHTML = `
    <div class="page" id="page-game">
      <header class="page-header text-center">
        <h1 class="page-title">Compare</h1>
        <p class="page-subtitle">Pick your favorites to calibrate your taste profile</p>
      </header>
      <div id="game-container"></div>
    </div>
  `;

  const gameContainer = document.getElementById('game-container');
  const game = new TasteGame(gameContainer);
  game.init();
}
