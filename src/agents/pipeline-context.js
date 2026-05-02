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

    // Curator reflection — set by Curator, read by Narrator
    this.curatorReflection = '';

    // --- Blackboard: Structured inter-agent handoff notes (Phase 5) ---
    this.blackboard = {
      profiler: {
        musicDimensions: null,    // MUSIC psychological dimensions
        discoveryProfile: null,   // mainstreaminess, specialist, diversity
        genreDistribution: null,  // proportional genre targets
        temporalLayers: null,     // identity/evolution/mood
        driftPatterns: [],        // from detectDriftPatterns()
      },
      scout: {
        searchStrategy: '',       // natural language explanation of what Scout did
        totalCandidates: 0,       // size of the pool passed to Curator
        hopDepthUsed: 0,          // actual hop depth chosen
        highConfidence: [],       // artist names from hop-0 (user's own)
        riskyBets: [],            // artist names from hop-2 (deep exploration)
        gaps: [],                 // coverage gaps that influenced hop-2
      },
      curator: {
        selectionThesis: '',      // the Curator's reflection on its choices
        discoveryRatio: 0,        // fraction of tracks from hop-1/2
        tradeoffs: '',            // what was sacrificed and why
      },
      narrator: {
        playlistTitle: '',        // the creative title
        sophisticationLevel: '',  // what explanation depth was used
      },
      concierge: {
        tasteEvolution: '',       // cross-session taste evolution narrative
        proactiveInsights: [],    // hints the Concierge can volunteer
      },
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
        if (!this.scoredPlaylist || this.scoredPlaylist.length === 0) throw new Error('PipelineContext: non-empty scoredPlaylist is required for narrator stage');
        return true;
      default:
        return true;
    }
  }
}
