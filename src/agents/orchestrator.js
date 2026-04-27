/**
 * TasteGraph — Orchestrator
 * Coordinates the full pipeline: Profiler → Scout → Curator → Narrator
 * Also handles partial re-runs triggered by Session DJ and Concierge.
 */
import { PipelineContext } from './pipeline-context.js';
import { ProfilerAgent } from './profiler-agent.js';
import { PlannerAgent } from './planner-agent.js';
import { ScoutAgent } from './scout-agent.js';
import { CuratorAgent } from './curator-agent.js';
import { NarratorAgent } from './narrator-agent.js';

export class Orchestrator {
  constructor(statusCallback = null, thoughtCallback = null) {
    this.statusCallback = statusCallback;
    this.thoughtCallback = thoughtCallback; // New callback for granular thoughts
    this.profiler  = new ProfilerAgent();
    this.planner   = new PlannerAgent();
    this.scout     = new ScoutAgent();
    this.curator   = new CuratorAgent();
    this.narrator  = new NarratorAgent();
    this._lastContext = null;
  }

  _reportStatus(stageId, isDone = false) {
    if (this.statusCallback) this.statusCallback(stageId, isDone);
  }

  _reportThought(thought) {
    if (this.thoughtCallback) this.thoughtCallback(thought);
  }

  /**
   * Run the full playlist generation pipeline.
   * @param {string} userId
   * @param {string} sessionIntent
   * @returns {PipelineContext}
   */
  async generatePlaylist(userId, sessionIntent) {
    const context = PipelineContext.create(userId, sessionIntent);

    // --- Stage 1: Profiler ---
    this._reportStatus('profiler');
    context.validateForStage('profiler');
    context.tasteState = await this.profiler.buildTasteState();

    // Populate inter-agent tasteProfile from profiler output
    this._populateTasteProfile(context);

    // --- Stage 1.5: Planner (ReWOO Strategy Generation) ---
    this._reportStatus('planner');
    const plan = await this.planner.createResearchPlan(
      context.tasteState, 
      context.sessionIntent, 
      this._reportThought.bind(this)
    );
    context.researchPlan = plan;

    // --- Stage 2: Scout (Parallel Worker Execution) ---
    this._reportStatus('scout');
    context.validateForStage('scout');
    context.candidatePool = await this.scout.executePlan(
      plan, context.tasteState, context
    );

    // --- Stage 3: Curator — reads full context for LLM prompt enrichment ---
    this._reportStatus('curator');
    context.validateForStage('curator');
    context.scoredPlaylist = await this.curator.rankAndSelect(
      context.tasteState,
      context.candidatePool,
      context.sessionIntent,
      context.sessionAdjustments,
      context,
      this._reportThought.bind(this)
    );

    // --- Stage 4: Narrator — reads context for personalized copy ---
    this._reportStatus('narrator');
    context.explanations = await this.narrator.generate(
      context.scoredPlaylist,
      context.tasteState,
      context.sessionIntent,
      context
    );

    this._reportStatus('narrator', true); // Done
    this._lastContext = context;
    return context;
  }

  /**
   * Partial re-run: skip Profiler + Scout, only re-run Curator + Narrator.
   * Used by Session DJ and Concierge for fast re-ranking.
   */
  async rerank(sessionAdjustments = {}) {
    if (!this._lastContext) throw new Error('No previous pipeline context to re-rank from.');

    this._lastContext.sessionAdjustments = {
      ...this._lastContext.sessionAdjustments,
      ...sessionAdjustments,
    };

    this._reportStatus('curator');
    this._lastContext.scoredPlaylist = await this.curator.rankAndSelect(
      this._lastContext.tasteState,
      this._lastContext.candidatePool,
      this._lastContext.sessionIntent,
      this._lastContext.sessionAdjustments,
      this._lastContext,
      this._reportThought.bind(this)
    );

    this._reportStatus('narrator');
    this._lastContext.explanations = await this.narrator.generate(
      this._lastContext.scoredPlaylist,
      this._lastContext.tasteState,
      this._lastContext.sessionIntent
    );

    this._reportStatus('narrator', true);
    return this._lastContext;
  }

  /**
   * Handle an action dispatched by the Concierge Agent.
   */
  async handleConciergeAction(action) {
    switch (action.type) {
      case 'adjust_sliders':
        // Legacy action, convert to intent override
        if (this._lastContext) {
          this._lastContext.sessionIntent = "User requested a slight vibe adjustment.";
          return this.rerank();
        }
        break;

      case 'boost_genre':
        return this.rerank({
          boostedGenres: [
            ...(this._lastContext?.sessionAdjustments?.boostedGenres || []),
            action.genre,
          ],
        });

      case 'penalize_genre':
        return this.rerank({
          penalizedGenres: [
            ...(this._lastContext?.sessionAdjustments?.penalizedGenres || []),
            action.genre,
          ],
        });

      case 'regenerate':
        if (this._lastContext) {
          return this.generatePlaylist(
            this._lastContext.userId,
            this._lastContext.sessionIntent
          );
        }
        break;

      case 'create_playlist':
        // Generate a new playlist using the explicit natural language theme
        return this.generatePlaylist(this._lastContext?.userId || 'default_user', action.theme);

      case 'adjust_preference':
        // Explicitly update Elo ratings to boost or banish an artist
        if (action.action === 'banish') {
          // Banish artist from the current game pool or ratings
          // We can dispatch an event or directly update DataStore
          const { DataStore } = await import('../data/data-store.js');
          const ratings = DataStore.getEloRatings();
          const target = action.target.toLowerCase();
          const key = Object.keys(ratings).find(k => ratings[k].name && ratings[k].name.toLowerCase().includes(target));
          if (key) {
             ratings[key].ignored = true; // Permanently banish
             ratings[key].rating = Math.max(0, ratings[key].rating - 500); // Massive penalty
             DataStore.setEloRatings(ratings);
          }
        } else if (action.action === 'boost') {
          const { DataStore } = await import('../data/data-store.js');
          const ratings = DataStore.getEloRatings();
          const target = action.target.toLowerCase();
          const key = Object.keys(ratings).find(k => ratings[k].name && ratings[k].name.toLowerCase().includes(target));
          if (key) {
             ratings[key].rating = Math.min(2000, ratings[key].rating + 200); // Big boost
             DataStore.setEloRatings(ratings);
          }
        }
        break;

      default:
        console.warn('Orchestrator: unknown Concierge action type', action.type);
    }
    return this._lastContext;
  }

  /**
   * Populate the inter-agent tasteProfile on the context object.
   * Runs after the Profiler, before Scout/Curator/Narrator.
   */
  _populateTasteProfile(context) {
    const eloRatings = context.tasteState?.eloRatings || {};
    const allRanked = Object.entries(eloRatings)
      .filter(([, d]) => d.name && d.name !== 'undefined')
      .sort((a, b) => b[1].rating - a[1].rating);

    // Anchored #1: settled artist at the top of the leaderboard
    if (allRanked.length > 0) {
      const [topId, topData] = allRanked[0];
      const comps = topData.comparison_count || 0;
      const wins = topData.wins || 0;
      const winRate = comps > 0 ? wins / comps : 0;
      if (comps >= 6 && (winRate > 0.75 || winRate < 0.25)) {
        context.tasteProfile.anchoredTopArtist = topData.name;
        context.settledAnchors.push(topId);
      }
    }

    // Collect ALL settled artist IDs
    for (const [id, data] of allRanked) {
      const comps = data.comparison_count || 0;
      const wins = data.wins || 0;
      const winRate = comps > 0 ? wins / comps : 0;
      if (comps >= 6 && (winRate > 0.75 || winRate < 0.25)) {
        if (!context.settledAnchors.includes(id)) context.settledAnchors.push(id);
      }
    }

    // Dominant genres: ranked by total Elo comparison weight
    const genreComps = {};
    for (const [, data] of allRanked) {
      for (const genre of (data.genres || [])) {
        genreComps[genre] = (genreComps[genre] || 0) + (data.comparison_count || 0);
      }
    }
    context.tasteProfile.dominantGenres = Object.entries(genreComps)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([g]) => g);

    // Under-explored: genres with fewest comparisons that still have artists
    context.tasteProfile.underExploredGenres = Object.entries(genreComps)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .map(([g]) => g);

    // Copy coverage gaps from DataStore if the TasteGame wrote them
    // (the game runs before playlist generation)
    try {
      const { DataStore } = context.tasteState?.eloRatings
        ? { DataStore: null } // Already have the data in-memory
        : {};
    } catch (e) { /* no-op */ }
  }
}
