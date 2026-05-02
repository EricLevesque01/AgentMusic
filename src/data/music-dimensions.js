/**
 * TasteGraph — Music Dimensions
 *
 * Implements the MUSIC model (Rentfrow, Goldberg & Levitin, 2011) for
 * computing psychometric taste profiles from genre metadata.
 *
 * MUSIC = Mellow, Unpretentious, Sophisticated, Intense, Contemporary
 *
 * Psychometric basis:
 *   The five factors were identified through three independent studies (n > 3,500)
 *   and validated against both genre ratings (STOMP-R scale) and audio excerpts.
 *   They are more stable than specific genre preferences, which fluctuate with
 *   cultural trends. (Rentfrow, Goldberg & Levitin, 2011)
 *
 * STOMP-R Genre-to-MUSIC Dimension Mapping:
 *   Based on Study 3 factor loadings from Rentfrow et al. (2011).
 *   Each macro-genre maps to the 1-2 dimensions it loads most heavily on.
 *
 * Personality correlates (for context):
 *   Sophisticated ↔ Openness to Experience
 *   Contemporary  ↔ Extraversion
 *   Intense       ↔ low Agreeableness
 *   Mellow        ↔ Agreeableness
 *   Unpretentious ↔ Conscientiousness
 *
 * Source-agnostic: works with any genre data (Spotify, Last.fm, MusicBrainz).
 */

import { MACRO_GENRES } from './genre-taxonomy.js';

/**
 * Genre-to-MUSIC dimension mapping.
 * Loadings derived from STOMP-R (Study 3, Rentfrow et al. 2011):
 *
 * Mellow:          Electronica/Dance, New Age, World — "relaxing, romantic, slow"
 * Unpretentious:   Pop, Country, Religious — "sincere, acoustic, uncomplicated"
 * Sophisticated:   Blues, Jazz, Classical, Folk, Opera, Bluegrass — "intelligent, complex, inspiring"
 * Intense:         Rock, Punk, Alternative, Heavy Metal — "loud, distorted, aggressive"
 * Contemporary:    Rap, Soul/R&B, Funk, Reggae — "percussive, electric, rhythmic"
 *
 * Notes on mapping decisions:
 * - Electronic/Dance: STOMP-R loads it on Mellow (not Contemporary) — ambient/chill dominates
 *   the statistical signal. Sub-genre EDM loads on Contemporary; we split the difference.
 * - Alternative/Indie: Intense (punk lineage) + Sophisticated (art rock, post-rock)
 * - Jazz/Blues: Sophisticated primary, small Mellow secondary (cool jazz, late-night feel)
 * - Classical: Sophisticated primary, Mellow secondary (orchestral dynamics)
 * - R&B/Soul: Contemporary primary, Mellow secondary (smooth R&B)
 */
export const GENRE_TO_MUSIC = {
  // Contemporary (Rap/Soul/R&B/Funk/Reggae per STOMP-R)
  'Hip-Hop / Rap':       { mellow: 0.00, unpretentious: 0.00, sophisticated: 0.00, intense: 0.10, contemporary: 0.90 },
  'R&B / Soul':          { mellow: 0.20, unpretentious: 0.10, sophisticated: 0.00, intense: 0.00, contemporary: 0.70 },

  // Intense (Rock/Punk/Alternative/Metal per STOMP-R)
  'Rock':                { mellow: 0.00, unpretentious: 0.10, sophisticated: 0.10, intense: 0.80, contemporary: 0.00 },
  'Metal':               { mellow: 0.00, unpretentious: 0.00, sophisticated: 0.05, intense: 0.95, contemporary: 0.00 },
  'Alternative / Indie': { mellow: 0.00, unpretentious: 0.00, sophisticated: 0.40, intense: 0.60, contemporary: 0.00 },

  // Sophisticated (Blues/Jazz/Classical/Folk/Opera/Bluegrass per STOMP-R)
  'Jazz / Blues':        { mellow: 0.15, unpretentious: 0.00, sophisticated: 0.85, intense: 0.00, contemporary: 0.00 },
  'Classical / Score':   { mellow: 0.25, unpretentious: 0.00, sophisticated: 0.75, intense: 0.00, contemporary: 0.00 },
  'Country / Folk':      { mellow: 0.10, unpretentious: 0.55, sophisticated: 0.35, intense: 0.00, contemporary: 0.00 },

  // Mellow (Electronica/Dance, New Age, World per STOMP-R)
  // Split: ambient/IDM → Mellow; club EDM → Contemporary
  'Electronic / Dance':  { mellow: 0.40, unpretentious: 0.00, sophisticated: 0.10, intense: 0.15, contemporary: 0.35 },

  // Unpretentious (Pop, Country per STOMP-R)
  'Pop':                 { mellow: 0.10, unpretentious: 0.30, sophisticated: 0.00, intense: 0.05, contemporary: 0.55 },
};

/**
 * Compute the five MUSIC dimensions from a genre distribution.
 *
 * @param {Object} genreDistribution — e.g. { "Jazz / Blues": 0.45, "Rock": 0.30, ... }
 *   Values should be proportional weights (summing to ~1.0).
 * @returns {{ mellow, unpretentious, sophisticated, intense, contemporary, _confidence? }}
 *   Each dimension is 0.0–1.0.
 */
export function computeMusicDimensions(genreDistribution) {
  const dims = { mellow: 0, unpretentious: 0, sophisticated: 0, intense: 0, contemporary: 0 };

  if (!genreDistribution || Object.keys(genreDistribution).length === 0) {
    return dims;
  }

  for (const [genre, weight] of Object.entries(genreDistribution)) {
    if (genre.startsWith('_')) continue;
    const mapping = GENRE_TO_MUSIC[genre];
    if (!mapping) continue;

    for (const [dim, factor] of Object.entries(mapping)) {
      dims[dim] += weight * factor;
    }
  }

  // Clamp to 0–1
  for (const dim of Object.keys(dims)) {
    dims[dim] = Math.min(1, Math.max(0, dims[dim]));
  }

  return dims;
}

/**
 * Compute a proportional genre distribution from an array of artists with genres.
 * Each artist contributes equally, optionally weighted by Elo/BT rating.
 *
 * @param {Array}  artists      — [{ genres: ['indie rock', 'shoegaze'], ... }]
 * @param {Object} eloRatings   — optional, keyed by artist id
 * @returns {Object} e.g. { "Rock": 0.45, "Alternative / Indie": 0.30, ... }
 */
export function computeGenreDistribution(artists, eloRatings = null) {
  const counts = {};
  let total = 0;

  for (const artist of artists) {
    const macros = new Set();
    const rawGenres = artist.macroGenres?.length ? artist.macroGenres : (artist.genres || []);

    for (const micro of rawGenres) {
      const clean = micro.toLowerCase().trim();
      for (const [macro, keywords] of Object.entries(MACRO_GENRES)) {
        if (keywords.includes(clean) || keywords.some(kw => clean.includes(kw))) {
          macros.add(macro);
        }
      }
    }

    // Weight by rating if available, otherwise equal weight
    const weight = eloRatings?.[artist.id]
      ? Math.max(1, (eloRatings[artist.id].rating || 1500) - 1300) / 200
      : 1;

    for (const macro of macros) {
      counts[macro] = (counts[macro] || 0) + weight;
      total += weight;
    }
  }

  const distribution = {};
  if (total > 0) {
    for (const [genre, count] of Object.entries(counts)) {
      distribution[genre] = Math.round((count / total) * 100) / 100;
    }
  }

  return distribution;
}

/**
 * Compute a DECAY-WEIGHTED genre distribution.
 *
 * Applies the exponential time-decay function from the research:
 *   w(t) = e^(-λ × (t_now - t_play) / T)
 *
 * Where:
 *   λ = 0.7 (decay rate — tuned so 1yr-old plays = ~50% weight of today's)
 *   T = 1 year in milliseconds (music taste is stable over months, not days)
 *
 * This is applied to behavioral events (Elo wins, listens, saves) before
 * computing genre weights, so recent genre interactions dominate the profile.
 *
 * Research basis: "Applying this decay to weighted plays before they are
 * converted into implicit ratings allows the model to respond to preference
 * evolution in a continuous way without the need for rigid time windows."
 *
 * @param {Array}  behavioralEvents — [{ ts: timestamp, artistId, genres, type }]
 * @param {number} lambda           — decay rate (default 0.7)
 * @returns {Object} time-decayed genre distribution
 */
export function computeDecayWeightedGenres(behavioralEvents, lambda = 0.7) {
  const T_YEAR_MS   = 365.25 * 24 * 60 * 60 * 1000;
  const now         = Date.now();
  const genreScores = {};

  // Event type weights (reflect research: skip is strong negative signal)
  const EVENT_WEIGHTS = {
    eloWin:       2.0,  // explicit preference signal
    fullListen:   1.5,  // high engagement
    save:         2.0,  // intentional save
    partialListen:0.8,  // moderate engagement
    eloLoss:     -1.0,  // explicit rejection
    skip:        -0.5,  // mild negative
    rapidSkip:   -1.5,  // strong negative (< 5 seconds)
    dampen:      -1.0,  // user feedback
    boost:        1.5,  // user feedback
  };

  for (const event of behavioralEvents) {
    const ageMs       = now - (event.ts || now);
    const decayWeight = Math.exp(-lambda * ageMs / T_YEAR_MS);
    const typeWeight  = EVENT_WEIGHTS[event.type] || 1.0;
    const finalWeight = decayWeight * typeWeight;

    if (finalWeight === 0) continue;

    const genres = event.genres || event.macroGenres || [];
    for (const genre of genres) {
      genreScores[genre] = (genreScores[genre] || 0) + finalWeight;
    }
  }

  // Normalize positive scores to proportions
  const positiveGenres = Object.entries(genreScores).filter(([, v]) => v > 0);
  const total = positiveGenres.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return {};

  const distribution = {};
  for (const [genre, score] of positiveGenres) {
    distribution[genre] = Math.round((score / total) * 100) / 100;
  }
  return distribution;
}

/**
 * Detect taste drift signals from behavioral evidence.
 *
 * Three signals from the research:
 * 1. Resilience Loss: sudden skip surge for a previously-loved genre
 * 2. Exploration Burst: spike in interactions outside the core cluster
 * 3. Contextual Mismatch: temporal listening patterns shifting genre
 *
 * @param {Object} evidence — UserModel behavioral evidence object
 * @param {Object} tier1    — UserModel Tier 1 (stable profile)
 * @returns {{ driftDetected: boolean, signals: string[], momentum: Object, decline: Object }}
 */
export function detectTasteDrift(evidence, tier1) {
  const signals  = [];
  const momentum = {}; // genres gaining weight
  const decline  = {}; // genres losing weight

  // Need at least some history to detect drift
  const allEvents = [
    ...(evidence.eloWins   || []).map(e => ({ ...e, type: 'eloWin' })),
    ...(evidence.eloLosses || []).map(e => ({ ...e, type: 'eloLoss' })),
    ...(evidence.skips     || []).map(e => ({ ...e, type: 'skip' })),
    ...(evidence.fullListens || []).map(e => ({ ...e, type: 'fullListen' })),
  ].sort((a, b) => (a.ts || 0) - (b.ts || 0));

  if (allEvents.length < 20) return { driftDetected: false, signals, momentum, decline };

  const T_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
  const now       = Date.now();

  // Split into "recent" (last 30 days) vs "older" (30-365 days)
  const T_RECENT = 30 * 24 * 60 * 60 * 1000;
  const recent = allEvents.filter(e => (now - (e.ts || 0)) < T_RECENT);
  const older  = allEvents.filter(e => {
    const age = now - (e.ts || 0);
    return age >= T_RECENT && age < T_YEAR_MS;
  });

  if (recent.length < 5 || older.length < 5) return { driftDetected: false, signals, momentum, decline };

  // Compute genre distributions for each window
  const recentDist = computeDecayWeightedGenres(recent, 0.3);  // low decay in recent = equal weight
  const olderDist  = computeDecayWeightedGenres(older,  0.3);

  // Find genres that changed significantly (> 15% shift)
  const allGenres = new Set([...Object.keys(recentDist), ...Object.keys(olderDist)]);
  let maxShift = 0;

  for (const genre of allGenres) {
    const r = recentDist[genre] || 0;
    const o = olderDist[genre]  || 0;
    const shift = r - o;
    maxShift = Math.max(maxShift, Math.abs(shift));

    if (shift > 0.15) {
      momentum[genre] = shift;
    } else if (shift < -0.15) {
      decline[genre] = Math.abs(shift);
    }
  }

  // Signal 1: Resilience Loss — high skip rate for previously-loved genres
  const coreGenres = Object.keys(tier1?.tasteProfile?.genreDistribution || {})
    .filter(g => !g.startsWith('_'))
    .slice(0, 3);

  const recentSkips = recent.filter(e => e.type === 'skip');
  for (const genre of coreGenres) {
    const genreSkips = recentSkips.filter(e => (e.genres || []).includes(genre)).length;
    const skipRate   = recent.length > 0 ? genreSkips / recent.length : 0;
    if (skipRate > 0.3) {
      signals.push(`Resilience loss: high skip rate (${(skipRate * 100).toFixed(0)}%) in previously-core "${genre}"`);
    }
  }

  // Signal 2: Exploration Burst — momentum in genres outside the core cluster
  for (const [genre, shift] of Object.entries(momentum)) {
    if (!coreGenres.includes(genre)) {
      signals.push(`Exploration burst: "${genre}" up ${(shift * 100).toFixed(0)}% in recent sessions (non-core genre gaining)`);
    }
  }

  // Signal 3: any large genre shift
  if (maxShift > 0.20) {
    const shifting = Object.keys(momentum).concat(Object.keys(decline)).join(', ');
    signals.push(`Significant taste drift detected (max shift: ${(maxShift * 100).toFixed(0)}%) across: ${shifting}`);
  }

  return {
    driftDetected: signals.length > 0,
    signals,
    momentum,   // genres gaining (opportunity for "bridge" playlists)
    decline,    // genres fading (reduce recommendations from these)
  };
}

/**
 * Compute mainstreaminess from Spotify artist popularity scores.
 * @param {Array} artists — [{ popularity: 0-100 }]
 * @returns {number} 0.0 (niche) to 1.0 (mainstream)
 */
export function computeMainstreaminess(artists) {
  if (!artists || artists.length === 0) return 0.5;
  const avgPop = artists.reduce((sum, a) => sum + (a.popularity || 50), 0) / artists.length;
  return Math.round((avgPop / 100) * 100) / 100;
}

/**
 * Compute specialist index — measures depth vs. breadth.
 * A specialist deeply rates a few genres; a generalist shallowly rates many.
 *
 * @param {Object} eloRatings — { artistId: { genres: [], comparison_count } }
 * @returns {number} 0.0 (generalist/broad) to 1.0 (specialist/deep)
 */
export function computeSpecialistIndex(eloRatings) {
  if (!eloRatings || Object.keys(eloRatings).length === 0) return 0.5;

  const genreDepth = {};
  for (const data of Object.values(eloRatings)) {
    const genres = data.genres || [];
    const comps  = data.comparison_count || 0;
    for (const g of genres) {
      genreDepth[g] = (genreDepth[g] || 0) + comps;
    }
  }

  const genres = Object.keys(genreDepth);
  if (genres.length === 0) return 0.5;

  const totalComps      = Object.values(genreDepth).reduce((a, b) => a + b, 0);
  const maxGenreComps   = Math.max(...Object.values(genreDepth));
  const concentration   = totalComps > 0 ? maxGenreComps / totalComps : 0;
  const breadthPenalty  = Math.min(1, genres.length / 10);
  const specialist      = concentration * (1 - breadthPenalty * 0.5);

  return Math.round(Math.min(1, Math.max(0, specialist)) * 100) / 100;
}

/**
 * Compute genre diversity score using Shannon entropy (normalized 0–1).
 *
 * @param {Object} genreDistribution — { "Jazz": 0.45, "Rock": 0.30, ... }
 * @returns {number} 0.0 (single genre) to 1.0 (perfectly uniform)
 */
export function computeDiversityScore(genreDistribution) {
  const values = Object.entries(genreDistribution)
    .filter(([k]) => !k.startsWith('_'))
    .map(([, v]) => v)
    .filter(v => v > 0);

  if (values.length <= 1) return 0;

  const entropy    = -values.reduce((sum, p) => sum + p * Math.log2(p), 0);
  const maxEntropy = Math.log2(values.length);

  return maxEntropy > 0 ? Math.round((entropy / maxEntropy) * 100) / 100 : 0;
}
