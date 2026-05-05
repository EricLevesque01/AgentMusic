/**
 * Agent Music — Taste DNA Brief (Sprint 3.1)
 * A centralized, structured snapshot of the user's musical identity.
 *
 * Every agent was independently building ad-hoc context snippets from
 * DataStore, UserModel, and context fields. This module replaces all of
 * that with a single, shared brief that gets built once per pipeline run
 * and injected into every agent's system prompt via formatTasteBriefForPrompt().
 *
 * Consumers: Curator, Concierge, Narrator (background enrichment)
 * Producer:  Orchestrator (calls buildTasteBrief() after Profiler finishes)
 */

/**
 * Build a structured taste brief from the pipeline context.
 * @param {PipelineContext} context - The pipeline context with pre-loaded fields
 * @returns {Object} Structured taste DNA brief
 */
export function buildTasteBrief(context) {
  const { tier1, tier2, tasteState, driftTrends } = context || {};
  const tasteProfile = context?.tasteProfile || {};
  const eloRatings = tasteState?.eloRatings || {};

  // --- Identity layer: who they are (durable, slow-moving) ---
  const coreIdentity = tasteState?.tasteTiers?.coreIdentity || [];
  const anchorArtists = tier1?.tasteProfile?.anchorArtists || [];
  const musicDimensions = tier1?.tasteProfile?.musicDimensions || {};

  // --- Momentum layer: what's happening now ---
  const sessions = tier2?.sessions || [];
  const recentObsessions = sessions
    .slice(0, 3)
    .flatMap(s => s.lovedArtists || [])
    .filter(Boolean)
    .slice(0, 4);
  const lastSkipRate = sessions[0]?.stats?.skipRate ?? null;

  // --- Explicit layer: what they've told us ---
  const agentMemories = context?.agentMemories || [];
  const narrativeAnchors = (context?.narrativeAnchors || []).slice(0, 5);

  // --- Banned artists: anyone marked ignored in Elo ---
  const bannedArtists = Object.values(eloRatings)
    .filter(a => a.ignored)
    .map(a => a.name)
    .filter(Boolean);

  return {
    // Who they are (durable)
    identity: {
      northStar: tasteProfile.anchoredTopArtist || null,
      coreArtists: coreIdentity.slice(0, 5),
      dominantGenres: (tasteProfile.dominantGenres || []).slice(0, 3),
      musicPersonality: musicDimensions._confidence > 0 ? musicDimensions : null,
      sophistication: tier1?.sophistication?.level || 'unknown',
      anchorArtists: anchorArtists.slice(0, 5).map(a => ({
        name: a.name,
        rating: a.rating,
        genres: (a.genres || []).slice(0, 2),
      })),
    },

    // What's happening now (session + recent)
    momentum: {
      risingGenres: (driftTrends?.genreMomentum || []).slice(0, 2).map(g => g.genre),
      fadingGenres: (driftTrends?.genreDecline || []).slice(0, 2).map(g => g.genre),
      recentObsessions,
      skipRate: lastSkipRate,
      discoveryTrajectory: driftTrends?.discoveryTrajectory || 'stable',
    },

    // What they've told us (explicit)
    explicit: {
      permanentNotes: agentMemories,
      anchors: narrativeAnchors.map(a => a.text || a),
      bannedArtists,
    },

    // Cultural intelligence from this session's web research
    cultural: context?.blackboard?.culturalIntelligence || null,
  };
}

/**
 * Format a taste brief into a prompt-ready string.
 * Used by agents to inject the user's musical identity into their system prompt.
 * @param {Object} brief - Output of buildTasteBrief()
 * @returns {string} Formatted context block for LLM system prompts
 */
export function formatTasteBriefForPrompt(brief) {
  if (!brief) return '';

  const lines = ['USER TASTE DNA:'];

  // Identity
  if (brief.identity.northStar) {
    lines.push(`🌟 North Star Artist: ${brief.identity.northStar}`);
  }
  if (brief.identity.coreArtists.length > 0) {
    lines.push(`Core Identity: ${brief.identity.coreArtists.join(', ')}`);
  }
  if (brief.identity.dominantGenres.length > 0) {
    lines.push(`Dominant Genres: ${brief.identity.dominantGenres.join(', ')}`);
  }
  if (brief.identity.musicPersonality) {
    const dims = Object.entries(brief.identity.musicPersonality)
      .filter(([k]) => !k.startsWith('_'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d, v]) => `${d}: ${(v * 100).toFixed(0)}%`);
    if (dims.length > 0) lines.push(`MUSIC Personality: ${dims.join(', ')}`);
  }
  lines.push(`Sophistication: ${brief.identity.sophistication}`);

  // Momentum
  if (brief.momentum.risingGenres.length > 0) {
    lines.push(`📈 Rising: ${brief.momentum.risingGenres.join(', ')}`);
  }
  if (brief.momentum.fadingGenres.length > 0) {
    lines.push(`📉 Fading: ${brief.momentum.fadingGenres.join(', ')}`);
  }
  if (brief.momentum.recentObsessions.length > 0) {
    lines.push(`Recent Obsessions: ${brief.momentum.recentObsessions.join(', ')}`);
  }
  if (brief.momentum.skipRate !== null) {
    lines.push(`Last Skip Rate: ${brief.momentum.skipRate}%`);
  }
  lines.push(`Discovery Trajectory: ${brief.momentum.discoveryTrajectory}`);

  // Explicit
  if (brief.explicit.permanentNotes.length > 0) {
    lines.push(`\nPERMANENT USER NOTES:`);
    brief.explicit.permanentNotes.forEach(n => lines.push(`- ${n}`));
  }
  if (brief.explicit.anchors.length > 0) {
    lines.push(`\nNARRATIVE ANCHORS:`);
    brief.explicit.anchors.forEach(a => lines.push(`- "${a}"`));
  }
  if (brief.explicit.bannedArtists.length > 0) {
    lines.push(`\n🚫 BANNED ARTISTS: ${brief.explicit.bannedArtists.join(', ')}`);
  }

  // Cultural
  if (brief.cultural?.culturalContext) {
    lines.push(`\nCURRENT MUSIC WORLD (live web research):`);
    lines.push(brief.cultural.culturalContext);
  }

  return lines.join('\n');
}
