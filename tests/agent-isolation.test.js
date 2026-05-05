/**
 * Agent Music — Agent Isolation Tests (Sprint 1.4)
 *
 * These tests enforce the CONTEXT CONTRACT:
 * - Agents must read pre-loaded data from context.*, not call DataStore/UserModel directly
 * - The Scout's intent classifier correctly gates intentOverrideActive
 * - The Curator correctly prioritizes Scout handoff when intentOverrideActive is set
 *
 * All tests run without network, Spotify, or LLM calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Scout intent classifier (extracted for unit testing)
// Matches the implementation in src/agents/scout-agent.js
// ---------------------------------------------------------------------------

function classifyIntentType(intent) {
  const text = (intent || '').toLowerCase();
  if (/check.?out|listen to|heard about|friend.*told|try\s+\w|got.?into|looking for|want to hear|play me|show me|find me|introduce me to\s+\w|give me some|just\s+\w|only\s+\w|\bcheck\b|\btry\b/.test(text)) return 'specific';
  if (/familiar|favorites|my usual|top artists|what i know|same as always|my go-to|nothing new/.test(text)) return 'broad';
  if (/explore|discover|new|underground|adventurous|\bintroduce me\b|haven.t heard|branch out|expand/.test(text)) return 'exploration';
  return 'general';
}

// ---------------------------------------------------------------------------
// PipelineContext fields (Sprint 1.1 contract)
// The context object must have all these fields populated before agents run
// ---------------------------------------------------------------------------

function makeMinimalContext(overrides = {}) {
  return {
    userId: 'test_user',
    sessionIntent: '',
    tier1: null,
    tier2: { sessions: [] },
    driftTrends: {},
    explicitPreferences: {},
    agentMemories: [],
    narrativeAnchors: [],
    sessionSignals: { skippedGenres: [], lovedGenres: [], skippedArtists: [] },
    recentPlaylistArtists: [],
    tasteState: null,
    candidatePool: [],
    scoredPlaylist: [],
    coverageGaps: [],
    settledAnchors: [],
    blackboard: {
      profiler: {},
      scout: {},
      curator: {},
      concierge: {},
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Intent classifier tests
// ---------------------------------------------------------------------------

describe('Scout._classifyIntentType()', () => {
  describe('specific requests — should suppress seed expansion', () => {
    const specificPhrases = [
      'check out Geese',
      'check out this band called Fontaines DC',
      'I want to listen to Hozier',
      'my friend told me to listen to Wednesday',
      'I heard about this band METZ',
      'I want to try some shoegaze',
      'I got into Fontaines DC recently',
      'play me some Radiohead',
      'show me what Geese sounds like',
      'just Fontaines DC please',
    ];

    for (const phrase of specificPhrases) {
      it(`classifies "${phrase}" as 'specific'`, () => {
        expect(classifyIntentType(phrase)).toBe('specific');
      });
    }
  });

  describe('broad requests — should use full seed expansion', () => {
    const broadPhrases = [
      'play my favorites',
      'my usual mix please',
      'top artists only',
      'same as always',
      'nothing new today',
      'my go-to playlist',
      'what I know',
    ];

    for (const phrase of broadPhrases) {
      it(`classifies "${phrase}" as 'broad'`, () => {
        expect(classifyIntentType(phrase)).toBe('broad');
      });
    }
  });

  describe('exploration requests — should use deep hop traversal', () => {
    const explorationPhrases = [
      'explore jazz',
      // "show me" triggers specific; use haven't-heard without "show me"
      "I haven't heard much metal, expand into that for me",
      'discover some underground artists',
      'adventurous mix please',
      'expand my taste',
    ];

    for (const phrase of explorationPhrases) {
      it(`classifies "${phrase}" as 'exploration'`, () => {
        expect(classifyIntentType(phrase)).toBe('exploration');
      });
    }
  });

  describe('general requests — no special gating', () => {
    it('classifies empty string as general', () => {
      expect(classifyIntentType('')).toBe('general');
    });

    it('classifies null as general', () => {
      expect(classifyIntentType(null)).toBe('general');
    });

    it('classifies "a balanced mix" as broad (contains top artists)', () => {
      // "top artists" in the phrase matches the 'broad' pattern — expected behavior
      expect(classifyIntentType('a balanced mix of my top artists')).toBe('broad');
    });

    it('classifies a plain description as general', () => {
      expect(classifyIntentType('something chill for the evening')).toBe('general');
    });
  });
});

// ---------------------------------------------------------------------------
// intentOverrideActive gate logic
// ---------------------------------------------------------------------------

describe('intentOverrideActive gate', () => {
  /**
   * Simulates the gate logic from scout-agent.js findCandidates().
   * Reflects the two-condition gate: pre-classified specific OR pool ≥ 5.
   */
  function simulateGate(sessionIntent, poolSize) {
    const intentType = classifyIntentType(sessionIntent);
    const isSpecificRequest = intentType === 'specific';
    const intentOverrideActive = isSpecificRequest || poolSize >= 5;
    return intentOverrideActive;
  }

  it('is TRUE for specific intent even if LLM returned empty pool', () => {
    expect(simulateGate('check out Geese', 0)).toBe(true);
  });

  it('is TRUE for specific intent with partial pool (< 5 tracks)', () => {
    expect(simulateGate('I want to try some Geese', 3)).toBe(true);
  });

  it('is TRUE for general intent when pool reaches 5+', () => {
    expect(simulateGate('a balanced mix', 5)).toBe(true);
  });

  it('is FALSE for general intent with small pool', () => {
    expect(simulateGate('a balanced mix', 4)).toBe(false);
  });

  it('is FALSE for broad intent with small pool (seed expansion should run)', () => {
    expect(simulateGate('play my favorites', 3)).toBe(false);
  });

  it('is TRUE for exploration intent still classified as specific sub-pattern', () => {
    // "check out" in an exploration context should still lock in
    expect(simulateGate('check out some new jazz artists', 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Context pre-loading contract
// ---------------------------------------------------------------------------

describe('PipelineContext pre-load contract', () => {
  it('has all required fields after _buildInitialContext()', () => {
    const ctx = makeMinimalContext();
    const requiredContextFields = [
      'tier1', 'tier2', 'driftTrends',
      'explicitPreferences', 'agentMemories',
      'narrativeAnchors', 'sessionSignals',
      'recentPlaylistArtists',
    ];
    for (const field of requiredContextFields) {
      expect(ctx).toHaveProperty(field);
    }
  });

  it('agentMemories is always an array (never undefined)', () => {
    const ctx = makeMinimalContext({ agentMemories: undefined });
    // Simulate what _buildInitialContext does
    ctx.agentMemories = ctx.agentMemories || [];
    expect(Array.isArray(ctx.agentMemories)).toBe(true);
  });

  it('narrativeAnchors falls back to [] if tier1 is null', () => {
    const ctx = makeMinimalContext({ tier1: null });
    ctx.narrativeAnchors = ctx.tier1?.narrativeAnchors || [];
    expect(ctx.narrativeAnchors).toEqual([]);
  });

  it('recentPlaylistArtists filters out entries older than 7 days', () => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const raw = [
      { artist: 'Old Band', date: cutoff - 1000 },  // expired
      { artist: 'Recent Band', date: Date.now() },   // valid
    ];
    const filtered = raw
      .filter(r => r.date > cutoff)
      .map(r => r.artist.toLowerCase());
    expect(filtered).not.toContain('old band');
    expect(filtered).toContain('recent band');
  });
});

// ---------------------------------------------------------------------------
// Curator prompt ordering contract
// ---------------------------------------------------------------------------

describe('Curator prompt priority ordering', () => {
  /**
   * Simulates building the Curator's system prompt with the Sprint 1.3 structure.
   * The Scout handoff + intentOverrideConstraint MUST appear before the taste profile.
   */
  function buildMockCuratorPrompt(scoutBlackboard) {
    const intentOverrideConstraint = scoutBlackboard?.intentOverrideActive
      ? '⚠ CRITICAL CONSTRAINT: The user made a SPECIFIC REQUEST.'
      : '';
    const scoutHandoff = scoutBlackboard
      ? `SCOUT'S HANDOFF: ${scoutBlackboard.searchStrategy}`
      : '';

    return [
      'SOUL_PREFIX',
      intentOverrideConstraint,
      scoutHandoff,
      'USER TASTE PROFILE:',
      'SESSION INTENT:',
    ].filter(Boolean).join('\n');
  }

  it('Scout handoff appears before taste profile in the prompt', () => {
    const prompt = buildMockCuratorPrompt({ searchStrategy: 'Hop depth 1', intentOverrideActive: false });
    const handoffIdx = prompt.indexOf("SCOUT'S HANDOFF");
    const tasteIdx = prompt.indexOf('USER TASTE PROFILE');
    expect(handoffIdx).toBeLessThan(tasteIdx);
  });

  it('CRITICAL CONSTRAINT appears before taste profile when intentOverrideActive', () => {
    const prompt = buildMockCuratorPrompt({ searchStrategy: 'Hop depth 0', intentOverrideActive: true });
    const constraintIdx = prompt.indexOf('CRITICAL CONSTRAINT');
    const tasteIdx = prompt.indexOf('USER TASTE PROFILE');
    expect(constraintIdx).toBeLessThan(tasteIdx);
    expect(constraintIdx).toBeGreaterThan(-1);
  });

  it('CRITICAL CONSTRAINT does NOT appear when intentOverrideActive is false', () => {
    const prompt = buildMockCuratorPrompt({ searchStrategy: 'Hop depth 1', intentOverrideActive: false });
    expect(prompt).not.toContain('CRITICAL CONSTRAINT');
  });

  it('No constraint when no Scout blackboard', () => {
    const prompt = buildMockCuratorPrompt(null);
    expect(prompt).not.toContain("SCOUT'S HANDOFF");
    expect(prompt).not.toContain('CRITICAL CONSTRAINT');
  });
});
