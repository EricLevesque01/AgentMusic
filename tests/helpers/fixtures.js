/**
 * Agent Music — Shared Test Fixtures
 *
 * Canonical taste profiles and pipeline runners used by all judge suites.
 * No mocks — these represent realistic user states for integration testing.
 */

import { ScoutAgent } from '../../src/agents/scout-agent.js';
import { CuratorAgent } from '../../src/agents/curator-agent.js';
import { PipelineContext } from '../../src/agents/pipeline-context.js';

// ═══════════════════════════════════════════════════════════════
// Canonical intents for test scenarios
// ═══════════════════════════════════════════════════════════════

export const TEST_INTENTS = {
  LATE_NIGHT_JAZZ: 'late night jazz, instrumental, no lyrics',
  MELANCHOLIC_INDIE: 'melancholic indie rock with a dreamy atmosphere',
  HIGH_ENERGY: 'high energy workout mix — driving beats, intense, motivating',
  AMBIENT_STUDY: 'calm ambient for late night studying — no vocals, minimal',
  ARTIST_DEEP_DIVE: 'something that captures the same emotional weight as Grace by Jeff Buckley',
  JAZZ_DEEP_DIVE: 'deep dive into jazz — modal and cool jazz from the 50s and 60s',
  JAZZ_STANDARDS: 'timeless jazz standards and vocal jazz classics',
  CLASSICAL_PIANO: 'explore classical piano — Chopin, Debussy, Satie',
  GRUNGE: '90s grunge deep cuts — Mudhoney, Melvins, TAD',
};

// ═══════════════════════════════════════════════════════════════
// Taste state builders
// ═══════════════════════════════════════════════════════════════

/**
 * Build a realistic taste state — this is test INPUT, not a mock.
 * Represents a user who has played the Taste Game and has calibrated preferences.
 *
 * @param {'default'|'jazz'|'electronic'} variant — Which persona to build
 */
export function buildTasteState(variant = 'default') {
  const eloRatings = {
    jb: { rating: 1800, name: 'Jeff Buckley', genres: ['singer-songwriter', 'alternative rock', 'folk rock'], wins: 12, losses: 2, ties: 0, comparison_count: 14, last_compared_at: Date.now() },
    rh: { rating: 1750, name: 'Radiohead', genres: ['art rock', 'alternative rock', 'electronic'], wins: 10, losses: 3, ties: 0, comparison_count: 13, last_compared_at: Date.now() },
    md: { rating: 1700, name: 'Miles Davis', genres: ['jazz', 'modal jazz', 'cool jazz'], wins: 9, losses: 3, ties: 0, comparison_count: 12, last_compared_at: Date.now() },
    bk: { rating: 1650, name: 'Björk', genres: ['art pop', 'electronic', 'experimental'], wins: 8, losses: 4, ties: 0, comparison_count: 12, last_compared_at: Date.now() },
    bt: { rating: 1600, name: 'Big Thief', genres: ['indie folk', 'indie rock', 'alternative'], wins: 7, losses: 5, ties: 0, comparison_count: 12, last_compared_at: Date.now() },
    nf: { rating: 1550, name: 'Nils Frahm', genres: ['ambient', 'neo-classical', 'electronic'], wins: 6, losses: 5, ties: 0, comparison_count: 11, last_compared_at: Date.now() },
    ma: { rating: 1500, name: 'Massive Attack', genres: ['trip hop', 'electronic', 'downtempo'], wins: 5, losses: 5, ties: 0, comparison_count: 10, last_compared_at: Date.now() },
    es: { rating: 1350, name: 'Ed Sheeran', genres: ['pop', 'singer-songwriter'], wins: 2, losses: 10, ties: 0, comparison_count: 12, last_compared_at: Date.now() },
  };

  const artists = Object.entries(eloRatings).map(([id, data]) => ({
    id,
    name: data.name,
    genres: data.genres,
    images: [],
  }));

  return {
    eloRatings,
    artists,
    topRankedArtists: Object.values(eloRatings).sort((a, b) => b.rating - a.rating),
    totalRatedArtists: Object.keys(eloRatings).length,
    topGenres: ['alternative rock', 'art rock', 'jazz', 'electronic', 'indie folk', 'folk rock'],
    tasteTiers: {
      coreIdentity: ['Jeff Buckley', 'Radiohead'],
      activeObsessions: ['Miles Davis', 'Björk', 'Big Thief'],
      fringeDiscovery: ['Nils Frahm', 'Massive Attack'],
      activelyDismissed: ['Ed Sheeran'],
    },
    musicDimensions: { mellow: 0.65, unpretentious: 0.4, sophisticated: 0.75, intense: 0.55, contemporary: 0.6 },
    discoveryProfile: { mainstreaminess: 0.35, specialistIndex: 0.6, diversityScore: 0.7 },
    genreDistribution: { 'alternative rock': 0.25, 'jazz': 0.15, 'electronic': 0.15, 'indie folk': 0.12, 'art pop': 0.1, 'folk rock': 0.08, 'ambient': 0.08, 'trip hop': 0.07 },
    explicitPreferences: { agent_memories: ['I like melancholy but not defeatist music', 'Jeff Buckley is my north star artist'] },
    temporalLayers: { identity: [], evolution: [], mood: [] },
    tracks: [],
  };
}

// ═══════════════════════════════════════════════════════════════
// Pipeline runner — shared across all judge suites
// ═══════════════════════════════════════════════════════════════

/** Collect agent thoughts for inspection. */
function createThoughtCollector() {
  const thoughts = [];
  return { record: (msg) => thoughts.push(msg), thoughts };
}

/**
 * Run the real Scout → Curator pipeline.
 * No mocks — calls real Gemini, Last.fm, MusicBrainz APIs.
 * The Curator produces all playlist metadata directly (no Narrator).
 *
 * @param {string} intent        — Session intent
 * @param {object} [tasteState]  — Override taste state (defaults to buildTasteState())
 * @returns {{ context: PipelineContext, thoughts: string[], durationMs: number }}
 */
export async function runRealPipeline(intent, tasteState = null) {
  const start = Date.now();
  const ts = tasteState || buildTasteState();
  const context = PipelineContext.create('test_user', intent);
  context.tasteState = ts;

  // Populate taste profile on the context (normally done by Orchestrator)
  context.tasteProfile = {
    dominantGenres: ts.topGenres.slice(0, 3),
    underExploredGenres: ['trip hop', 'ambient'],
    anchoredTopArtist: 'Jeff Buckley',
    driftSummary: '',
  };

  // Populate blackboard profiler section
  context.blackboard.profiler = {
    musicDimensions: ts.musicDimensions,
    discoveryProfile: ts.discoveryProfile,
    genreDistribution: ts.genreDistribution,
    temporalLayers: ts.temporalLayers,
    driftPatterns: [],
  };

  const collector = createThoughtCollector();

  // --- Real Scout ---
  const scout = new ScoutAgent();
  context.candidatePool = await scout.findCandidates(ts, intent, context, collector.record);

  // --- Real Curator ---
  const curator = new CuratorAgent();
  context.scoredPlaylist = await curator.rankAndSelect(ts, context.candidatePool, intent, {}, context, collector.record);
  context.curatorReflection = context.scoredPlaylist.curatorReflection;
  context.playlistName = context.scoredPlaylist.playlistName || null;

  if (context.blackboard) {
    context.blackboard.curator.selectionThesis = context.curatorReflection || '';
  }

  // --- Build explanations from Curator output (no Narrator) ---
  if (context.scoredPlaylist && context.scoredPlaylist.length > 0) {
    const trackMap = new Map();
    for (const c of context.scoredPlaylist) {
      trackMap.set(c.track.id, c.dominantFactor || `Selected for the "${intent}" session.`);
    }
    context.explanations = {
      playlistTitle: context.playlistName || 'Curated Playlist',
      playlistSummary: context.scoredPlaylist.playlistSummary
        || context.curatorReflection
        || `A mix of ${context.scoredPlaylist.length} tracks.`,
      trackExplanations: trackMap,
    };
  }

  const durationMs = Date.now() - start;
  console.log(`\n📋 Pipeline completed in ${(durationMs / 1000).toFixed(1)}s. ${collector.thoughts.length} agent thoughts captured.`);
  console.log(`📊 Candidate pool: ${context.candidatePool?.length || 0} tracks`);
  console.log(`📊 Scored playlist: ${context.scoredPlaylist?.length || 0} tracks`);

  return { context, thoughts: collector.thoughts, durationMs };
}
