/**
 * TasteGraph — Pipeline Context
 * Shared data object that flows through the agent pipeline.
 * All agents read from and write to this context.
 */

export class PipelineContext {
  constructor({ userId, sessionIntent, sessionId }) {
    // --- Inputs (set by Orchestrator) ---
    this.userId = userId;
    this.sessionId = sessionId;
    this.sessionIntent = sessionIntent || "A balanced mix of my top S-Tier artists and some similar discoveries.";

    // --- Profiler output ---
    this.tasteState = null;

    // --- Scout output ---
    this.candidatePool = [];

    // --- Curator output ---
    this.scoredPlaylist = [];

    // --- Narrator output ---
    this.explanations = {
      playlistSummary: '',
      trackExplanations: new Map(),
    };

    // --- Session DJ (injected asynchronously) ---
    this.sessionAdjustments = {
      intentOverride: {},
      penalizedGenres: [],
      boostedGenres: [],
      feedback: [],
    };

    // --- Concierge Agent (injected via conversation) ---
    this.conciergeActions = [];
    this.chatHistory = [];

    // --- Inter-Agent Context (Phase 2: Intelligent Orchestration) ---

    // Set by TasteGame → consumed by Scout + Curator
    this.coverageGaps = [];            // [{genre, totalComps, priority}]
    this.settledAnchors = [];          // [artistId] — fully settled artists
    this.calibrationInsights = [];     // [{artistId, name, finalRank, rounds}]

    // Set by SessionDJ → consumed by Scout + Curator + TasteGame
    this.sessionSignals = {
      skippedGenres: [],
      lovedGenres: [],
      skippedArtists: [],
    };

    // Set by Profiler → consumed by Curator + Narrator for richer context
    this.tasteProfile = {
      dominantGenres: [],       // top 3 by Elo comparison count
      underExploredGenres: [],  // from coverage gap tracker
      anchoredTopArtist: null,  // the settled #1 (north star for Curator)
      driftSummary: '',         // from detectDriftPatterns()
    };
  }

  /**
   * Factory method for creating a new context.
   */
  static create(userId, sessionIntent = "", sessionId = null) {
    return new PipelineContext({
      userId,
      sessionIntent,
      sessionId: sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  /**
   * Validate that the context is ready for a specific pipeline stage.
   */
  validateForStage(stage) {
    switch (stage) {
      case 'profiler':
        if (!this.userId) throw new Error('PipelineContext: userId is required for profiler stage');
        return true;
      case 'scout':
        if (!this.tasteState) throw new Error('PipelineContext: tasteState is required for scout stage');
        return true;
      case 'curator':
        if (!this.tasteState) throw new Error('PipelineContext: tasteState is required for curator stage');
        if (!this.candidatePool.length) throw new Error('PipelineContext: candidatePool is required for curator stage');
        return true;
      case 'narrator':
        if (!this.scoredPlaylist.length) throw new Error('PipelineContext: scoredPlaylist is required for narrator stage');
        return true;
      default:
        return true;
    }
  }
}
