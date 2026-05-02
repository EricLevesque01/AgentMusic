/**
 * TasteGraph — Shared User Model
 * The SINGLE SOURCE OF TRUTH about the user across all agents.
 *
 * Three-tier architecture:
 *   Tier 1: Durable Identity   — slow-moving, high-confidence, persisted permanently
 *   Tier 2: Medium-Horizon     — behavioral evidence + episodic session history
 *   Tier 3: Live Session State  — ephemeral, dies with the session
 *
 * Each agent receives a TAILORED SLICE of this model via the build*Context() methods.
 */

import { DataStore } from '../data/data-store.js';
import {
  computeMusicDimensions,
  computeGenreDistribution,
  computeDecayWeightedGenres,
  detectTasteDrift,
  computeMainstreaminess,
  computeSpecialistIndex,
  computeDiversityScore,
} from '../data/music-dimensions.js';

const STORAGE_KEY = 'user_model';
const EVIDENCE_KEY = 'behavioral_evidence';
const EPISODIC_KEY = 'episodic_memory';
const MAX_EVENTS_PER_TYPE = 500;

// ═══════════════════════════════════════════════════════════════
// Default schema shapes
// ═══════════════════════════════════════════════════════════════

function defaultTier1() {
  return {
    tasteProfile: {
      musicDimensions: { mellow: 0, unpretentious: 0, sophisticated: 0, intense: 0, contemporary: 0, _confidence: 0 },
      genreDistribution: { _confidence: 0 },
      temporalLayers: { identity: [], evolution: [], mood: [] },
      anchorArtists: [],
      topGenres: [],
    },
    attributeProfile: {
      preferredQualities: {
        intensity: null, complexity: null, melancholy: null,
        rhythmicity: null, acousticness: null, instrumentalness: null,
        _confidence: 0,
      },
    },
    discoveryProfile: {
      mainstreaminess: null, specialistIndex: null, diversityScore: null,
      explorationRate: null, noveltyTolerance: null, longTailAppetite: null,
      adjacentSceneOpenness: null, _confidence: 0,
    },
    sophistication: {
      level: 'unknown',
      indicators: { genreBreadth: null, eraSpan: null, subgenreDepth: null, comparisonDecisiveness: null },
      _confidence: 0,
    },
    functionalProfile: {
      primaryFunctions: {
        emotionRegulation: null, arousalModulation: null, focusAid: null,
        identityExpression: null, socialBonding: null, transcendence: null,
        companionship: null, nostalgia: null,
      },
      _confidence: 0,
    },
    identityAndValues: {
      tasteArchetype: null,
      values: { authenticity: null, openness: null, rebellion: null, sophistication: null, nostalgia: null, belonging: null },
      _confidence: 0,
    },
    narrativeAnchors: [],
  };
}

function defaultBehavioralEvidence() {
  return {
    fullListens: [], partialListens: [], skips: [], rapidSkips: [],
    saves: [], eloWins: [], eloLosses: [],
    boosts: [], dampens: [], blocks: [], chatPreferences: [],
  };
}

function defaultEpisodicMemory() {
  return { sessions: [] };
}

function defaultDriftTrends() {
  return { genreMomentum: [], genreDecline: [], discoveryTrajectory: null, lastUpdated: null };
}

// ═══════════════════════════════════════════════════════════════
// Live session state (ephemeral, in-memory only)
// ═══════════════════════════════════════════════════════════════

let _sessionState = null;

// ═══════════════════════════════════════════════════════════════
// UserModel class — static methods for all operations
// ═══════════════════════════════════════════════════════════════

export class UserModel {

  // -----------------------------------------------------------
  // Tier 1: Build from Profiler output
  // -----------------------------------------------------------

  /**
   * Build/update Tier 1 from the Profiler's tasteState output.
   * Called once per pipeline run, after profiling completes.
   */
  static buildFromProfiler(tasteState) {
    const model = UserModel.loadTier1();
    const eloRatings = tasteState.eloRatings || {};
    const artists = tasteState.artists || [];

    // --- Temporal layers ---
    if (tasteState.temporalLayers) {
      model.tasteProfile.temporalLayers = tasteState.temporalLayers;
    }

    // --- Genre distribution (proportional) ---
    const allRatedArtists = Object.values(eloRatings)
      .filter(a => a.name && a.name !== 'undefined');
    const genreDist = computeGenreDistribution(
      allRatedArtists.map(a => ({ genres: a.genres || [], macroGenres: a.macroGenres || [], id: null })),
    );
    const compCount = allRatedArtists.reduce((s, a) => s + (a.comparison_count || 0), 0);
    genreDist._confidence = Math.min(0.95, compCount / 100); // 100 comparisons = max confidence
    genreDist._lastEvidence = Date.now();
    model.tasteProfile.genreDistribution = genreDist;

    // --- MUSIC dimensions (static — from genre distribution) ---
    const musicDims = computeMusicDimensions(genreDist);
    musicDims._confidence = genreDist._confidence;
    musicDims._lastEvidence = Date.now();
    model.tasteProfile.musicDimensions = musicDims;

    // --- MUSIC dimensions (decay-weighted — responds to taste drift) ---
    // Pull behavioral evidence and compute a time-decayed genre distribution
    // so recent listening patterns dominate the MUSIC profile update.
    // Formula: w(t) = e^(-λ × Δt / T_year), λ=0.7 per research.
    try {
      const evidence = UserModel.loadEvidence();
      const allBehaviorEvents = [
        ...(evidence.eloWins    || []).map(e => ({ ...e, type: 'eloWin' })),
        ...(evidence.eloLosses  || []).map(e => ({ ...e, type: 'eloLoss' })),
        ...(evidence.fullListens|| []).map(e => ({ ...e, type: 'fullListen' })),
        ...(evidence.skips      || []).map(e => ({ ...e, type: 'skip' })),
        ...(evidence.rapidSkips || []).map(e => ({ ...e, type: 'rapidSkip' })),
        ...(evidence.saves      || []).map(e => ({ ...e, type: 'save' })),
      ];

      if (allBehaviorEvents.length >= 10) {
        const decayDist = computeDecayWeightedGenres(allBehaviorEvents);
        const decayDims = computeMusicDimensions(decayDist);
        decayDims._confidence = Math.min(0.9, allBehaviorEvents.length / 50);
        model.tasteProfile.musicDimensionsDecay = decayDims;

        // Detect drift signals and persist them
        const driftResult = detectTasteDrift(evidence, model);
        if (driftResult.driftDetected) {
          const currentTrends = UserModel.getDriftTrends();
          currentTrends.genreMomentum = Object.entries(driftResult.momentum).map(([g, v]) => ({ genre: g, delta: v }));
          currentTrends.genreDecline  = Object.entries(driftResult.decline).map(([g, v]) => ({ genre: g, delta: -v }));
          currentTrends.driftSignals  = driftResult.signals;
          currentTrends.discoveryTrajectory = Object.keys(driftResult.momentum).length > 0
            ? 'expanding'  // gaining new genres
            : (Object.keys(driftResult.decline).length > 0 ? 'narrowing' : 'stable');
          UserModel.setDriftTrends(currentTrends);
        }
      }
    } catch (err) {
      // Behavioral evidence not yet available — skip decay computation
      console.debug('UserModel: skipping decay-weighted MUSIC dims (insufficient evidence):', err.message);
    }

    // --- Discovery profile ---
    model.discoveryProfile.mainstreaminess = computeMainstreaminess(artists);
    model.discoveryProfile.specialistIndex = computeSpecialistIndex(eloRatings);
    model.discoveryProfile.diversityScore = computeDiversityScore(genreDist);
    model.discoveryProfile._confidence = Math.min(0.9, artists.length / 50);
    model.discoveryProfile._lastEvidence = Date.now();

    // --- Anchor artists (settled, high-confidence favorites) ---
    model.tasteProfile.anchorArtists = Object.entries(eloRatings)
      .filter(([, d]) => d.name && d.name !== 'undefined')
      .filter(([, d]) => {
        const comps = d.comparison_count || 0;
        const wins = d.wins || 0;
        const wr = comps > 0 ? wins / comps : 0;
        return comps >= 6 && (wr > 0.75 || wr < 0.25);
      })
      .sort((a, b) => b[1].rating - a[1].rating)
      .slice(0, 10)
      .map(([id, d]) => ({
        id, name: d.name, rating: d.rating,
        confidence: Math.min(0.95, 0.7 + (d.comparison_count - 6) * 0.03),
        genres: d.genres || [],
      }));

    // --- Top genres ---
    model.tasteProfile.topGenres = tasteState.topGenres || [];

    // --- Sophistication (basic computation) ---
    const allGenres = new Set();
    for (const a of allRatedArtists) {
      for (const g of (a.genres || [])) allGenres.add(g);
    }
    model.sophistication.indicators.genreBreadth = allGenres.size;
    if (allGenres.size >= 15) model.sophistication.level = 'expert';
    else if (allGenres.size >= 8) model.sophistication.level = 'engaged';
    else if (allGenres.size >= 3) model.sophistication.level = 'casual';
    else model.sophistication.level = 'novice';
    model.sophistication._confidence = Math.min(0.7, allRatedArtists.length / 30);
    model.sophistication._lastEvidence = Date.now();

    // --- Merge narrative anchors from agent_memories ---
    const prefs = DataStore.getExplicitPreferences();
    const existingTexts = new Set(model.narrativeAnchors.map(a => a.text));
    for (const mem of (prefs.agent_memories || [])) {
      if (!existingTexts.has(mem)) {
        model.narrativeAnchors.push({ text: mem, source: 'user_stated', confidence: 0.9, createdAt: Date.now() });
        existingTexts.add(mem);
      }
    }

    UserModel.saveTier1(model);
    return model;
  }

  // -----------------------------------------------------------
  // Tier 2: Behavioral Evidence
  // -----------------------------------------------------------

  /**
   * Log a behavioral event (separated by type per Research Report #2).
   * @param {'fullListen'|'partialListen'|'skip'|'rapidSkip'|'save'|'eloWin'|'eloLoss'|'boost'|'dampen'|'block'|'chatPreference'} type
   * @param {Object} data — event-specific data
   */
  static logBehavioralEvent(type, data) {
    const evidence = UserModel.loadEvidence();
    const typeMap = {
      fullListen: 'fullListens', partialListen: 'partialListens',
      skip: 'skips', rapidSkip: 'rapidSkips', save: 'saves',
      eloWin: 'eloWins', eloLoss: 'eloLosses',
      boost: 'boosts', dampen: 'dampens', block: 'blocks',
      chatPreference: 'chatPreferences',
    };
    const key = typeMap[type];
    if (!key || !evidence[key]) return;

    evidence[key].push({ ...data, ts: Date.now() });

    // Enforce rolling window
    if (evidence[key].length > MAX_EVENTS_PER_TYPE) {
      evidence[key] = evidence[key].slice(-MAX_EVENTS_PER_TYPE);
    }

    UserModel.saveEvidence(evidence);
  }

  static getBehavioralEvidence() {
    return UserModel.loadEvidence();
  }

  // -----------------------------------------------------------
  // Tier 2: Episodic Memory
  // -----------------------------------------------------------

  static getEpisodicMemory() {
    return DataStore.load(EPISODIC_KEY) || defaultEpisodicMemory();
  }

  static addEpisodicSummary(session) {
    const mem = UserModel.getEpisodicMemory();
    mem.sessions.unshift(session);
    // Keep last 20 sessions
    if (mem.sessions.length > 20) mem.sessions = mem.sessions.slice(0, 20);
    DataStore.save(EPISODIC_KEY, mem);
  }

  static getDriftTrends() {
    return DataStore.load('drift_trends') || defaultDriftTrends();
  }

  static setDriftTrends(trends) {
    DataStore.save('drift_trends', { ...trends, lastUpdated: Date.now() });
  }

  // -----------------------------------------------------------
  // Tier 3: Live Session State
  // -----------------------------------------------------------

  static initSession(intent) {
    const hour = new Date().getHours();
    let timeOfDay = 'afternoon';
    if (hour < 6) timeOfDay = 'late_night';
    else if (hour < 12) timeOfDay = 'morning';
    else if (hour < 18) timeOfDay = 'afternoon';
    else if (hour < 22) timeOfDay = 'evening';
    else timeOfDay = 'late_night';

    _sessionState = {
      intent: intent || null,
      motivation: null,
      context: {
        timeOfDay,
        dayOfWeek: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()],
        inferredActivity: null,
      },
      realTimeSignals: {
        consecutiveSkips: 0, skipStreak: [], loveStreak: [],
        energyTrajectory: 'stable', currentMoodShift: null,
      },
      explicitControls: {
        sessionBoosts: [], sessionBlocks: [], moodOverride: null, familiarityBias: null,
      },
    };
    return _sessionState;
  }

  static getSessionState() {
    return _sessionState;
  }

  static updateSessionSignals(updates) {
    if (!_sessionState) return;
    Object.assign(_sessionState.realTimeSignals, updates);
  }

  static addSessionControl(type, value) {
    if (!_sessionState) return;
    if (type === 'boost') _sessionState.explicitControls.sessionBoosts.push(value);
    if (type === 'block') _sessionState.explicitControls.sessionBlocks.push(value);
    if (type === 'mood') _sessionState.explicitControls.moodOverride = value;
    if (type === 'familiarity') _sessionState.explicitControls.familiarityBias = value;
  }

  // -----------------------------------------------------------
  // Narrative Anchors
  // -----------------------------------------------------------

  static addNarrativeAnchor(text, source = 'agent_inferred') {
    const model = UserModel.loadTier1();
    const exists = model.narrativeAnchors.some(a => a.text === text);
    if (!exists) {
      model.narrativeAnchors.push({
        text, source,
        confidence: source === 'user_stated' ? 0.9 : 0.3,
        createdAt: Date.now(),
      });
      // Keep latest 20
      if (model.narrativeAnchors.length > 20) {
        model.narrativeAnchors = model.narrativeAnchors.slice(-20);
      }
      UserModel.saveTier1(model);
    }
  }

  // -----------------------------------------------------------
  // Per-Agent Context Builders
  // -----------------------------------------------------------

  /**
   * Build the context string for the Scout agent.
   * Includes: Tier 1 taste profile + discovery budget + Tier 3 session state.
   */
  static buildScoutContext() {
    const m = UserModel.loadTier1();
    const s = _sessionState;
    const prefs = DataStore.getExplicitPreferences();
    const anchors = m.narrativeAnchors.slice(0, 5).map(a => `- "${a.text}"`).join('\n');
    const anchorArtists = m.tasteProfile.anchorArtists.slice(0, 5)
      .map(a => `${a.name} (Elo: ${a.rating})`).join(', ');

    const genreDist = Object.entries(m.tasteProfile.genreDistribution)
      .filter(([k]) => !k.startsWith('_'))
      .sort((a, b) => b[1] - a[1])
      .map(([g, w]) => `${g}: ${Math.round(w * 100)}%`)
      .join(', ');

    const dims = m.tasteProfile.musicDimensions;
    const topDims = Object.entries(dims)
      .filter(([k]) => !k.startsWith('_'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d, v]) => `${d}: ${v.toFixed(2)}`)
      .join(', ');

    return `TASTE PROFILE:
- MUSIC dimensions: ${topDims}
- Genre targets: ${genreDist || 'Not yet calibrated'}
- Anchor artists: ${anchorArtists || 'None settled yet'}
- Exploration style: ${m.discoveryProfile.mainstreaminess !== null
      ? (m.discoveryProfile.mainstreaminess < 0.4 ? 'specialist' : m.discoveryProfile.mainstreaminess > 0.7 ? 'mainstream' : 'moderate')
      : 'unknown'} (mainstreaminess: ${m.discoveryProfile.mainstreaminess ?? 'N/A'})

DISCOVERY BUDGET:
- Specialist index: ${m.discoveryProfile.specialistIndex ?? 'N/A'}
- Diversity score: ${m.discoveryProfile.diversityScore ?? 'N/A'}

${s ? `SESSION STATE:
- Intent: "${s.intent || 'general'}"
- Motivation: ${s.motivation || 'not classified'}
- Time: ${s.context.timeOfDay}
- Explicit controls: ${[...s.explicitControls.sessionBoosts.map(b => `boost ${b}`), ...s.explicitControls.sessionBlocks.map(b => `block ${b}`)].join(', ') || 'none'}` : ''}

${prefs.agent_memories?.length ? `PERMANENT USER NOTES:\n${prefs.agent_memories.map(m => `- ${m}`).join('\n')}` : ''}

${anchors ? `NARRATIVE ANCHORS:\n${anchors}` : ''}`.trim();
  }

  /**
   * Build the context string for the Curator agent.
   * Includes: calibration constraint + attribute targets + session signals.
   */
  static buildCuratorContext() {
    const m = UserModel.loadTier1();
    const s = _sessionState;
    const prefs = DataStore.getExplicitPreferences();
    const signals = DataStore.getSessionSignals();

    // Calibration constraint
    const genreEntries = Object.entries(m.tasteProfile.genreDistribution)
      .filter(([k]) => !k.startsWith('_'))
      .sort((a, b) => b[1] - a[1]);

    let calibration = '';
    if (genreEntries.length > 0 && m.tasteProfile.genreDistribution._confidence >= 0.3) {
      calibration = `CALIBRATION CONSTRAINT (confidence: ${m.tasteProfile.genreDistribution._confidence.toFixed(2)}):
Your playlist SHOULD approximately reflect the user's taste distribution:
${genreEntries.map(([g, w]) => `- ${g}: ~${Math.round(w * 20)} tracks (${Math.round(w * 100)}%)`).join('\n')}
Deviation of more than ±3 tracks from any category requires explicit justification in your reflection.`;
    }

    // Narrative anchors
    const anchors = m.narrativeAnchors.slice(0, 5).map(a => `- "${a.text}"`).join('\n');

    // Session signals
    let signalText = '';
    if (signals.skippedGenres?.length || signals.lovedGenres?.length) {
      signalText = `SESSION FEEDBACK:
${signals.skippedGenres?.length ? `- User has been skipping: ${signals.skippedGenres.join(', ')}` : ''}
${signals.lovedGenres?.length ? `- User has been loving: ${signals.lovedGenres.join(', ')}` : ''}`;
    }

    return `${calibration}

${s ? `SESSION: "${s.intent || 'general'}" | Time: ${s.context.timeOfDay} | Motivation: ${s.motivation || 'unclassified'}` : ''}
${s?.explicitControls.sessionBlocks?.length ? `BLOCKED THIS SESSION: ${s.explicitControls.sessionBlocks.join(', ')}` : ''}

${signalText}

${prefs.agent_memories?.length ? `PERMANENT USER NOTES:\n${prefs.agent_memories.map(m => `- ${m}`).join('\n')}` : ''}

${anchors ? `NARRATIVE ANCHORS:\n${anchors}` : ''}`.trim();
  }

  /**
   * Build the context string for the Narrator agent.
   * Includes: identity, sophistication, values, curator thesis.
   */
  static buildNarratorContext() {
    const m = UserModel.loadTier1();
    const anchors = m.narrativeAnchors.slice(0, 5).map(a => `- "${a.text}"`).join('\n');
    const anchorArtists = m.tasteProfile.anchorArtists.slice(0, 3)
      .map(a => a.name).join(', ');

    return `USER IDENTITY:
- Taste archetype: ${m.identityAndValues.tasteArchetype || 'Still calibrating'}
- Sophistication: ${m.sophistication.level}
  → ${m.sophistication.level === 'expert' ? 'Use technical language, reference production techniques and music theory' :
      m.sophistication.level === 'engaged' ? 'Use specific but accessible language — reference eras and scenes, not theory' :
      'Use emotional, accessible language — focus on feelings and vibes, not technicalities'}
- Anchor artists: ${anchorArtists || 'None settled yet'}

${anchors ? `NARRATIVE ANCHORS:\n${anchors}` : ''}`.trim();
  }

  /**
   * Build the context string for the Concierge agent.
   * Includes: dossier + episodic memory + session state + permanent memories.
   */
  static buildConciergeContext() {
    const m = UserModel.loadTier1();
    const episodic = UserModel.getEpisodicMemory();
    const prefs = DataStore.getExplicitPreferences();
    const anchors = m.narrativeAnchors.slice(0, 5).map(a => `- "${a.text}"`).join('\n');

    const dims = m.tasteProfile.musicDimensions;
    const topDims = Object.entries(dims)
      .filter(([k]) => !k.startsWith('_'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([d]) => d)
      .join('/');

    // Episodic memory — last 3 sessions
    let episodicText = '';
    if (episodic.sessions.length > 0) {
      episodicText = `EPISODIC MEMORY (last ${Math.min(3, episodic.sessions.length)} sessions):
${episodic.sessions.slice(0, 3).map(s =>
  `- ${s.date || 'Unknown date'}: "${s.intent || 'general'}" — ${s.summary || 'No summary'}`
).join('\n')}`;
    }

    return `USER DOSSIER:
- Archetype: ${m.identityAndValues.tasteArchetype || 'Still calibrating'}
- Core sound: ${topDims || 'Unknown'}, ${m.discoveryProfile.mainstreaminess !== null
      ? (m.discoveryProfile.mainstreaminess < 0.4 ? 'low-mainstream' : 'mainstream-leaning')
      : 'unknown mainstream level'}
- Known dislikes: ${prefs.disliked_artists?.join(', ') || prefs.disliked_genres?.join(', ') || 'None specified'}
- Exploration style: ${m.discoveryProfile.specialistIndex !== null
      ? (m.discoveryProfile.specialistIndex > 0.6 ? 'specialist — goes deep, not wide' : 'generalist — broad and curious')
      : 'unknown'}

${episodicText}

${anchors ? `NARRATIVE ANCHORS:\n${anchors}` : ''}

${prefs.agent_memories?.length ? `PERMANENT MEMORIES:\n${prefs.agent_memories.map(m => `- ${m}`).join('\n')}` : ''}`.trim();
  }

  /**
   * Build a universal dossier string (short summary for any agent).
   */
  static buildDossier() {
    const m = UserModel.loadTier1();
    const episodic = UserModel.getEpisodicMemory();
    const prefs = DataStore.getExplicitPreferences();

    return `Archetype: ${m.identityAndValues.tasteArchetype || 'Calibrating'}
Anchor Artists: ${m.tasteProfile.anchorArtists.slice(0, 3).map(a => a.name).join(', ') || 'None yet'}
Sophistication: ${m.sophistication.level}
Mainstreaminess: ${m.discoveryProfile.mainstreaminess ?? 'N/A'}
Last Session: ${episodic.sessions[0]?.summary || 'First session'}
Permanent Notes: ${prefs.agent_memories?.join('; ') || 'None'}`;
  }

  /**
   * Synthesize a natural language narrative about how the user's taste has evolved.
   * Draws from drift trends, episodic memory, and narrative anchors.
   *
   * This is the "friend who remembers" feature — the kind of insight a music-loving
   * friend would share: "You started with indie rock but you've been going deeper
   * into post-punk and shoegaze over the last few sessions."
   *
   * @returns {{ narrative: string, patterns: object }} — human-readable summary + raw data
   */
  static buildTasteEvolutionNarrative() {
    const trends = UserModel.getDriftTrends();
    const episodic = UserModel.getEpisodicMemory();
    const model = UserModel.loadTier1();
    const sessions = episodic.sessions || [];

    const narrative = [];
    const patterns = {
      risingGenres: [],
      fadingGenres: [],
      consistentFavorites: [],
      discoveryTrajectory: trends.discoveryTrajectory || 'stable',
      sessionCount: sessions.length,
    };

    // 1. Genre trajectory
    const rising = (trends.genreMomentum || [])
      .filter(g => (g.sessions >= 2) || (g.delta > 0))
      .slice(0, 3);
    const fading = (trends.genreDecline || [])
      .filter(g => (g.sessions >= 2) || (g.delta < 0))
      .slice(0, 3);

    patterns.risingGenres = rising.map(g => g.genre);
    patterns.fadingGenres = fading.map(g => g.genre);

    if (rising.length > 0 && fading.length > 0) {
      narrative.push(
        `Your taste has been shifting: you're gravitating toward ${rising.map(g => g.genre).join(', ')} while moving away from ${fading.map(g => g.genre).join(', ')}.`
      );
    } else if (rising.length > 0) {
      narrative.push(
        `You've been increasingly drawn to ${rising.map(g => g.genre).join(', ')} over recent sessions.`
      );
    } else if (fading.length > 0) {
      narrative.push(
        `You seem to be cooling off on ${fading.map(g => g.genre).join(', ')}.`
      );
    }

    // 2. Consistent favorites across sessions
    const artistFreq = {};
    for (const s of sessions.slice(0, 5)) {
      for (const a of (s.lovedArtists || [])) {
        artistFreq[a] = (artistFreq[a] || 0) + 1;
      }
    }
    const consistentFavs = Object.entries(artistFreq)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    patterns.consistentFavorites = consistentFavs;

    if (consistentFavs.length > 0) {
      narrative.push(
        `${consistentFavs.join(', ')} ${consistentFavs.length === 1 ? 'keeps' : 'keep'} showing up as favorites across sessions — ${consistentFavs.length === 1 ? "they're" : "they're all"} clearly core to your identity right now.`
      );
    }

    // 3. Discovery trajectory
    if (trends.discoveryTrajectory === 'improving') {
      narrative.push(`Your discovery hit rate is improving — you're skipping less, which means the recommendations are getting more dialed in.`);
    } else if (trends.discoveryTrajectory === 'declining') {
      narrative.push(`Your skip rate has been going up recently — you might be in a mood for something more familiar, or the exploration direction needs adjusting.`);
    }

    // 4. Narrative anchors (durable taste insights from past sessions)
    const recentAnchors = (model.narrativeAnchors || [])
      .filter(a => a.source === 'agent_inferred')
      .slice(-3);
    if (recentAnchors.length > 0) {
      narrative.push(
        `Patterns I've picked up: ${recentAnchors.map(a => a.text).join('. ')}.`
      );
    }

    // 5. Session count context
    if (sessions.length >= 5) {
      narrative.push(`This is based on ${sessions.length} sessions of listening data.`);
    } else if (sessions.length >= 2) {
      narrative.push(`I'm still learning — this is based on ${sessions.length} sessions so far.`);
    }

    return {
      narrative: narrative.length > 0
        ? narrative.join(' ')
        : 'Not enough listening data yet to detect evolution patterns. Keep playing the Taste Game and generating playlists!',
      patterns,
    };
  }

  // -----------------------------------------------------------
  // Confidence Decay
  // -----------------------------------------------------------

  static applyConfidenceDecay(model) {
    const now = Date.now();
    const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
    const DECAY_RATE = 0.05; // per month

    const decayField = (obj) => {
      if (obj && typeof obj._confidence === 'number' && typeof obj._lastEvidence === 'number') {
        const monthsElapsed = (now - obj._lastEvidence) / MONTH_MS;
        if (monthsElapsed > 1) {
          obj._confidence = Math.max(0, obj._confidence - DECAY_RATE * Math.floor(monthsElapsed));
        }
      }
    };

    decayField(model.tasteProfile.musicDimensions);
    decayField(model.tasteProfile.genreDistribution);
    decayField(model.discoveryProfile);
    decayField(model.sophistication);
    decayField(model.functionalProfile);
    decayField(model.identityAndValues);

    return model;
  }

  // -----------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------

  static loadTier1() {
    return DataStore.load(STORAGE_KEY) || defaultTier1();
  }

  static saveTier1(model) {
    DataStore.save(STORAGE_KEY, model);
  }

  static loadEvidence() {
    return DataStore.load(EVIDENCE_KEY) || defaultBehavioralEvidence();
  }

  static saveEvidence(evidence) {
    DataStore.save(EVIDENCE_KEY, evidence);
  }

  /**
   * Reset all user model data (for testing or account reset).
   */
  static reset() {
    DataStore.clear(STORAGE_KEY);
    DataStore.clear(EVIDENCE_KEY);
    DataStore.clear(EPISODIC_KEY);
    DataStore.clear('drift_trends');
    _sessionState = null;
  }
}
