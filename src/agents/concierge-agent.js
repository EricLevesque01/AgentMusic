/**
 * Agent Music — Concierge Agent
 * "The Natural Language Interface" — Parses user chat into structured pipeline actions.
 *
 * Perceives:  User message, current PipelineContext (tasteState, sliders, playlist),
 *             episodic memory (past sessions), drift trends (taste evolution),
 *             narrative anchors (durable taste insights)
 * Decides:    Send to Gemini with function declarations → get structured actions
 * Acts:       Routes parsed actions to Orchestrator, returns conversational reply
 *
 * Agentic Memory: The Concierge remembers past sessions and can proactively surface
 * insights like "You've been gravitating toward post-punk — want me to go deeper?"
 * This is what makes it feel like a friend, not a search engine.
 */
import { callWithTools } from '../data/gemini-api.js';
import { buildSoulPrefix } from './soul.js';
import { UserModel } from './user-model.js';
import { DataStore } from '../data/data-store.js';
import { formatTasteBriefForPrompt } from './taste-brief.js';

// --- Gemini Function Declarations ---
const TOOL_DECLARATIONS = [
  {
    name: 'boost_genre',
    description: 'Prioritize a specific genre in the playlist.',
    parameters: {
      type: 'object',
      properties: {
        genre: { type: 'string', description: 'The genre to boost (e.g., "jazz", "indie rock")' },
      },
      required: ['genre'],
    },
  },
  {
    name: 'penalize_genre',
    description: 'Reduce or remove a specific genre from the playlist.',
    parameters: {
      type: 'object',
      properties: {
        genre: { type: 'string', description: 'The genre to penalize (e.g., "pop", "country")' },
      },
      required: ['genre'],
    },
  },
  {
    name: 'suggest_artists',
    description: 'Suggest a list of specific artists based on the user\'s mood or request. Used to inject new discoveries into the Taste Game pool.',
    parameters: {
      type: 'object',
      properties: {
        artists: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'A list of 2-4 artist names matching the request.' 
        },
      },
      required: ['artists'],
    },
  },
  {
    name: 'explain_track',
    description: 'Explain why a specific track was recommended.',
    parameters: {
      type: 'object',
      properties: {
        trackName: { type: 'string', description: 'Name of the track to explain' },
      },
      required: ['trackName'],
    },
  },
  {
    name: 'explain_playlist',
    description: 'Explain the overall playlist curation rationale.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'regenerate',
    description: 'Regenerate the entire playlist from scratch.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'remember_fact',
    description: 'Store a permanent fact about the user\'s taste, dislikes, or current life context (e.g., "User dislikes autotune", "User is studying for finals").',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'The factual observation to remember permanently.' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'create_playlist',
    description: 'Create a brand new playlist based on a specific theme or mood requested by the user.',
    parameters: {
      type: 'object',
      properties: {
        theme: { type: 'string', description: 'The theme or mood of the playlist (e.g., "studying", "rainy day indie", "heavy workout")' },
      },
      required: ['theme'],
    },
  },
  {
    name: 'summarize_taste',
    description: 'Provide a detailed, narrative summary of the user\'s current musical vibe and taste identity.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'taste_evolution',
    description: 'Describe how the user\'s taste has evolved over recent sessions. Use when they ask "how has my taste changed?", "what\'s trending in my listening?", or "am I in a rut?"',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'adjust_preference',
    description: 'Explicitly boost or penalize a specific artist based on user feedback, or store a permanent memory about their taste.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'The artist name or genre being adjusted.' },
        action: { type: 'string', description: '"boost", "banish", or "remember"' },
      },
      required: ['target', 'action'],
    },
  },
  {
    name: 'classify_motivation',
    description: 'Tag the session intent with a functional listening purpose. Call this when the user describes what they want music FOR (e.g., studying, working out, unwinding, road trip).',
    parameters: {
      type: 'object',
      properties: {
        motivation: {
          type: 'string',
          description: 'One of: emotion_regulation, arousal_modulation, focus, identity_expression, social_bonding, transcendence, companionship, nostalgia'
        },
        confidence: {
          type: 'number',
          description: 'How confident you are in this classification, 0.0-1.0'
        },
      },
      required: ['motivation'],
    },
  },
  {
    name: 'search_artist_info',
    description: 'Search for current news, recent releases, critical reception, or tour dates about a specific artist. Use when the user asks about an artist\'s recent activity.',
    parameters: {
      type: 'object',
      properties: {
        artistName: { type: 'string', description: 'Name of the artist to research' },
      },
      required: ['artistName'],
    },
  },
  {
    name: 'find_events',
    description: 'Find upcoming concerts, tours, or festivals relevant to the user\'s taste or a specific artist. Use when the user asks about live events.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Event search query, e.g. "Fontaines DC tour dates" or "indie festivals 2026"' },
      },
      required: ['query'],
    },
  },
];

// Keyword fallback for when Gemini is unavailable
const KEYWORD_MAP = [
  { pattern: /more (jazz|rock|pop|indie|hip.?hop|metal|electronic|classical|blues|country)/i, action: (m) => ({ type: 'boost_genre', genre: m[1] }) },
  { pattern: /less (jazz|rock|pop|indie|hip.?hop|metal|electronic|classical|blues|country)/i, action: (m) => ({ type: 'penalize_genre', genre: m[1] }) },
  { pattern: /no (jazz|rock|pop|indie|hip.?hop|metal|electronic|classical|blues|country)/i,   action: (m) => ({ type: 'penalize_genre', genre: m[1] }) },
  { pattern: /why.*(track|song|this)/i,                 action: () => ({ type: 'explain_playlist' }) },
  { pattern: /regenerate|restart|new playlist/i,        action: () => ({ type: 'regenerate' }) },
  { pattern: /suggest.*(?:like)?\s(.*)/i,               action: (m) => ({ type: 'suggest_artists', artists: [m[1].split(' ')[0]] }) },
  { pattern: /(vibe|mood|chill|hype)/i,                 action: (m) => ({ type: 'create_playlist', theme: "a " + m[1] + " mix" }) },
];

export class ConciergeAgent {
  constructor() {
    this.chatHistory = []; // { role, parts: [{text}] }
    // Sprint 4.4: Session summary — persists across history trims
    // This captures the essence of early messages so context is never lost
    // even when raw chat history is trimmed for token limits.
    this.sessionSummary = '';
  }

  /**
   * Sprint 4.1: Generate a proactive opening message.
   * Called when the user opens the chat — the Concierge volunteers an observation
   * instead of waiting for the user to speak.
   * @param {PipelineContext} context - The pipeline context with taste data
   * @returns {string} A warm, context-aware opening message
   */
  generateOpeningMessage(context) {
    const insights = [];

    // 1. Rising genre from drift trends
    try {
      const trends = UserModel.getDriftTrends();
      const rising = (trends.genreMomentum || [])
        .filter(g => (g.sessions >= 2) || (g.delta > 0.1))
        .slice(0, 1);
      if (rising.length > 0) {
        insights.push({
          priority: 3,
          text: `You've been deep in ${rising[0].genre} lately — this playlist leans into that.`,
        });
      }
    } catch (e) { /* no drift data yet */ }

    // 2. Events relevant to their taste (from CulturalScout)
    try {
      const events = context?.currentEvents || [];
      if (events.length > 0) {
        const ev = events[0];
        insights.push({
          priority: 4, // Highest — timely and novel
          text: `${ev.artist || 'One of your favorites'} has ${ev.type === 'tour' ? 'tour dates coming up' : ev.type === 'release' ? 'a new release' : 'something happening'}. ${ev.description || ''}`.trim(),
        });
      }
    } catch (e) { /* no events */ }

    // 3. Current playlist observation
    try {
      const playlist = context?.scoredPlaylist || [];
      if (playlist.length > 0) {
        const discoveryCount = playlist.filter(c => (c.hopDistance || 0) >= 1).length;
        const discoveryPct = Math.round((discoveryCount / playlist.length) * 100);
        if (discoveryPct > 40) {
          insights.push({
            priority: 2,
            text: `This playlist is ${discoveryPct}% discoveries — there are some artists in here I think you'll love.`,
          });
        }
      }
    } catch (e) { /* no playlist yet */ }

    // 4. Recent session skip rate warning
    try {
      const episodic = UserModel.getEpisodicMemory();
      const recentSessions = (episodic.sessions || []).slice(0, 2);
      const avgSkipRate = recentSessions.length > 0
        ? recentSessions.reduce((s, sess) => s + (sess.stats?.skipRate || 0), 0) / recentSessions.length
        : 0;
      if (avgSkipRate > 35 && recentSessions.length >= 2) {
        insights.push({
          priority: 1,
          text: `Your skip rate's been high recently — I went lighter on the discovery this time.`,
        });
      }
    } catch (e) { /* no session data */ }

    // 5. Cultural context from web research
    try {
      const intel = context?.blackboard?.culturalIntelligence;
      if (intel?.criticalConsensus?.length > 0) {
        const consensus = intel.criticalConsensus[0];
        insights.push({
          priority: 2,
          text: `Critics have been talking about ${consensus.artist} — ${consensus.insight}`,
        });
      }
    } catch (e) { /* no cultural intel */ }

    // Pick the highest-priority insight
    if (insights.length === 0) {
      return null; // No proactive message — let the user start the conversation
    }

    insights.sort((a, b) => b.priority - a.priority);
    return insights[0].text;
  }

  /**
   * Process a user message. Returns { reply, actions }.
   * Actions are dispatched by the Orchestrator.
   */
  async chat(userMessage, context) {
    const systemPrompt = this._buildSystemPrompt(context);

    // Add user message to history
    this.chatHistory.push({ role: 'user', parts: [{ text: userMessage }] });

    // Sprint 4.4: Build session summary from early messages for continuity
    // The summary captures key context from messages that may be trimmed
    if (this.chatHistory.length === 2) {
      // After first exchange, seed the summary with the opening context
      this.sessionSummary = `User opened with: "${userMessage}"`;
    } else if (this.chatHistory.length > 2 && this.chatHistory.length % 4 === 0) {
      // Every 4 messages, update the summary
      this._updateSessionSummary(userMessage);
    }

    // Keep last 6 raw messages (Sprint 4.4: fewer raw messages, but with persistent summary)
    const recentHistory = this.chatHistory.slice(-6);

    let functionCalls = [];
    let textReply     = '';

    try {
      const result = await callWithTools(systemPrompt, recentHistory, TOOL_DECLARATIONS, 'fast', false, 'concierge');
      functionCalls = result.functionCalls;
      textReply     = result.textReply;
    } catch (err) {
      console.warn('Concierge: Gemini unavailable, using fallback parser.', err.message);
      const fallback = this._keywordFallback(userMessage);
      if (fallback) {
        // Build a proper functionCall shape so _parseAction works correctly
        const args = { ...fallback };
        delete args.type;
        functionCalls = [{ name: fallback.type, args }];
        textReply = this._fallbackReply(fallback, userMessage);
      } else {
        textReply = "I'm not sure how to help with that right now. Try asking me to adjust energy, boost a genre, or explain the playlist.";
      }
    }

    // Parse function calls into action objects
    const actions = functionCalls.map(fc => this._parseAction(fc));

    // Build reply text
    if (!textReply) {
      textReply = this._buildActionReply(actions, userMessage);
    }

    // Add model reply to history
    this.chatHistory.push({ role: 'model', parts: [{ text: textReply }] });

    return { reply: textReply, actions };
  }

  /**
   * Handle an explain_track action by looking it up in context.
   */
  explainTrack(trackName, context) {
    if (!context?.scoredPlaylist || !context?.explanations) {
      return "I don't have a playlist loaded yet — generate one first!";
    }

    const match = context.scoredPlaylist.find(c =>
      c.track.name.toLowerCase().includes(trackName.toLowerCase())
    );
    if (!match) return `I couldn't find "${trackName}" in the current playlist.`;

    const explanation = context.explanations.trackExplanations.get(match.track.id);
    return explanation
      ? `**${match.track.name}** by ${match.artistName}: ${explanation}`
      : `I recommended "${match.track.name}" based on your taste profile, but I don't have a detailed explanation handy.`;
  }

  clearHistory() {
    this.chatHistory = [];
    this.sessionSummary = '';
  }

  /**
   * Build a taste evolution narrative from drift trends and episodic memory.
   * This is the key data that makes the Concierge feel like a friend who
   * remembers past sessions.
   */
  buildTasteEvolutionSummary() {
    const trends = UserModel.getDriftTrends();
    const episodic = UserModel.getEpisodicMemory();
    const parts = [];

    // Genre momentum — what they're gravitating toward
    if (trends.genreMomentum?.length > 0) {
      const rising = trends.genreMomentum
        .filter(g => g.sessions >= 2 || g.delta > 0)
        .slice(0, 3)
        .map(g => g.genre);
      if (rising.length > 0) {
        parts.push(`Gravitating toward: ${rising.join(', ')}`);
      }
    }

    // Genre decline — what they're moving away from
    if (trends.genreDecline?.length > 0) {
      const fading = trends.genreDecline
        .filter(g => g.sessions >= 2 || g.delta < 0)
        .slice(0, 3)
        .map(g => g.genre);
      if (fading.length > 0) {
        parts.push(`Moving away from: ${fading.join(', ')}`);
      }
    }

    // Discovery trajectory
    if (trends.discoveryTrajectory && trends.discoveryTrajectory !== 'stable') {
      parts.push(`Discovery trajectory: ${trends.discoveryTrajectory}`);
    }

    // Drift signals (from behavior-weighted analysis)
    if (trends.driftSignals?.length > 0) {
      parts.push(`Drift signals: ${trends.driftSignals.slice(0, 3).join('; ')}`);
    }

    // Recent session highlights
    const recentSessions = (episodic.sessions || []).slice(0, 3);
    if (recentSessions.length > 0) {
      const sessionSummaries = recentSessions.map(s => {
        const loved = s.lovedArtists?.slice(0, 2).join(', ') || 'various';
        return `"${s.intent || 'general'}" — loved ${loved} (${s.stats?.skipRate || 0}% skip rate)`;
      });
      parts.push(`Recent sessions:\n${sessionSummaries.map(s => `  • ${s}`).join('\n')}`);
    }

    return parts.length > 0
      ? parts.join('\n')
      : 'Not enough sessions yet to detect taste evolution patterns.';
  }

  // --- Private ---

  _buildSystemPrompt(context) {
    const genres   = context?.tasteState?.topGenres?.slice(0, 5).join(', ') || 'unknown';
    const sTier    = (context?.tasteState?.tasteTiers?.coreIdentity || []).join(', ') || 'None';
    const aTier    = (context?.tasteState?.tasteTiers?.activeObsessions || []).join(', ') || 'None';
    const fTier    = (context?.tasteState?.tasteTiers?.activelyDismissed || []).join(', ') || 'None';
    const trackCount = context?.scoredPlaylist?.length || 0;
    
    // Live leaderboard from Elo ratings
    const topArtists = context?.tasteState?.topRankedArtists || [];
    const leaderboard = topArtists.length > 0
      ? topArtists.map((a, i) => `${i + 1}. ${a.name} (Elo: ${a.rating}, Genres: ${(a.genres || []).slice(0, 2).join(', ') || 'uncategorized'})`).join('\n')
      : 'No rated artists yet.';
    const totalRated = context?.tasteState?.totalRatedArtists || 0;

    // UserModel enrichment
    let userModelContext = '';
    try {
      userModelContext = UserModel.buildConciergeContext();
    } catch (e) { /* Not yet populated */ }

    // Taste evolution context — cross-session pattern awareness
    let evolutionContext = '';
    try {
      const evo = this.buildTasteEvolutionSummary();
      if (evo && !evo.includes('Not enough sessions')) {
        evolutionContext = `\nTASTE EVOLUTION (cross-session patterns you've observed):\n${evo}\n\nYou can proactively mention these patterns when relevant — e.g., "I've noticed you've been gravitating toward post-punk lately — want me to go deeper?" This is what makes you feel like a friend, not a search engine.`;
      }
    } catch (e) { /* Drift trends not yet available */ }

    // Proactive insights — things worth volunteering
    let proactiveHints = '';
    try {
      const hints = this._buildProactiveHints();
      if (hints) proactiveHints = hints;
    } catch (e) { /* No proactive hints available */ }

    // --- Cultural intelligence (Sprint 2) ---
    // Surface events and cultural context from the CulturalScout's research.
    let culturalStr = '';
    try {
      const intel = context?.blackboard?.culturalIntelligence;
      const events = context?.currentEvents || [];

      if (intel?.culturalContext) {
        culturalStr += `\nCURRENT MUSIC WORLD (from live research):\n${intel.culturalContext}`;
      }

      if (events.length > 0) {
        const eventList = events.slice(0, 4)
          .map(e => `- ${e.type?.toUpperCase()}: ${e.description}${e.date ? ' (' + e.date + ')' : ''}`)
          .join('\n');
        culturalStr += `\n\nUPCOMING EVENTS RELEVANT TO THIS USER:\n${eventList}\nYou can proactively mention these: "By the way, ${events[0]?.artist || 'one of your favorites'} has something coming up..."\n`;
      }
    } catch (e) { /* Cultural intel not yet available */ }

    // --- Narrative anchors and memories from context (pre-loaded) ---
    let memoriesStr = '';
    try {
      const anchors = (context?.narrativeAnchors || []).slice(0, 4).map(a => `- "${a.text}"`).join('\n');
      const agentMems = (context?.agentMemories || []).slice(0, 6).map(m => `- ${m}`).join('\n');
      if (anchors || agentMems) {
        memoriesStr = '\nWHAT YOU KNOW ABOUT THIS USER (from past conversations):';
        if (agentMems) memoriesStr += `\n${agentMems}`;
        if (anchors) memoriesStr += `\nNarrative anchors:\n${anchors}`;
      }
    } catch (e) { /* memories not populated yet */ }

    return `${buildSoulPrefix()}

You are acting as the Concierge — the conversational interface of Agent Music.

YOUR KNOWLEDGE OF THE SYSTEM:
You are part of a team of specialized agents:
1. You (The Concierge) handle chat, parsing user intent into actions.
2. The Narrator Agent writes the psychological "Sonic Dossier" on the Profile tab.
3. The Curator Agent builds playlists using MusicBrainz/Last.fm/Spotify tools.
4. The Taste Game calibrates preferences through A/B comparisons.
If the user asks how the app works, explain this architecture.

USER'S LIVE TASTE LEADERBOARD (${totalRated} artists rated):
${leaderboard}

TASTE TIERS: 
- Core Identity (S-Tier): ${sTier}
- Active Obsessions (A-Tier): ${aTier}
- Actively Disliked (F-Tier): ${fTier}
- Top Genres: ${genres}

${userModelContext}
${evolutionContext}
${proactiveHints}
${culturalStr}
${memoriesStr}

${trackCount > 0 ? `CURRENT PLAYLIST: ${trackCount} tracks loaded.` : 'No playlist currently loaded.'}

${this.sessionSummary ? `CONVERSATION CONTEXT (what the user has told you so far):\n${this.sessionSummary}` : ''}

${(() => {
  // Sprint 3.1: Inject the centralized taste brief for richer context
  const briefStr = formatTasteBriefForPrompt(context?.tasteBrief);
  return briefStr ? `\n${briefStr}` : '';
})()}

Your job is to understand what the user wants and call the appropriate function(s).
When the user describes WHAT THEY WANT MUSIC FOR (studying, working out, road trip, etc.), ALSO call classify_motivation to tag the session purpose.
If a user asks about their taste, top artists, or vibe — use the leaderboard data above to answer directly. You know their music taste like a close friend.
If a user asks for artist recommendations, use suggest_artists to inject them into the game pool.
If a user asks about events or an artist's recent news, call search_artist_info or find_events.
If you notice a taste evolution pattern that's relevant to the conversation, mention it naturally — you REMEMBER their past sessions.
Always be brief, warm, and music-focused. Reply in 1-3 sentences max.`;
  }

  /**
   * Build proactive hints — things the Concierge can volunteer.
   * These are based on cross-session patterns that suggest actionable follow-ups.
   */
  _buildProactiveHints() {
    const trends = UserModel.getDriftTrends();
    const episodic = UserModel.getEpisodicMemory();
    const hints = [];

    // High skip rates in recent sessions → suggest different approach
    const recentSessions = (episodic.sessions || []).slice(0, 3);
    const avgSkipRate = recentSessions.length > 0
      ? recentSessions.reduce((s, sess) => s + (sess.stats?.skipRate || 0), 0) / recentSessions.length
      : 0;

    if (avgSkipRate > 40 && recentSessions.length >= 2) {
      hints.push('INSIGHT: Recent sessions have high skip rates — the user may want more familiar artists or a different genre direction. Consider asking what they\'re in the mood for.');
    }

    // Discovery trajectory declining → getting fatigued
    if (trends.discoveryTrajectory === 'declining') {
      hints.push('INSIGHT: Discovery trajectory is declining — the user may be experiencing discovery fatigue. Lean toward familiar comfort picks unless they explicitly ask for exploration.');
    }

    // Genre momentum suggests a new obsession
    const risingGenres = (trends.genreMomentum || [])
      .filter(g => (g.sessions >= 3) || (g.delta > 0.1));
    if (risingGenres.length > 0) {
      hints.push(`INSIGHT: "${risingGenres[0].genre}" is becoming a new obsession — it's appeared in ${risingGenres[0].sessions || 'several'} recent sessions. You could offer to build a deep-dive playlist around it.`);
    }

    // Repeated loved artists across sessions
    const artistFreq = {};
    for (const s of recentSessions) {
      for (const a of (s.lovedArtists || [])) {
        artistFreq[a] = (artistFreq[a] || 0) + 1;
      }
    }
    const repeatFavorites = Object.entries(artistFreq)
      .filter(([, count]) => count >= 2)
      .map(([name]) => name);
    if (repeatFavorites.length > 0) {
      hints.push(`INSIGHT: ${repeatFavorites.join(', ')} keep showing up as favorites — they're clearly core to the user's identity right now.`);
    }

    return hints.length > 0
      ? `\nPROACTIVE INSIGHTS (use naturally when relevant):\n${hints.map(h => `- ${h}`).join('\n')}`
      : '';
  }

  _parseAction(functionCall) {
    const { name, args } = functionCall;
    switch (name) {
      case 'boost_genre':      return { type: 'boost_genre',    genre:   args.genre };
      case 'penalize_genre':   return { type: 'penalize_genre', genre:   args.genre };
      case 'explain_track':    return { type: 'explain_track',  trackName: args.trackName };
      case 'explain_playlist': return { type: 'explain_playlist' };
      case 'suggest_artists':  return { type: 'suggest_artists', artists: args.artists };
      case 'regenerate':       return { type: 'regenerate' };
      case 'remember_fact':    return { type: 'remember_fact', fact: args.fact };
      case 'create_playlist':  return { type: 'create_playlist', theme: args.theme };
      case 'summarize_taste':  return { type: 'summarize_taste' };
      case 'taste_evolution':  return { type: 'taste_evolution' };
      case 'adjust_preference':return { type: 'adjust_preference', target: args.target, action: args.action };
      case 'classify_motivation': return { type: 'classify_motivation', motivation: args.motivation, confidence: args.confidence || 0.5 };
      default:                 return { type: 'freeform_chat' };
    }
  }

  _keywordFallback(msg) {
    for (const { pattern, action } of KEYWORD_MAP) {
      const m = msg.match(pattern);
      if (m) return action(m);
    }
    return null;
  }

  _fallbackReply(action, originalMsg) {
    switch (action.type) {
      case 'boost_genre':      return `Got it — boosting ${action.genre} in your playlist! 🎵`;
      case 'penalize_genre':   return `Sure — reducing ${action.genre} from the mix.`;
      case 'explain_playlist': return `Let me explain your playlist...`;
      case 'suggest_artists':  return `Suggesting new artists for you to evaluate!`;
      case 'regenerate':       return `Regenerating your playlist from scratch!`;
      case 'create_playlist':  return `Building your "${action.theme}" playlist right now!`;
      case 'summarize_taste':  return `Let me analyze your musical vibe...`;
      default:                 return `On it!`;
    }
  }

  _buildActionReply(actions, originalMsg) {
    if (actions.length === 0) return "Got it!";
    const first = actions[0];
    switch (first.type) {
      case 'boost_genre':      return `Boosting **${first.genre}** — refreshing your playlist! 🎵`;
      case 'penalize_genre':   return `Reducing **${first.genre}** from the mix and re-ranking! ✂️`;
      case 'explain_playlist': return `Here's a summary of your playlist...`;
      case 'regenerate':       return `Regenerating your playlist! ✨`;
      case 'remember_fact':    return `Noted! I'll remember that permanently. 🧠`;
      case 'create_playlist':  return `On it! Compiling the perfect "${first.theme}" playlist for you now... 🎧`;
      case 'summarize_taste':  return `Let me pull up your Sonic Dossier...`;
      case 'taste_evolution':  return `Let me look at how your taste has been evolving...`;
      case 'adjust_preference':return `Done. I've noted your feedback on ${first.target}.`;
      default:                 return `Done!`;
    }
  }

  /**
   * Sprint 4.4: Update the session summary incrementally.
   * Captures key context from recent messages without replacing the entire summary.
   */
  _updateSessionSummary(latestMessage) {
    // Append key facts from recent messages to the summary
    const keyPatterns = [
      // Mood/activity context
      { pattern: /(?:i(?:'m| am))\s+(studying|working|driving|cooking|relaxing|running|meditating)/i, extract: (m) => `User is ${m[1]}` },
      // Genre preferences
      { pattern: /(?:more|less|no)\s+(\w+\s?\w*)/i, extract: (m) => `Wants ${m[0]}` },
      // Artist mentions
      { pattern: /(?:love|hate|like|dislike|obsessed with|can't stand)\s+(.+?)(?:\.|,|$)/i, extract: (m) => `${m[0].trim()}` },
    ];

    for (const { pattern, extract } of keyPatterns) {
      const match = latestMessage.match(pattern);
      if (match) {
        const fact = extract(match);
        if (!this.sessionSummary.includes(fact)) {
          this.sessionSummary += `\n- ${fact}`;
        }
        break;
      }
    }
  }
}
