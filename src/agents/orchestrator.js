/**
 * TasteGraph — Orchestrator
 * Coordinates the full pipeline: Profiler → Scout → Curator
 * The Curator now produces all playlist metadata (reasons, summary, title)
 * directly, eliminating the redundant Narrator stage.
 * The NarratorAgent is kept only for generateAgenticProfile() (Musical Vibe).
 * PIPELINE STAGE ORDER:
 * Pre-pipeline: _buildInitialContext() — single DataStore/UserModel read
 * Stage 1: Profiler        — taste dimensions, Elo rankings, coverage gaps
 * Stage 1.5: CulturalScout — web research, events, cultural context (non-blocking)
 * Stage 2: Scout           — candidate pool assembly (reads cultural intel)
 * Stage 3: Curator         — playlist selection (reads cultural context)
 * Stage 4: Narrator        — background enrichment (non-blocking, optional)
 * Post-pipeline: ReflectionAgent — updates long-term UserModel Tier1
 */
import { PipelineContext } from './pipeline-context.js';
import { ProfilerAgent } from './profiler-agent.js';
import { CulturalScout } from './cultural-scout.js';
import { ScoutAgent } from './scout-agent.js';
import { CuratorAgent } from './curator-agent.js';
import { NarratorAgent } from './narrator-agent.js';
import { ReflectionAgent } from './reflection-agent.js';
import { UserModel } from './user-model.js';
import { DataStore } from '../data/data-store.js';
import { buildTasteBrief } from './taste-brief.js';


/**
 * Convert a raw session intent into a readable playlist title.
 * Capitalizes the first letter and trims cleanly at a word boundary
 * (never mid-word) up to 100 chars, avoiding the "...from artis" problem.
 */
function _titleFromIntent(intent) {
  if (!intent) return null;
  const s = intent.trim();
  if (s.length <= 100) return s.charAt(0).toUpperCase() + s.slice(1);
  // Trim to last word boundary before 100 chars
  const truncated = s.slice(0, 100);
  const lastSpace = truncated.lastIndexOf(' ');
  const clean = lastSpace > 60 ? truncated.slice(0, lastSpace) : truncated;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export class Orchestrator {
  constructor(statusCallback = null, thoughtCallback = null) {
    this.statusCallback = statusCallback;
    this.thoughtCallback = thoughtCallback; // New callback for granular thoughts
    this.profiler       = new ProfilerAgent();
    this.culturalScout  = new CulturalScout();
    this.scout          = new ScoutAgent();
    this.curator        = new CuratorAgent();
    this.narrator       = new NarratorAgent();
    this.reflection     = new ReflectionAgent();
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

    // --- Pre-pipeline: Load ALL shared state once (single source of truth) ---
    // Agents read from context.* — never call DataStore/UserModel directly during a run.
    this._buildInitialContext(context);

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

    // Build the shared UserModel (Tier 1) from profiler output, then refresh context
    // so the profiler's computed values (musicDimensions, etc.) are available downstream.
    try {
      UserModel.buildFromProfiler(context.tasteState);
      UserModel.initSession(sessionIntent);
      // Refresh tier1 in context now that profiler has updated it
      context.tier1 = UserModel.loadTier1();
    } catch (e) {
      console.warn('Orchestrator: UserModel build failed, continuing without:', e.message);
    }

    // Session signals were pre-loaded in _buildInitialContext() but re-read here
    // to pick up any signals written by the Session DJ during this session.
    context.sessionSignals = DataStore.getSessionSignals();

    // --- Sprint 3.1: Build the centralized Taste DNA Brief ---
    // One structured snapshot consumed by Curator, Concierge, and Narrator.
    try {
      context.tasteBrief = buildTasteBrief(context);
    } catch (e) {
      console.warn('Orchestrator: TasteBrief failed, continuing without:', e.message);
      context.tasteBrief = null;
    }

    // --- Stage 1.5: CulturalScout — non-blocking web intelligence ---
    // Runs AFTER profiler (needs taste data) and BEFORE Scout (feeds discoveries into pool).
    // If it fails, pipeline continues with empty culturalIntelligence (graceful degradation).
    this._reportStatus('cultural');
    try {
      await this.culturalScout.research(context, this._reportThought.bind(this));
    } catch (culturalErr) {
      console.warn('Orchestrator: CulturalScout failed (non-blocking):', culturalErr.message);
      // Ensure fields exist even on failure
      context.blackboard.culturalIntelligence = context.blackboard.culturalIntelligence || null;
      context.currentEvents = context.currentEvents || [];
    }

    // --- Stage 2: Scout — reads coverageGaps + sessionSignals + culturalIntelligence ---
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

    // --- Sprint 3.4: Persist recentPlaylistArtists for anti-repetition ---
    // Write every artist in this playlist to the rolling 7-day window.
    try {
      const existingRecent = DataStore.load('recent_playlist_artists') || [];
      const now = Date.now();
      const newEntries = [...new Set(
        (context.scoredPlaylist || []).map(c => (c.artistName || '').toLowerCase()).filter(Boolean)
      )].map(artist => ({ artist, date: now }));
      // Merge and deduplicate (keep latest date per artist)
      const mergedMap = new Map();
      for (const entry of [...existingRecent, ...newEntries]) {
        const existing = mergedMap.get(entry.artist);
        if (!existing || entry.date > existing.date) {
          mergedMap.set(entry.artist, entry);
        }
      }
      // Prune entries older than 7 days
      const cutoff = now - 7 * 24 * 60 * 60 * 1000;
      const pruned = [...mergedMap.values()].filter(e => e.date > cutoff);
      DataStore.save('recent_playlist_artists', pruned);
    } catch (e) {
      console.warn('Orchestrator: Anti-repetition persistence failed:', e.message);
    }

    // --- Stage 4: Build explanations directly from Curator output ---
    // The Curator already produces per-track reasons, playlistName, playlistSummary,
    // and curatorReflection — no need for a separate Narrator LLM call.
    this._reportStatus('narrator');

    if (!context.scoredPlaylist || context.scoredPlaylist.length === 0) {
      this._reportThought('Pipeline: No tracks to explain — curator returned an empty playlist.');
      context.explanations = {
        playlistTitle: 'No Results',
        playlistSummary: 'The curator could not find tracks matching your request. Try broadening your description.',
        trackExplanations: new Map(),
      };
    } else {
      // Build explanations from Curator's per-track reasons
      const trackMap = new Map();
      for (const c of context.scoredPlaylist) {
        trackMap.set(c.track.id, c.dominantFactor || `Selected for the "${context.sessionIntent}" session.`);
      }
      context.explanations = {
        // Prefer the Curator's generated name; fall back to intent text before the generic string
        playlistTitle: context.scoredPlaylist.playlistName
          || context.playlistName
          || (context.sessionIntent ? _titleFromIntent(context.sessionIntent) : null)
          || 'Your Playlist',
        playlistSummary: context.scoredPlaylist.playlistSummary
          || context.curatorReflection
          || `A custom mix of ${context.scoredPlaylist.length} tracks based on your taste graph.`,
        trackExplanations: trackMap,
      };
    }

    this._reportStatus('narrator', true); // Done
    this._lastContext = context;

    // --- Stage 4.5: Narrator Background Enrichment (Sprint 3.3) ---
    // Enriches the 3-5 most interesting discovery tracks with deep music-history context.
    // Runs as fire-and-forget — doesn't block the UI.
    setTimeout(() => {
      // 1. Background enrichment for discovery tracks
      const discoveryTracks = (context.scoredPlaylist || [])
        .filter(c => (c.hopDistance || 0) >= 1 || ['web_discovery', 'graph_hop', 'cultural_discovery'].includes(c.source))
        .slice(0, 5);

      if (discoveryTracks.length > 0) {
        this.narrator.enrichDiscoveryTracks(discoveryTracks, context).then(enriched => {
          if (enriched && context.explanations?.trackExplanations) {
            for (const [trackId, enrichedReason] of Object.entries(enriched)) {
              context.explanations.trackExplanations.set(trackId, enrichedReason);
            }
            this._reportThought(`Narrator: Enriched ${Object.keys(enriched).length} discovery tracks with music-history context`);
          }
        }).catch(err => {
          console.warn('Orchestrator: Narrator enrichment failed (non-blocking):', err.message);
        });
      }

      // 2. Pre-warm the agentic profile (existing behavior)
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

    // Build explanations from Curator output (no Narrator call)
    this._reportStatus('narrator');
    const trackMap = new Map();
    for (const c of this._lastContext.scoredPlaylist) {
      trackMap.set(c.track.id, c.dominantFactor || 'Re-ranked based on updated preferences.');
    }
    this._lastContext.explanations = {
      playlistTitle: this._lastContext.scoredPlaylist.playlistName || this._lastContext.explanations?.playlistTitle || 'Curated Mix',
      playlistSummary: this._lastContext.scoredPlaylist.playlistSummary || this._lastContext.curatorReflection || '',
      trackExplanations: trackMap,
    };

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
  /**
   * Pre-load all shared context before the pipeline begins.
   * This is the SINGLE place that reads DataStore and UserModel.
   * Every agent then reads from context.* during the run.
   */
  _buildInitialContext(context) {
    try { context.tier1 = UserModel.loadTier1(); } catch (e) { context.tier1 = null; }
    try { context.tier2 = UserModel.getEpisodicMemory(); } catch (e) { context.tier2 = { sessions: [] }; }
    try { context.driftTrends = UserModel.getDriftTrends(); } catch (e) { context.driftTrends = {}; }
    try {
      context.explicitPreferences = DataStore.getExplicitPreferences();
      context.agentMemories = context.explicitPreferences.agent_memories || [];
    } catch (e) { context.explicitPreferences = {}; context.agentMemories = []; }
    try {
      context.narrativeAnchors = context.tier1?.narrativeAnchors || [];
    } catch (e) { context.narrativeAnchors = []; }
    // sessionSignals are written by SessionDJ — load them here for consistency
    // (they will be re-read post-profiler to catch any live session updates)
    try { context.sessionSignals = DataStore.getSessionSignals(); } catch (e) { context.sessionSignals = {}; }
    // Track artists recently recommended to power the anti-repetition engine
    try {
      const raw = DataStore.load('recent_playlist_artists') || [];
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7-day TTL
      context.recentPlaylistArtists = raw
        .filter(r => r.date > cutoff)
        .map(r => r.artist.toLowerCase());
    } catch (e) { context.recentPlaylistArtists = []; }

    // Playlist history: compact summary of recently curated playlists
    // Used by the Curator to avoid repeating the same thematic direction.
    try {
      const library = DataStore.getPlaylistLibrary().slice(0, 6);
      context.playlistHistory = library.map(p => {
        // Extract dominant artists from the scored playlist (top 3 by frequency)
        const artistFreq = {};
        for (const c of (p.context?.scoredPlaylist || [])) {
          const name = c.artistName || '';
          if (name) artistFreq[name] = (artistFreq[name] || 0) + 1;
        }
        const topArtists = Object.entries(artistFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([name]) => name);
        return {
          title: p.title || p.intent || 'Untitled',
          intent: p.intent || '',
          topArtists,
        };
      });
    } catch (e) { context.playlistHistory = []; }
  }

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
