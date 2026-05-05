/**
 * Agent Music — Sprint 3 Tests
 * Tests for: Taste DNA Brief, Selection Thesis, Narrator Enrichment, Anti-Repetition
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Sprint 3.1: Taste DNA Brief ---
describe('Sprint 3.1 — Taste DNA Brief', () => {
  let buildTasteBrief, formatTasteBriefForPrompt;

  beforeEach(async () => {
    const mod = await import('../src/agents/taste-brief.js');
    buildTasteBrief = mod.buildTasteBrief;
    formatTasteBriefForPrompt = mod.formatTasteBriefForPrompt;
  });

  it('should build a structured brief from a full context', () => {
    const context = {
      tier1: {
        tasteProfile: {
          anchorArtists: [
            { name: 'Fontaines DC', rating: 1800, genres: ['post-punk', 'indie'] },
            { name: 'Geese', rating: 1700, genres: ['art-rock'] },
          ],
          musicDimensions: { intense: 0.8, sophisticated: 0.6, _confidence: 0.7 },
        },
        sophistication: { level: 'engaged' },
      },
      tier2: {
        sessions: [
          { lovedArtists: ['Fontaines DC', 'Shame'], stats: { skipRate: 12 } },
          { lovedArtists: ['IDLES'], stats: { skipRate: 25 } },
        ],
      },
      tasteState: {
        eloRatings: {
          'a1': { name: 'Fontaines DC', rating: 1800 },
          'a2': { name: 'Ignored Band', rating: 1000, ignored: true },
        },
        tasteTiers: { coreIdentity: ['Fontaines DC', 'Shame'] },
      },
      tasteProfile: {
        anchoredTopArtist: 'Fontaines DC',
        dominantGenres: ['post-punk', 'indie rock', 'art rock'],
      },
      driftTrends: {
        genreMomentum: [{ genre: 'post-punk', delta: 0.3, sessions: 3 }],
        genreDecline: [{ genre: 'pop', delta: -0.2, sessions: 2 }],
        discoveryTrajectory: 'expanding',
      },
      agentMemories: ['User loves melancholy but not defeatist'],
      narrativeAnchors: [{ text: 'Post-punk is their home genre' }],
      blackboard: { culturalIntelligence: { culturalContext: 'Fontaines DC just released a new album' } },
    };

    const brief = buildTasteBrief(context);

    // Identity layer
    expect(brief.identity.northStar).toBe('Fontaines DC');
    expect(brief.identity.coreArtists).toContain('Fontaines DC');
    expect(brief.identity.dominantGenres).toContain('post-punk');
    expect(brief.identity.musicPersonality).not.toBeNull();
    expect(brief.identity.sophistication).toBe('engaged');
    expect(brief.identity.anchorArtists).toHaveLength(2);

    // Momentum layer
    expect(brief.momentum.risingGenres).toContain('post-punk');
    expect(brief.momentum.fadingGenres).toContain('pop');
    expect(brief.momentum.recentObsessions).toContain('Fontaines DC');
    expect(brief.momentum.skipRate).toBe(12);
    expect(brief.momentum.discoveryTrajectory).toBe('expanding');

    // Explicit layer
    expect(brief.explicit.permanentNotes).toContain('User loves melancholy but not defeatist');
    expect(brief.explicit.anchors).toContain('Post-punk is their home genre');
    expect(brief.explicit.bannedArtists).toContain('Ignored Band');

    // Cultural
    expect(brief.cultural.culturalContext).toContain('Fontaines DC');
  });

  it('should handle empty/null context gracefully', () => {
    const brief = buildTasteBrief({});
    expect(brief.identity.northStar).toBeNull();
    expect(brief.identity.coreArtists).toEqual([]);
    expect(brief.momentum.risingGenres).toEqual([]);
    expect(brief.explicit.permanentNotes).toEqual([]);
    expect(brief.cultural).toBeNull();
  });

  it('should handle fully null context', () => {
    const brief = buildTasteBrief(null);
    expect(brief.identity.coreArtists).toEqual([]);
    expect(brief.momentum.skipRate).toBeNull();
  });

  it('formatTasteBriefForPrompt should produce a non-empty string from a valid brief', () => {
    const brief = buildTasteBrief({
      tasteProfile: { anchoredTopArtist: 'Fontaines DC', dominantGenres: ['post-punk'] },
      tasteState: { tasteTiers: { coreIdentity: ['Fontaines DC'] }, eloRatings: {} },
      agentMemories: ['Loves guitar-driven music'],
      narrativeAnchors: [],
      driftTrends: { genreMomentum: [{ genre: 'post-punk' }], discoveryTrajectory: 'expanding' },
    });

    const formatted = formatTasteBriefForPrompt(brief);
    expect(formatted).toContain('Fontaines DC');
    expect(formatted).toContain('post-punk');
    expect(formatted).toContain('Loves guitar-driven music');
    expect(formatted).toContain('USER TASTE DNA');
  });

  it('formatTasteBriefForPrompt should return empty string for null brief', () => {
    expect(formatTasteBriefForPrompt(null)).toBe('');
  });
});

// --- Sprint 3.2: Selection Thesis ---
describe('Sprint 3.2 — Curator Selection Thesis', () => {
  it('the Curator system prompt should contain the Selection Thesis instructions', async () => {
    // We test this by reading the curator-agent source and checking for the thesis prompt
    const fs = await import('fs');
    const path = await import('path');
    const curatorSource = fs.readFileSync(
      path.resolve('./src/agents/curator-agent.js'), 'utf-8'
    );

    expect(curatorSource).toContain('CURATION METHOD');
    expect(curatorSource).toContain('THESIS');
    expect(curatorSource).toContain('emotional/sonic arc');
    expect(curatorSource).toContain('discovery ratio');
    expect(curatorSource).toContain('deliberately EXCLUDE');
    expect(curatorSource).toContain('Step 1');
    expect(curatorSource).toContain('Step 2');
  });

  it('the Curator imports formatTasteBriefForPrompt', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const curatorSource = fs.readFileSync(
      path.resolve('./src/agents/curator-agent.js'), 'utf-8'
    );
    expect(curatorSource).toContain("import { formatTasteBriefForPrompt } from './taste-brief.js'");
  });
});

// --- Sprint 3.3: Narrator Discovery Enrichment ---
describe('Sprint 3.3 — Narrator Discovery Enrichment', () => {
  it('NarratorAgent should have an enrichDiscoveryTracks method', async () => {
    const { NarratorAgent } = await import('../src/agents/narrator-agent.js');
    const narrator = new NarratorAgent();
    expect(typeof narrator.enrichDiscoveryTracks).toBe('function');
  });

  it('enrichDiscoveryTracks should return empty object for empty tracks', async () => {
    const { NarratorAgent } = await import('../src/agents/narrator-agent.js');
    const narrator = new NarratorAgent();
    const result = await narrator.enrichDiscoveryTracks([], {});
    expect(result).toEqual({});
  });

  it('enrichDiscoveryTracks should return empty object for null tracks', async () => {
    const { NarratorAgent } = await import('../src/agents/narrator-agent.js');
    const narrator = new NarratorAgent();
    const result = await narrator.enrichDiscoveryTracks(null, {});
    expect(result).toEqual({});
  });

  it('the Narrator imports taste-brief utilities', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const narratorSource = fs.readFileSync(
      path.resolve('./src/agents/narrator-agent.js'), 'utf-8'
    );
    expect(narratorSource).toContain("import { formatTasteBriefForPrompt } from './taste-brief.js'");
    expect(narratorSource).toContain("import { buildSoulPrefix } from './soul.js'");
  });
});

// --- Sprint 3.4: Anti-Repetition Engine ---
describe('Sprint 3.4 — Anti-Repetition Persistence', () => {
  it('the Orchestrator persists recentPlaylistArtists after playlist generation', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const orchestratorSource = fs.readFileSync(
      path.resolve('./src/agents/orchestrator.js'), 'utf-8'
    );

    // Should contain the persistence logic
    expect(orchestratorSource).toContain("DataStore.save('recent_playlist_artists'");
    expect(orchestratorSource).toContain('Anti-repetition persistence');
    // Should merge and deduplicate
    expect(orchestratorSource).toContain('mergedMap');
    // Should prune by 7-day TTL
    expect(orchestratorSource).toContain('7 * 24 * 60 * 60 * 1000');
  });

  it('the Orchestrator reads recentPlaylistArtists in _buildInitialContext', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const orchestratorSource = fs.readFileSync(
      path.resolve('./src/agents/orchestrator.js'), 'utf-8'
    );

    expect(orchestratorSource).toContain("DataStore.load('recent_playlist_artists')");
    expect(orchestratorSource).toContain('context.recentPlaylistArtists');
  });
});

// --- Sprint 3.1 Integration: Orchestrator builds tasteBrief ---
describe('Sprint 3.1 Integration — Orchestrator builds tasteBrief', () => {
  it('the Orchestrator imports buildTasteBrief and invokes it after Profiler', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const orchestratorSource = fs.readFileSync(
      path.resolve('./src/agents/orchestrator.js'), 'utf-8'
    );

    expect(orchestratorSource).toContain("import { buildTasteBrief } from './taste-brief.js'");
    expect(orchestratorSource).toContain('context.tasteBrief = buildTasteBrief(context)');
  });

  it('PipelineContext has a tasteBrief field', async () => {
    const { PipelineContext } = await import('../src/agents/pipeline-context.js');
    const ctx = PipelineContext.create('test_user', 'test intent');
    expect(ctx).toHaveProperty('tasteBrief');
    expect(ctx.tasteBrief).toBeNull();
  });
});
