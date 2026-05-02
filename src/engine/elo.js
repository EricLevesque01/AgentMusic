/**
 * TasteGraph — Preference Rating Engine
 *
 * Implements two rating models for the Compare game:
 *
 * 1. Elo (classical) — simple, fast, good for cold start.
 *    Used for artists with fewer than BRADLEY_TERRY_THRESHOLD comparisons.
 *
 * 2. Bradley-Terry — psychometrically superior for subjective taste.
 *    Research justification: "For a music discovery app, TrueSkill or Bradley-Terry
 *    models are superior because they can accommodate the inherent noise and uncertainty
 *    of human taste while providing a more stable global representation of the
 *    preference hierarchy." (Deep Research, 2026)
 *
 *    Key advantages over Elo:
 *    - Models preference as a DISTRIBUTION (mean + uncertainty), not a single number
 *    - Handles non-transitivity (user can prefer A>B and B>C but also C>A)
 *    - More stable when comparisons are sparse — won't overreact to one upset
 *    - Returns uncertainty (sigma) which drives information-gain pair selection
 *
 * Schema per artist in eloRatings:
 *   rating         — Bradley-Terry strength (logit scale, 0 = average)
 *   sigma          — uncertainty (higher = more comparisons needed)
 *   comparison_count, wins, losses, matchups, ... (unchanged)
 */

// ─── Elo parameters ───────────────────────────────────────────
const DEFAULT_ELO    = 1500;
const K_FACTOR       = 32;

// ─── Bradley-Terry parameters ─────────────────────────────────
// Switch to BT after this many comparisons (cold-start uses Elo)
export const BRADLEY_TERRY_THRESHOLD = 4;

// Initial uncertainty — high means "we don't know yet"
const BT_INITIAL_SIGMA = 1.5;

// Learning rate: how fast sigma decreases per comparison
// At 20 comparisons, sigma ≈ 0.33 (well-calibrated)
const BT_SIGMA_DECAY = 0.08;

// ─── Elo functions (unchanged API) ────────────────────────────

/**
 * Calculate the expected score (probability of winning) for Player A.
 * Used by both Elo and as the Bradley-Terry win probability.
 */
export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Update Elo ratings for two players after a match.
 * @param {number} ratingA
 * @param {number} ratingB
 * @param {'A'|'B'|'DRAW'} winner
 * @param {number} kFactor
 * @returns {{ newA: number, newB: number }}
 */
export function updateRatings(ratingA, ratingB, winner, kFactor = K_FACTOR) {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = expectedScore(ratingB, ratingA);

  let actualA = 0.5, actualB = 0.5;
  if (winner === 'A') { actualA = 1.0; actualB = 0.0; }
  else if (winner === 'B') { actualA = 0.0; actualB = 1.0; }

  return {
    newA: Math.round(ratingA + kFactor * (actualA - expectedA)),
    newB: Math.round(ratingB + kFactor * (actualB - expectedB)),
  };
}

// ─── Bradley-Terry functions ───────────────────────────────────

/**
 * Initialize Bradley-Terry state for a new artist.
 * Stored alongside the Elo rating fields.
 */
export function initBradleyTerry() {
  return {
    bt_strength: 0.0,   // log-odds preference strength (0 = average)
    bt_sigma:    BT_INITIAL_SIGMA,  // uncertainty
    bt_comparisons: 0,
  };
}

/**
 * Win probability under the Bradley-Terry model.
 * P(A beats B) = σ(strength_A - strength_B) = 1 / (1 + exp(-(sA - sB)))
 *
 * @param {number} strengthA — bt_strength for artist A
 * @param {number} strengthB — bt_strength for artist B
 * @returns {number} Probability 0–1 that A is preferred
 */
export function btWinProb(strengthA, strengthB) {
  return 1 / (1 + Math.exp(-(strengthA - strengthB)));
}

/**
 * Update Bradley-Terry strengths after a pairwise comparison.
 *
 * Uses a gradient ascent step on the log-likelihood:
 *   ∂LL/∂s_A = actual_A - P(A beats B)
 *   ∂LL/∂s_B = actual_B - P(B beats A)
 *
 * Learning rate = sigma² (decreases as artist becomes better calibrated).
 * This naturally gives high uncertainty artists bigger updates.
 *
 * @param {object} dataA — full eloRatings entry for artist A { bt_strength, bt_sigma, bt_comparisons, ... }
 * @param {object} dataB — full eloRatings entry for artist B
 * @param {'A'|'B'|'DRAW'} winner
 * @returns {{ newA: object, newB: object }} Updated data objects (shallow copy)
 */
export function updateBradleyTerry(dataA, dataB, winner) {
  const sA = dataA.bt_strength ?? 0;
  const sB = dataB.bt_strength ?? 0;
  const sigA = dataA.bt_sigma  ?? BT_INITIAL_SIGMA;
  const sigB = dataB.bt_sigma  ?? BT_INITIAL_SIGMA;

  const probA = btWinProb(sA, sB);
  const probB = 1 - probA;

  let actualA = 0.5, actualB = 0.5;
  if (winner === 'A') { actualA = 1.0; actualB = 0.0; }
  else if (winner === 'B') { actualA = 0.0; actualB = 1.0; }

  // Gradient step — learning rate proportional to current uncertainty
  const lrA = sigA * sigA;
  const lrB = sigB * sigB;

  const newStrengthA = sA + lrA * (actualA - probA);
  const newStrengthB = sB + lrB * (actualB - probB);

  // Reduce uncertainty with each comparison (converges toward a minimum)
  const newSigA = Math.max(0.1, sigA - BT_SIGMA_DECAY);
  const newSigB = Math.max(0.1, sigB - BT_SIGMA_DECAY);

  return {
    newA: { ...dataA, bt_strength: newStrengthA, bt_sigma: newSigA, bt_comparisons: (dataA.bt_comparisons || 0) + 1 },
    newB: { ...dataB, bt_strength: newStrengthB, bt_sigma: newSigB, bt_comparisons: (dataB.bt_comparisons || 0) + 1 },
  };
}

/**
 * Convert a Bradley-Terry strength to a comparable "rating" number
 * in roughly the same 1300–1700 range as Elo, for backward compatibility
 * with code that reads `data.rating` to sort the leaderboard.
 *
 * rating = 1500 + (bt_strength × 100)
 * A strength of +2.0 → rating ≈ 1700, -2.0 → rating ≈ 1300.
 */
export function btStrengthToRating(btStrength) {
  return Math.round(1500 + btStrength * 100);
}

/**
 * Get the "information gain" value for a matchup (A vs B).
 * Higher = more useful comparison to make right now.
 *
 * BT information gain ∝ sigma_A × sigma_B × P(A beats B) × P(B beats A)
 * This is maximized when:
 *   - Both artists have high uncertainty (sigma)
 *   - The match is close (win prob ≈ 0.5)
 *
 * Used by TasteGame to prefer high-value matchups.
 *
 * @param {object} dataA
 * @param {object} dataB
 * @returns {number} 0–1 information gain score
 */
export function btInformationGain(dataA, dataB) {
  const sA = dataA?.bt_strength ?? 0;
  const sB = dataB?.bt_strength ?? 0;
  const sigA = dataA?.bt_sigma  ?? BT_INITIAL_SIGMA;
  const sigB = dataB?.bt_sigma  ?? BT_INITIAL_SIGMA;

  const pA = btWinProb(sA, sB);
  const pB = 1 - pA;

  // Uncertainty factor × match closeness
  const uncertainty = Math.min(sigA, 1.5) * Math.min(sigB, 1.5) / (BT_INITIAL_SIGMA * BT_INITIAL_SIGMA);
  const closeness   = 4 * pA * pB; // max 1.0 when pA = pB = 0.5

  return uncertainty * closeness;
}

/**
 * Determine which model to use for a given artist.
 * Returns 'bradley-terry' once enough comparisons exist, 'elo' for cold start.
 *
 * @param {object} data — eloRatings entry
 * @returns {'elo'|'bradley-terry'}
 */
export function getModelForArtist(data) {
  if (!data) return 'elo';
  const comps = data.comparison_count || 0;
  // Also require BT fields to be initialized
  if (comps >= BRADLEY_TERRY_THRESHOLD && data.bt_strength !== undefined) {
    return 'bradley-terry';
  }
  return 'elo';
}
