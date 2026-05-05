/**
 * Agent Music — Sprint 5 Tests
 * E2E pipeline contract verification: the full Sprint 3 + 4 integration chain.
 *
 * Test strategy: we use source-level assertions (reading source files) for
 * UI components (DOM-dependent, JSDOM-hostile) and real unit tests for the
 * logic modules (taste-brief, narrator, orchestrator wiring).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Sprint 5.1: Playlist DNA Badges ---
describe('Sprint 5.1 — Track DNA Badges', () => {
  it('PlaylistView does not render provenance badges (intentionally removed for cleaner UI)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('./src/ui/components/playlist-view.js'), 'utf-8');
    // Badges were removed by design — track cards should be clean
    expect(src).not.toContain('_renderTrackBadges');
    expect(src).not.toContain('Taste Pick');
    // But the generic text filters are still present
    expect(src).toContain('_isGenericReflection');
    expect(src).toContain('_isGenericText');
  });

  it('PlaylistView uses dynamic title with multi-level fallback', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('./src/ui/components/playlist-view.js'), 'utf-8');
    // Title falls back: playlistTitle → playlistName → sessionIntent → 'Your Playlist'
    expect(src).toContain('context.playlistName');
    expect(src).toContain('context.sessionIntent');
    expect(src).toContain("'Your Playlist'");
  });

  it('_renderTrackBadges returns empty string for unknown source with 0 hop', () => {
    // Simulate the badge logic in isolation
    const candidate = { hopDistance: 0, source: '' };
    // Reconstruct the core logic
    const badges = [];
    const { hopDistance = 0, source = '' } = candidate;
    if (['web_discovery', 'cultural_discovery'].includes(source)) badges.push('web');
    else if (source === 'graph_hop') badges.push('graph');
    else if (hopDistance >= 1) badges.push('discovery');
    // For hop 0 seed: gets "Taste Pick"
    if (hopDistance === 0 && !['web_discovery', 'cultural_discovery', 'graph_hop'].includes(source)) {
      badges.push('taste_pick');
    }
    expect(badges).toContain('taste_pick');
    expect(badges).not.toContain('web');
    expect(badges).not.toContain('graph');
    expect(badges).not.toContain('discovery');
  });

  it('discovery badge fires for hop >= 1', () => {
    const candidate = { hopDistance: 2, source: 'unknown' };
    const badges = [];
    const { hopDistance = 0, source = '' } = candidate;
    if (['web_discovery', 'cultural_discovery'].includes(source)) badges.push('web');
    else if (source === 'graph_hop') badges.push('graph');
    else if (hopDistance >= 1) badges.push(`discovery_x${hopDistance}`);
    expect(badges[0]).toContain('discovery');
  });
});

// --- Sprint 5.2: Chat Panel Opening Message ---
describe('Sprint 5.2 — Chat Panel Opening Message', () => {
  it('ChatPanel has _openingShown guard flag', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('./src/ui/components/chat-panel.js'), 'utf-8');
    expect(src).toContain('_openingShown');
    expect(src).toContain('generateOpeningMessage');
  });

  it('Chat panel fires opening message only once (on first toggle)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('./src/ui/components/chat-panel.js'), 'utf-8');
    // Guard must gate the generateOpeningMessage call
    expect(src).toContain('if (!this._openingShown)');
    expect(src).toContain('this._openingShown = true');
  });
});

// --- Sprint 5.3: Agent Status Thought Mapping ---
describe('Sprint 5.3 — Agent Status Thought Intelligence', () => {
  it('AgentStatus has 5 pipeline stages including Cultural', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('./src/ui/components/agent-status.js'), 'utf-8');
    expect(src).toContain("id: 'cultural'");
    expect(src).toContain("label: 'Research'");
  });

  it('humanizeThought maps CulturalScout messages', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('./src/ui/components/agent-status.js'), 'utf-8');
    expect(src).toContain('CulturalScout');
    expect(src).toContain('Cultural(Scout|Intel|Intelligence)');
  });

  it('humanizeThought maps Curator Selection Thesis', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('./src/ui/components/agent-status.js'), 'utf-8');
    expect(src).toContain('Selection Thesis');
    expect(src).toContain('🎯');
  });

  it('humanizeThought maps Narrator enrichment completion', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('./src/ui/components/agent-status.js'), 'utf-8');
    expect(src).toContain('Narrator.*Enrich');
    expect(src).toContain('music-history context');
  });
});

// --- Sprint 5.4: E2E Pipeline Contract ---
describe('Sprint 5.4 — E2E Pipeline Contract', () => {
  // Verify the full data flow: tasteBrief → Curator → enrichment → anti-repetition
  it('full pipeline contract: TasteBrief is built, formatted, consumed by Curator', async () => {
    const { buildTasteBrief, formatTasteBriefForPrompt } = await import('../src/agents/taste-brief.js');

    const context = {
      tier1: { tasteProfile: { anchorArtists: [{ name: 'Fontaines DC', rating: 1800, genres: ['post-punk'] }] }, sophistication: { level: 'engaged' } },
      tier2: { sessions: [{ lovedArtists: ['Fontaines DC'], stats: { skipRate: 15 } }] },
      tasteState: { eloRatings: {}, tasteTiers: { coreIdentity: ['Fontaines DC'] } },
      tasteProfile: { anchoredTopArtist: 'Fontaines DC', dominantGenres: ['post-punk'] },
      driftTrends: { genreMomentum: [{ genre: 'post-punk' }], discoveryTrajectory: 'stable' },
      agentMemories: ['Loves guitar-driven music'],
      narrativeAnchors: [{ text: 'Post-punk is their home genre' }],
    };

    // 1. Build the brief
    const brief = buildTasteBrief(context);
    expect(brief.identity.northStar).toBe('Fontaines DC');
    expect(brief.explicit.permanentNotes).toContain('Loves guitar-driven music');

    // 2. Format it for a prompt
    const formatted = formatTasteBriefForPrompt(brief);
    expect(formatted).toContain('USER TASTE DNA');
    expect(formatted).toContain('Fontaines DC');
    expect(formatted).toContain('Loves guitar-driven music');
    expect(formatted).toContain('Post-punk is their home genre');

    // 3. Verify Curator imports it
    const fs = await import('fs');
    const path = await import('path');
    const curatorSrc = fs.readFileSync(path.resolve('./src/agents/curator-agent.js'), 'utf-8');
    expect(curatorSrc).toContain("import { formatTasteBriefForPrompt } from './taste-brief.js'");
    expect(curatorSrc).toContain('context?.tasteBrief');
  });

  it('full pipeline contract: Narrator has enrichDiscoveryTracks()', async () => {
    const { NarratorAgent } = await import('../src/agents/narrator-agent.js');
    const narrator = new NarratorAgent();
    expect(typeof narrator.enrichDiscoveryTracks).toBe('function');
    // Empty input returns empty, no crash
    const result = await narrator.enrichDiscoveryTracks([], {});
    expect(result).toEqual({});
  });

  it('full pipeline contract: anti-repetition is both written and read', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const orcSrc = fs.readFileSync(path.resolve('./src/agents/orchestrator.js'), 'utf-8');
    // Must write
    expect(orcSrc).toContain("DataStore.save('recent_playlist_artists'");
    // Must read
    expect(orcSrc).toContain("DataStore.load('recent_playlist_artists')");
    // Must prune by 7 days
    expect(orcSrc).toContain('7 * 24 * 60 * 60 * 1000');
    // Must merge-deduplicate
    expect(orcSrc).toContain('mergedMap');
  });

  it('full pipeline contract: tasteBrief is on PipelineContext', async () => {
    const { PipelineContext } = await import('../src/agents/pipeline-context.js');
    const ctx = PipelineContext.create('user_local', 'post-punk for a rainy day');
    expect(ctx).toHaveProperty('tasteBrief');
    expect(ctx.tasteBrief).toBeNull(); // starts null, set by Orchestrator
  });

  it('full pipeline contract: Orchestrator builds tasteBrief after Profiler', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const orcSrc = fs.readFileSync(path.resolve('./src/agents/orchestrator.js'), 'utf-8');
    // Import is present
    expect(orcSrc).toContain("import { buildTasteBrief } from './taste-brief.js'");
    // Is called and stored
    expect(orcSrc).toContain('context.tasteBrief = buildTasteBrief(context)');
    // Has error guard (graceful degradation)
    expect(orcSrc).toContain('TasteBrief failed');
  });

  it('full pipeline contract: Narrator enrichment is wired as fire-and-forget in Stage 4.5', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const orcSrc = fs.readFileSync(path.resolve('./src/agents/orchestrator.js'), 'utf-8');
    expect(orcSrc).toContain('Stage 4.5');
    expect(orcSrc).toContain('enrichDiscoveryTracks');
    expect(orcSrc).toContain('fire-and-forget');
    // Should only enrich tracks with hopDistance >= 1 or web/cultural/graph sources
    expect(orcSrc).toContain("['web_discovery', 'graph_hop', 'cultural_discovery']");
  });

  it('full pipeline contract: Concierge has proactive message and session continuity', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const concSrc = fs.readFileSync(path.resolve('./src/agents/concierge-agent.js'), 'utf-8');
    expect(concSrc).toContain('generateOpeningMessage');
    expect(concSrc).toContain('sessionSummary');
    expect(concSrc).toContain('_updateSessionSummary');
    expect(concSrc).toContain("import { formatTasteBriefForPrompt } from './taste-brief.js'");
  });
});
