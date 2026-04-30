/**
 * TasteGraph — Music Dimensions
 * Maps macro-genres to the five MUSIC psychological dimensions
 * (Rentfrow & Gosling, 2011) and computes discovery metrics.
 *
 * Source-agnostic: works with any genre data (Spotify, Last.fm, MusicBrainz).
 * Survives Spotify API deprecation.
 */

import { MACRO_GENRES } from './genre-taxonomy.js';

/**
 * Mapping from our existing macro-genres to MUSIC dimensions.
 * Each macro-genre distributes its weight across 1-3 dimensions.
 * Weights per genre sum to 1.0.
 *
 * Dimensions:
 *   mellow         — smooth, relaxing, gentle
 *   unpretentious  — sincere, simple, acoustic
 *   sophisticated  — complex, layered, "intelligent"
 *   intense        — loud, aggressive, high-energy
 *   contemporary   — rhythmic, percussive, urban
 */
export const GENRE_TO_MUSIC = {
  'Pop':                  { mellow: 0.10, unpretentious: 0.30, sophisticated: 0.00, intense: 0.00, contemporary: 0.60 },
  'Hip-Hop / Rap':        { mellow: 0.00, unpretentious: 0.00, sophisticated: 0.00, intense: 0.20, contemporary: 0.80 },
  'Rock':                 { mellow: 0.00, unpretentious: 0.10, sophisticated: 0.20, intense: 0.70, contemporary: 0.00 },
  'R&B / Soul':           { mellow: 0.30, unpretentious: 0.20, sophisticated: 0.00, intense: 0.00, contemporary: 0.50 },
  'Electronic / Dance':   { mellow: 0.20, unpretentious: 0.00, sophisticated: 0.00, intense: 0.30, contemporary: 0.50 },
  'Metal':                { mellow: 0.00, unpretentious: 0.00, sophisticated: 0.10, intense: 0.90, contemporary: 0.00 },
  'Country / Folk':       { mellow: 0.20, unpretentious: 0.70, sophisticated: 0.10, intense: 0.00, contemporary: 0.00 },
  'Alternative / Indie':  { mellow: 0.00, unpretentious: 0.00, sophisticated: 0.40, intense: 0.40, contemporary: 0.20 },
  'Jazz / Blues':          { mellow: 0.15, unpretentious: 0.00, sophisticated: 0.80, intense: 0.05, contemporary: 0.00 },
  'Classical / Score':     { mellow: 0.30, unpretentious: 0.00, sophisticated: 0.70, intense: 0.00, contemporary: 0.00 },
};

/**
 * Compute the five MUSIC dimensions from a genre distribution.
 *
 * @param {Object} genreDistribution — e.g. { "Jazz / Blues": 0.45, "Rock": 0.30, ... }
 *   Values should be proportional weights (summing to ~1.0).
 * @returns {{ mellow, unpretentious, sophisticated, intense, contemporary }}
 *   Each dimension is 0.0–1.0.
 */
export function computeMusicDimensions(genreDistribution) {
  const dims = { mellow: 0, unpretentious: 0, sophisticated: 0, intense: 0, contemporary: 0 };

  if (!genreDistribution || Object.keys(genreDistribution).length === 0) {
    return dims;
  }

  for (const [genre, weight] of Object.entries(genreDistribution)) {
    if (genre.startsWith('_')) continue; // skip metadata fields like _confidence
    const mapping = GENRE_TO_MUSIC[genre];
    if (!mapping) continue;

    for (const [dim, factor] of Object.entries(mapping)) {
      dims[dim] += weight * factor;
    }
  }

  // Normalize: clamp to 0–1 (should already be ≤1 if distribution sums to 1)
  for (const dim of Object.keys(dims)) {
    dims[dim] = Math.min(1, Math.max(0, dims[dim]));
  }

  return dims;
}

/**
 * Compute a proportional genre distribution from an array of artists with genres.
 * Each artist contributes equally. Genres are mapped to macro-genres first.
 *
 * @param {Array} artists — [{ genres: ['indie rock', 'shoegaze'], ... }]
 * @param {Object} eloRatings — optional, keyed by artist id, to weight by Elo
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

    // Weight by Elo if available, otherwise equal weight
    const weight = eloRatings?.[artist.id]
      ? Math.max(1, eloRatings[artist.id].rating - 1300) / 200  // normalize ~1400-1800 → 0.5-2.5
      : 1;

    for (const macro of macros) {
      counts[macro] = (counts[macro] || 0) + weight;
      total += weight;
    }
  }

  // Normalize to proportions summing to ~1.0
  const distribution = {};
  if (total > 0) {
    for (const [genre, count] of Object.entries(counts)) {
      distribution[genre] = Math.round((count / total) * 100) / 100;
    }
  }

  return distribution;
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
    const comps = data.comparison_count || 0;
    for (const g of genres) {
      genreDepth[g] = (genreDepth[g] || 0) + comps;
    }
  }

  const genres = Object.keys(genreDepth);
  if (genres.length === 0) return 0.5;

  const totalComps = Object.values(genreDepth).reduce((a, b) => a + b, 0);
  const avgCompsPerGenre = totalComps / genres.length;

  // Gini-like concentration: if one genre dominates, specialist is high
  const maxGenreComps = Math.max(...Object.values(genreDepth));
  const concentration = totalComps > 0 ? maxGenreComps / totalComps : 0;

  // Fewer genres + high concentration = specialist
  // Many genres + low concentration = generalist
  const breadthPenalty = Math.min(1, genres.length / 10); // 10+ genres = full generalist signal
  const specialist = concentration * (1 - breadthPenalty * 0.5);

  return Math.round(Math.min(1, Math.max(0, specialist)) * 100) / 100;
}

/**
 * Compute genre diversity score.
 * Uses Shannon entropy normalized to 0-1.
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

  // Shannon entropy
  const entropy = -values.reduce((sum, p) => sum + p * Math.log2(p), 0);
  const maxEntropy = Math.log2(values.length);

  return maxEntropy > 0 ? Math.round((entropy / maxEntropy) * 100) / 100 : 0;
}
