/**
 * Agent Music — Suite 9: Output Quality Review
 *
 * Covers the four pillars the user cares about:
 *   1. Track count sanity    — does the count make sense for the intent?
 *   2. Artist diversity      — no unnecessary repetition
 *   3. Intent adherence      — does the playlist actually serve the prompt?
 *   4. Reasoning quality     — are per-track reasons specific and earned?
 *
 * Deterministic structural checks run always (no API key needed).
 * LLM-as-judge evaluations run when RUN_JUDGE=1 is set.
 *
 * Run full suite: RUN_JUDGE=1 npx vitest run tests/judge/09-output-quality.test.js --reporter=verbose
 * Run structural only:       npx vitest run tests/judge/09-output-quality.test.js --reporter=verbose
 */

import { describe, it, expect } from 'vitest';
import '../helpers/setup.js';
import { SKIP_JUDGE } from '../helpers/setup.js';
import { llmJudge, diagnosticJudge, assertScore } from '../helpers/judge.js';
import { runRealPipeline, buildTasteState, TEST_INTENTS } from '../helpers/fixtures.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPlaylistForJudge(context, intent) {
  const tracks = (context.scoredPlaylist || []).map((t, i) =>
    `${i + 1}. "${t.track?.name || '?'}" by ${t.artistName || '?'}` +
    (t.dominantFactor && !isGeneric(t.dominantFactor) ? `\n   Reason: ${t.dominantFactor}` : '')
  ).join('\n');

  const artistCounts = {};
  for (const t of context.scoredPlaylist || []) {
    artistCounts[t.artistName] = (artistCounts[t.artistName] || 0) + 1;
  }

  return [
    `INTENT: "${intent}"`,
    `PLAYLIST NAME: ${context.playlistName || context.explanations?.playlistTitle || '(none)'}`,
    `CURATOR REFLECTION: ${context.curatorReflection || '(none)'}`,
    `TRACK COUNT: ${context.scoredPlaylist?.length || 0}`,
    `ARTIST DISTRIBUTION: ${Object.entries(artistCounts).map(([a, n]) => `${a} ×${n}`).join(', ')}`,
    `\nTRACKS:\n${tracks}`,
  ].join('\n');
}

const GENERIC_PATTERNS = [
  'selected based on your taste profile',
  'selected for this playlist',
  'added to reach target',
  'fits the vibe',
];

function isGeneric(text) {
  if (!text) return true;
  const lower = text.toLowerCase();
  return GENERIC_PATTERNS.some(p => lower.includes(p));
}

function artistRepeatViolations(scoredPlaylist, maxPerArtist = 2) {
  const counts = {};
  for (const t of scoredPlaylist) {
    counts[t.artistName] = (counts[t.artistName] || 0) + 1;
  }
  return Object.entries(counts).filter(([, n]) => n > maxPerArtist).map(([a, n]) => `${a} ×${n}`);
}

// ─── Structural Tests (no API key needed) ─────────────────────────────────────

describe('Output Quality — Structural (no API key)', () => {
  /**
   * These run against the real pipeline but assert structural invariants
   * without an LLM judge — so they run in every CI environment.
   */

  it('track count is ≥ 8 and ≤ 20 for a standard intent', async () => {
    const result = await runRealPipeline(TEST_INTENTS.MELANCHOLIC_INDIE);
    const count = result.context.scoredPlaylist?.length || 0;

    console.log(`\n📊 Track count for "${TEST_INTENTS.MELANCHOLIC_INDIE}": ${count}`);
    console.log(`   Artists: ${[...new Set(result.context.scoredPlaylist.map(t => t.artistName))].join(', ')}`);

    expect(count).toBeGreaterThanOrEqual(8);
    expect(count).toBeLessThanOrEqual(20);
  }, 180000);

  it('no artist appears more than 2 times in the playlist', async () => {
    const result = await runRealPipeline(TEST_INTENTS.MELANCHOLIC_INDIE);
    const violations = artistRepeatViolations(result.context.scoredPlaylist, 2);

    if (violations.length) {
      console.warn(`\n⚠️  Artist repeat violations: ${violations.join(', ')}`);
    } else {
      console.log('\n✅ No artist appears more than 2 times');
    }

    expect(violations).toHaveLength(0);
  }, 180000);

  it('artist deep-dive allows up to 3 tracks from the target artist', async () => {
    // "Jeff Buckley deep dive" is an agentic retrieval intent — the target artist CAN repeat
    const result = await runRealPipeline(TEST_INTENTS.ARTIST_DEEP_DIVE);
    const violations = artistRepeatViolations(result.context.scoredPlaylist, 3);

    console.log(`\n📊 Deep-dive track count: ${result.context.scoredPlaylist?.length}`);
    const counts = {};
    for (const t of result.context.scoredPlaylist) counts[t.artistName] = (counts[t.artistName] || 0) + 1;
    console.log(`   Artist distribution: ${Object.entries(counts).map(([a, n]) => `${a}×${n}`).join(', ')}`);

    expect(violations).toHaveLength(0);
  }, 180000);

  it('playlist name is not the generic default', async () => {
    const result = await runRealPipeline(TEST_INTENTS.LATE_NIGHT_JAZZ);
    const name = result.context.playlistName || result.context.explanations?.playlistTitle || '';

    console.log(`\n📋 Playlist name: "${name}"`);
    const generic = ['curated playlist', 'generated playlist', 'your playlist', 'curated mix', ''];
    expect(generic).not.toContain(name.toLowerCase().trim());
  }, 180000);

  it('curatorReflection is present and not the boilerplate default', async () => {
    const result = await runRealPipeline(TEST_INTENTS.GRUNGE);
    const reflection = result.context.curatorReflection || '';

    console.log(`\n🏛️ Curator reflection (first 200 chars): "${reflection.slice(0, 200)}..."`);

    const boilerplate = 'curated automatically based on intent and taste profile';
    expect(reflection.toLowerCase()).not.toContain(boilerplate);
    expect(reflection.length).toBeGreaterThan(50);
  }, 180000);

  it('at least 80% of tracks have a non-generic per-track reason', async () => {
    const result = await runRealPipeline(TEST_INTENTS.AMBIENT_STUDY);
    const tracks = result.context.scoredPlaylist || [];
    const withReason = tracks.filter(t => t.dominantFactor && !isGeneric(t.dominantFactor));
    const pct = tracks.length > 0 ? (withReason.length / tracks.length) * 100 : 0;

    console.log(`\n💬 Non-generic reasons: ${withReason.length}/${tracks.length} (${pct.toFixed(0)}%)`);
    for (const t of tracks.slice(0, 5)) {
      console.log(`   "${t.track?.name}" — ${t.dominantFactor?.slice(0, 80) || '(none)'}`);
    }

    expect(pct).toBeGreaterThanOrEqual(80);
  }, 180000);

  it('a genre-specific intent does not bleed into the wrong genre', async () => {
    // Grunge request should not contain jazz/classical/ambient artists
    const result = await runRealPipeline(TEST_INTENTS.GRUNGE);
    const artists = result.context.scoredPlaylist.map(t => t.artistName.toLowerCase());
    const wrongGenreArtists = artists.filter(a =>
      ['nils frahm', 'miles davis', 'john coltrane', 'erik satie', 'debussy', 'chopin'].some(x => a.includes(x))
    );

    console.log(`\n🎸 Grunge intent — artists: ${[...new Set(artists)].join(', ')}`);
    if (wrongGenreArtists.length) console.warn(`   ⚠️ Wrong-genre artists found: ${wrongGenreArtists}`);

    expect(wrongGenreArtists).toHaveLength(0);
  }, 180000);
});

// ─── LLM Judge Tests (RUN_JUDGE=1 required) ───────────────────────────────────

describe.skipIf(SKIP_JUDGE)('Output Quality — LLM Judge', () => {

  const TRACK_COUNT_RUBRIC = `A playlist was generated for a specific intent. Evaluate whether the track count is appropriate.
Score 5: Count is ideal (10-15 for casual intents, 8-12 for deep dives, 12-18 for mixes). Never padded.
Score 4: Count is reasonable with 1-2 tracks that feel like padding.
Score 3: Count is technically fine but feels either sparse (≤7) or bloated (≥18 without clear reason).
Score 2: Clear mismatch — either far too few or so many it becomes a dump.
Score 1: The pipeline clearly failed to determine an appropriate length.`;

  const REASONING_RUBRIC = `Per-track reasons were generated by a Curator agent for a playlist.
Evaluate the overall QUALITY of the per-track reasoning.
Score 5: Every reason is specific to THIS user and THIS intent. References sonic DNA, cultural context, or the user's known taste anchors. Never generic.
Score 4: Most reasons are specific. 1-2 feel templated but are not false.
Score 3: Reasons are plausible but generic — could apply to any playlist for any user.
Score 2: Multiple reasons are copy-paste boilerplate ("fits the vibe", "matches your taste").
Score 1: Reasons add no information — they are all the same or all generic.`;

  const INTENT_ADHERENCE_RUBRIC = `A music playlist was assembled by an AI for a specific user intent.
Evaluate how faithfully the playlist serves the stated intent.
Score 5: Every track authentically serves the intent. Genre, mood, and energy are consistent throughout.
Score 4: Mostly on-intent with 1-2 reasonable stretches or bridges.
Score 3: Half the tracks are clearly on-intent, but the user's habitual favorites dominate without justification.
Score 2: Intent is partially ignored — the playlist looks more like a "user favorites" dump than a targeted curation.
Score 1: The intent is completely disregarded.`;

  const DIVERSITY_RUBRIC = `A playlist was generated for a music user. Evaluate artist diversity.
Score 5: Rich variety. No artist dominates. Each selection feels purposeful, not filler.
Score 4: Good diversity with 1 artist appearing slightly too often (3 tracks).
Score 3: 1-2 artists dominate (3-4 tracks each) without justification from the intent.
Score 2: The same 2-3 artists make up most of the playlist.
Score 1: A single artist or the user's top artist dominates 5+ tracks.`;

  it('track count is appropriate for intent — JAZZ', async () => {
    const result = await runRealPipeline(TEST_INTENTS.LATE_NIGHT_JAZZ);
    const text = formatPlaylistForJudge(result.context, TEST_INTENTS.LATE_NIGHT_JAZZ);
    console.log('\n=== Track Count — Jazz ===\n', text.slice(0, 1200));
    await assertScore(text, TRACK_COUNT_RUBRIC, 3, '🔢 Track Count (Jazz)', expect);
  }, 300000);

  it('per-track reasoning is specific and earned — MELANCHOLIC INDIE', async () => {
    const result = await runRealPipeline(TEST_INTENTS.MELANCHOLIC_INDIE);
    const text = formatPlaylistForJudge(result.context, TEST_INTENTS.MELANCHOLIC_INDIE);
    console.log('\n=== Reasoning Quality — Melancholic Indie ===\n', text.slice(0, 2000));
    await assertScore(text, REASONING_RUBRIC, 3, '💬 Reasoning Quality (Melancholic Indie)', expect);
  }, 300000);

  it('intent adherence — genre-specific GRUNGE request', async () => {
    const result = await runRealPipeline(TEST_INTENTS.GRUNGE);
    const text = formatPlaylistForJudge(result.context, TEST_INTENTS.GRUNGE);
    console.log('\n=== Intent Adherence — Grunge ===\n', text.slice(0, 2000));
    await assertScore(text, INTENT_ADHERENCE_RUBRIC, 3, '🎯 Intent Adherence (Grunge)', expect);
  }, 300000);

  it('artist diversity — no unnecessary repetition', async () => {
    const result = await runRealPipeline(TEST_INTENTS.HIGH_ENERGY);
    const text = formatPlaylistForJudge(result.context, TEST_INTENTS.HIGH_ENERGY);
    console.log('\n=== Diversity — High Energy ===\n', text.slice(0, 1500));
    await assertScore(text, DIVERSITY_RUBRIC, 3, '🌈 Artist Diversity (High Energy)', expect);
  }, 300000);

  it('multi-dimension diagnostic — full quality audit on ARTIST DEEP DIVE', async () => {
    const result = await runRealPipeline(TEST_INTENTS.ARTIST_DEEP_DIVE);
    const text = formatPlaylistForJudge(result.context, TEST_INTENTS.ARTIST_DEEP_DIVE);

    const dimensions = [
      { name: 'Track Count', description: 'Is the number of tracks appropriate for the intent?' },
      { name: 'Intent Adherence', description: 'Does every track authentically serve the stated intent?' },
      { name: 'Reasoning Quality', description: 'Are per-track reasons specific, earned, and informative?' },
      { name: 'Artist Diversity', description: 'Is the artist distribution healthy, with no unnecessary repetition?' },
      { name: 'Sonic Coherence', description: 'Does the playlist hold together as a cohesive listening experience?' },
    ];

    console.log('\n=== Full Quality Audit — Artist Deep Dive ===');
    console.log(text.slice(0, 2000));

    const results = await diagnosticJudge(text, dimensions);

    console.log('\n📋 Diagnostic Results:');
    let allAbove2 = true;
    for (const r of results) {
      const icon = r.score >= 4 ? '✅' : r.score >= 3 ? '🟡' : '❌';
      console.log(`  ${icon} ${r.dimension}: ${r.score}/5`);
      console.log(`     ✓ ${r.what_works}`);
      console.log(`     ✗ ${r.what_fails}`);
      console.log(`     → ${r.how_to_improve}`);
      if (r.score < 3) allAbove2 = false;
    }

    // At least 4 out of 5 dimensions must score ≥ 3
    const passing = results.filter(r => r.score >= 3).length;
    console.log(`\n📊 Dimensions scoring ≥ 3: ${passing}/${results.length}`);
    if (results.length > 0) {
      expect(passing).toBeGreaterThanOrEqual(Math.floor(results.length * 0.8));
    }
  }, 600000);
});
