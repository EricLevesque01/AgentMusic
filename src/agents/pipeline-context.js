/**
 * TasteGraph — Pipeline Context
 * Shared data object that flows through the agent pipeline.
 * All agents read from and write to this context.
 */

export class PipelineContext {
  constructor({ userId, sliders, sessionId }) {
    // --- Inputs (set by Orchestrator) ---
    this.userId = userId;
    this.sessionId = sessionId;
    this.sliders = {
      discovery:   sliders?.discovery   ?? 0.5,
      popularity:  sliders?.popularity  ?? 0.5,
      focus:       sliders?.focus       ?? 0.5,
      energy:      sliders?.energy      ?? 0.5,
      novelty:     sliders?.novelty     ?? 0.5,
    };

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
  static create(userId, sliders = {}, sessionId = null) {
    return new PipelineContext({
      userId,
      sliders,
      sessionId: sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  /**
   * Derive scoring weights from slider positions.
   * Weights always sum to 1.0.
   */
  deriveWeights() {
    const d = this.sliders.discovery; // 0 = familiar, 1 = adventurous

    // Base weights shift with Discovery slider
    let wElo     = 0.35 * (1 - d) + 0.10 * d;  // high discovery → less Elo weight
    let wSession = 0.25;                          // session match stays stable
    let wGraph   = 0.10 * (1 - d) + 0.40 * d;   // high discovery → more graph weight
    let wAudio   = 0.30 * (1 - d) + 0.25 * d;   // slight decrease with discovery

    // Normalize to sum to 1.0
    const total = wElo + wSession + wGraph + wAudio;
    return {
      W_elo:     wElo / total,
      W_session: wSession / total,
      W_graph:   wGraph / total,
      W_audio:   wAudio / total,
    };
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
