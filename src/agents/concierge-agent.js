/**
 * TasteGraph — Concierge Agent
 * "The Natural Language Interface" — Parses user chat into structured pipeline actions.
 *
 * Perceives:  User message, current PipelineContext (tasteState, sliders, playlist)
 * Decides:    Send to Gemini with function declarations → get structured actions
 * Acts:       Routes parsed actions to Orchestrator, returns conversational reply
 */
import { callWithTools } from '../data/gemini-api.js';

// --- Gemini Function Declarations ---
const TOOL_DECLARATIONS = [
  {
    name: 'adjust_sliders',
    description: 'Adjust one or more of the 5 session intent sliders based on the user\'s request. Values are 0.0 to 1.0.',
    parameters: {
      type: 'object',
      properties: {
        discovery:  { type: 'number', description: '0=Familiar, 1=Adventurous' },
        popularity: { type: 'number', description: '0=Mainstream, 1=Underground' },
        energy:     { type: 'number', description: '0=Low energy, 1=High energy' },
        focus:      { type: 'number', description: '0=Cohesive, 1=Varied' },
        novelty:    { type: 'number', description: '0=Known tracks, 1=Unknown tracks' },
      },
    },
  },
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
  }

  /**
   * Process a user message. Returns { reply, actions }.
   * Actions are dispatched by the Orchestrator.
   */
  async chat(userMessage, context) {
    const systemPrompt = this._buildSystemPrompt(context);

    // Add user message to history
    this.chatHistory.push({ role: 'user', parts: [{ text: userMessage }] });

    // Keep last 10 messages to stay within token limits
    const recentHistory = this.chatHistory.slice(-10);

    let functionCalls = [];
    let textReply     = '';

    try {
      const result = await callWithTools(systemPrompt, recentHistory, TOOL_DECLARATIONS);
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

    return `You are Agent Music's Concierge — a conversational music companion who knows the user's taste deeply.

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

${trackCount > 0 ? `CURRENT PLAYLIST: ${trackCount} tracks loaded.` : 'No playlist currently loaded.'}

Your job is to understand what the user wants and call the appropriate function(s).
If a user asks about their taste, top artists, or vibe — use the leaderboard data above to answer directly. You know their music taste like a close friend.
If a user asks for artist recommendations, use suggest_artists to inject them into the game pool.
Always be brief, warm, and music-focused. Reply in 1-3 sentences max.`;
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
      case 'adjust_preference':return { type: 'adjust_preference', target: args.target, action: args.action };
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
      case 'adjust_preference':return `Done. I've noted your feedback on ${first.target}.`;
      default:                 return `Done!`;
    }
  }
}
