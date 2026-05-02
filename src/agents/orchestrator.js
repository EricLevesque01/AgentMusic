/**
 * TasteGraph — Orchestrator
 * Coordinates the full pipeline: Profiler → Scout → Curator → Narrator
 * Also handles partial re-runs triggered by Session DJ and Concierge.
 */
import { PipelineContext } from './pipeline-context.js';
import { ProfilerAgent } from './profiler-agent.js';
import { ScoutAgent } from './scout-agent.js';
import { CuratorAgent } from './curator-agent.js';
import { NarratorAgent } from './narrator-agent.js';
import { ReflectionAgent } from './reflection-agent.js';
import { UserModel } from './user-model.js';
import { DataStore } from '../data/data-store.js';

export class Orchestrator {
  constructor(statusCallback = null, thoughtCallback = null) {
    this.statusCallback = statusCallback;
    this.thoughtCallback = thoughtCallback; // New callback for granular thoughts
    this.profiler    = new ProfilerAgent();
    this.scout       = new ScoutAgent();
    this.curator     = new CuratorAgent();
    this.narrator    = new NarratorAgent();
    this.reflection  = new ReflectionAgent();
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
    context.tasteState = await this.profiler.buildTasteState(this._reportThought.bind(this));

    // Populate inter-agent tasteProfile from profiler output
    this._populateTasteProfile(context);

    // Populate blackboard with profiler enrichments (Phase 5)
    if (context.blackboard) {
      context.blackboard.profiler.musicDimensions = context.tasteState.musicDimensions || null;
      context.blackboard.profiler.discoveryProfile = context.tasteState.discoveryProfile || null;
      context.blackboard.profiler.genreDistribution = context.tasteState.genreDistribution || null;
      context.blackboard.profiler.temporalLayers = context.tasteState.temporalLayers || null;
    }

    // Task 2.1: Call drift detection and populate blackboard + tasteProfile
    try {
      const driftPatterns = this.profiler.detectDriftPatterns(
        context.tasteState.eloRatings
          ? Object.values(context.tasteState.eloRatings)
              .filter(a => a.last_compared_at)
              .sort((a, b) => (b.last_compared_at || 0) - (a.last_compared_at || 0))
              .slice(0, 20)
              .map(a => ({
                winnerId: a.wins > a.losses ? a.name : null,
                loserId: a.losses > a.wins ? a.name : null,
                winnerGenres: a.genres || [],
                loserGenres: a.genres || [],
                winnerComps: a.comparison_count || 0,
                loserComps: a.comparison_count || 0,
              }))
          : []
      );
      if (driftPatterns.length > 0) {
        context.tasteProfile.driftSummary = driftPatterns.map(p => p.description).join('; ');
        if (context.blackboard) {
          context.blackboard.profiler.driftPatterns = driftPatterns;
        }
      }
    } catch (e) {
      console.warn('Orchestrator: Drift detection failed:', e.message);
    }

    // Build the shared UserModel (Tier 1) from profiler output
    try {
      UserModel.buildFromProfiler(context.tasteState);
      UserModel.initSession(sessionIntent);
    } catch (e) {
      console.warn('Orchestrator: UserModel build failed, continuing without:', e.message);
    }

    // Read session signals from DataStore (written by Session DJ)
    context.sessionSignals = DataStore.getSessionSignals();

    // --- Stage 2: Scout — reads coverageGaps + sessionSignals ---
    this._reportStatus('scout');
    context.validateForStage('scout');
    context.candidatePool = await this.scout.findCandidates(
      context.tasteState, context.sessionIntent, context, this._reportThought.bind(this)
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
    context.curatorReflection = context.scoredPlaylist.curatorReflection;
    context.playlistName = context.scoredPlaylist.playlistName || null;

    // Write curator thesis to blackboard (Phase 5)
    if (context.blackboard) {
      context.blackboard.curator.selectionThesis = context.curatorReflection || '';
      const hop1Plus = (context.scoredPlaylist || []).filter(t => (t.hopDistance || 0) >= 1).length;
      context.blackboard.curator.discoveryRatio = context.scoredPlaylist?.length
        ? Math.round((hop1Plus / context.scoredPlaylist.length) * 100) / 100
        : 0;
    }

    // --- Stage 4: Narrator — reads context for personalized copy ---
    this._reportStatus('narrator');

    // Guard: If curator produced an empty playlist, skip narration gracefully
    if (!context.scoredPlaylist || context.scoredPlaylist.length === 0) {
      this._reportThought('Narrator: No tracks to narrate — curator returned an empty playlist.');
      context.explanations = {
        playlistTitle: 'No Results',
        playlistSummary: 'The curator could not find tracks matching your request. Try broadening your description.',
        trackExplanations: new Map(),
      };
    } else {
      context.explanations = await this.narrator.generate(
        context.scoredPlaylist,
        context.tasteState,
        context.sessionIntent,
        context,
        this._reportThought.bind(this)
      );
    }

    this._reportStatus('narrator', true); // Done
    this._lastContext = context;

    // Pre-warm the agentic profile in background (fire-and-forget)
    // Add a 2s delay to prevent rate limiting (429s) right after the Narrator finishes
    setTimeout(() => {
      this.narrator.generateAgenticProfile(context.tasteState).then(profile => {
        if (profile) {
          try {
            DataStore.save('agentic_profile_cache', {
              html: profile,
              generatedAt: Date.now(),
              artistHash: (context.tasteState.topRankedArtists || []).slice(0, 5).map(a => a.name).join(','),
            });
          } catch (e) { /* DataStore may not be available */ }
        }
      }).catch(err => {
        console.warn('Orchestrator: Background profile generation failed, skipping cache.', err);
      });
    }, 2000);

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
    this._lastContext.curatorReflection = this._lastContext.scoredPlaylist.curatorReflection;

    this._reportStatus('narrator');
    this._lastContext.explanations = await this.narrator.generate(
      this._lastContext.scoredPlaylist,
      this._lastContext.tasteState,
      this._lastContext.sessionIntent,
      this._lastContext
    );

    this._reportStatus('narrator', true);
    return this._lastContext;
  }

  /**
   * Handle an action dispatched by the Concierge Agent.
   */
  async handleConciergeAction(action) {
    switch (action.type) {
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

      case 'suggest_artists':
        // Dispatch event to inject artists into the Taste Game pool
        if (typeof window !== 'undefined' && action.artists?.length) {
          window.dispatchEvent(new CustomEvent('tastegraph:inject-artists', { detail: action.artists }));
        }
        break;

      case 'summarize_taste': {
        // Generate and return the agentic taste profile
        const tasteState = this._lastContext?.tasteState;
        if (tasteState) {
          const result = await this.narrator.generateAgenticProfile(tasteState);
          return { ...(this._lastContext || {}), tasteSummary: result };
        }
        break;
      }

      case 'taste_evolution': {
        // Surface cross-session taste evolution insights
        // The Concierge agent synthesizes drift trends + episodic memory
        try {
          const { ConciergeAgent } = await import('./concierge-agent.js');
          const concierge = new ConciergeAgent();
          const summary = concierge.buildTasteEvolutionSummary();
          return { ...(this._lastContext || {}), tasteEvolution: summary };
        } catch (e) {
          console.warn('Orchestrator: Taste evolution summary failed:', e.message);
        }
        break;
      }

      case 'adjust_preference':
        // Explicitly update Elo ratings to boost or banish an artist
        if (action.action === 'banish') {
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

      case 'classify_motivation':
        // Tag the session with a functional listening purpose (Task 4.4)
        try {
          const session = UserModel.getSessionState();
          if (session) session.motivation = action.motivation;
        } catch (e) { /* UserModel not available */ }
        break;

      default:
        console.warn('Orchestrator: unknown Concierge action type', action.type);
    }
    return this._lastContext;
  }

  /**
   * End the current session and trigger the Reflection Agent.
   * Called when user navigates away or explicitly ends listening.
   * @param {Object} sessionDJData — { skipHistory, listenHistory, adjustments } from SessionDJ
   */
  async endSession(sessionDJData = {}) {
    if (!this._lastContext) return null;

    try {
      const result = await this.reflection.reflect(sessionDJData, this._lastContext);
      return result;
    } catch (e) {
      console.warn('Orchestrator: Reflection failed:', e.message);
      return null;
    }
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

    // Populate coverage gaps from under-explored genres
    context.coverageGaps = context.tasteProfile.underExploredGenres.map(genre => ({
      genre,
      comparisons: genreComps[genre] || 0,
      reason: `User has very few comparisons in ${genre}`,
    }));
  }
}
