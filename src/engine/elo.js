/**
 * TasteGraph — Elo Rating Engine
 * Pure math functions for calculating Elo rating updates.
 */

/**
 * Calculate the expected score (probability of winning) for Player A.
 * @param {number} ratingA - Current Elo rating of Player A
 * @param {number} ratingB - Current Elo rating of Player B
 * @returns {number} Probability between 0.0 and 1.0
 */
export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Update the Elo ratings for two players after a match.
 * @param {number} ratingA - Current Elo rating of Player A
 * @param {number} ratingB - Current Elo rating of Player B
 * @param {string} winner - 'A', 'B', or 'DRAW'
 * @param {number} kFactor - Maximum rating change per match
 * @returns {{ newA: number, newB: number }} The updated ratings
 */
export function updateRatings(ratingA, ratingB, winner, kFactor = 32) {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = expectedScore(ratingB, ratingA);

  let actualA = 0.5;
  let actualB = 0.5;

  if (winner === 'A') {
    actualA = 1.0;
    actualB = 0.0;
  } else if (winner === 'B') {
    actualA = 0.0;
    actualB = 1.0;
  }

  const newA = Math.round(ratingA + kFactor * (actualA - expectedA));
  const newB = Math.round(ratingB + kFactor * (actualB - expectedB));

  return { newA, newB };
}
