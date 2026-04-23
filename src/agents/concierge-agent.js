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
];

// Keyword fallback for when Gemini is unavailable
const KEYWORD_MAP = [
  { pattern: /more (jazz|rock|pop|indie|hip.?hop|metal|electronic|classical|blues|country)/i, action: (m) => ({ type: 'boost_genre', genre: m[1] }) },
  { pattern: /less (jazz|rock|pop|indie|hip.?hop|metal|electronic|classical|blues|country)/i, action: (m) => ({ type: 'penalize_genre', genre: m[1] }) },
  { pattern: /no (jazz|rock|pop|indie|hip.?hop|metal|electronic|classical|blues|country)/i,   action: (m) => ({ type: 'penalize_genre', genre: m[1] }) },
  // adjust_sliders: args are flat slider keys (matches Gemini's function schema)
  { pattern: /more (chill|calm|mellow|relaxed|slow)/i,  action: () => ({ type: 'adjust_sliders', energy: 0.2 }) },
  { pattern: /more (energy|hype|upbeat|fast|intense)/i, action: () => ({ type: 'adjust_sliders', energy: 0.85 }) },
  { pattern: /adventur|discover|explore|new/i,          action: () => ({ type: 'adjust_sliders', discovery: 0.85 }) },
  { pattern: /familiar|comfort|safe|known/i,            action: () => ({ type: 'adjust_sliders', discovery: 0.15 }) },
  { pattern: /underground|obscure|niche/i,              action: () => ({ type: 'adjust_sliders', popularity: 0.85 }) },
  { pattern: /mainstream|popular|hits/i,                action: () => ({ type: 'adjust_sliders', popularity: 0.15 }) },
  { pattern: /why.*(track|song|this)/i,                 action: () => ({ type: 'explain_playlist' }) },
  { pattern: /regenerate|restart|new playlist/i,        action: () => ({ type: 'regenerate' }) },
  { pattern: /suggest.*(?:like)?\s(.*)/i,               action: (m) => ({ type: 'suggest_artists', artists: [m[1].split(' ')[0]] }) },
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
    const sliders  = context?.sliders || {};
    const trackCount = context?.scoredPlaylist?.length || 0;

    return `You are TasteGraph's Concierge, the natural language interface for a multi-agent music ecosystem.

YOUR KNOWLEDGE OF THE SYSTEM:
You are part of a team of 3 agents. 
1. You (The Concierge) handle chat, parsing user intent into tools.
2. The Narrator Agent writes the psychological "Sonic Dossier" on the Profile tab using Wikipedia RAG.
3. The Curator Agent builds the actual playlists using MusicBrainz/Last.fm tools.
If the user asks how the app works, explain this architecture.

USER'S CURRENT TASTE PROFILE: 
- Core Identity (S-Tier): ${sTier}
- Active Obsessions (A-Tier): ${aTier}
- Actively Disliked (F-Tier): ${fTier}
- Top Genres: ${genres}

SESSION STATE:
Sliders: Discovery=${sliders.discovery?.toFixed(2)}, Energy=${sliders.energy?.toFixed(2)}, Popularity=${sliders.popularity?.toFixed(2)}.
Playlist Length: ${trackCount} tracks.

Your job is to understand what the user wants and call the appropriate function(s).
If a user asks for artist recommendations (e.g., "suggest some bands like The Midnight"), you MUST use the suggest_artists function to inject them into the game pool.
If a function is not needed (e.g. general chat or explaining the app), reply conversationally in 1-2 sentences. Always be brief, warm, and music-focused.`;
  }

  _parseAction(functionCall) {
    const { name, args } = functionCall;
    switch (name) {
      case 'adjust_sliders':   return { type: 'adjust_sliders', sliders: args };
      case 'boost_genre':      return { type: 'boost_genre',    genre:   args.genre };
      case 'penalize_genre':   return { type: 'penalize_genre', genre:   args.genre };
      case 'explain_track':    return { type: 'explain_track',  trackName: args.trackName };
      case 'explain_playlist': return { type: 'explain_playlist' };
      case 'suggest_artists':  return { type: 'suggest_artists', artists: args.artists };
      case 'regenerate':       return { type: 'regenerate' };
      case 'remember_fact':    return { type: 'remember_fact', fact: args.fact };
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
      case 'adjust_sliders':   return `Adjusting your vibe settings now — regenerating playlist!`;
      case 'explain_playlist': return `Let me explain your playlist...`;
      case 'suggest_artists':  return `Suggesting new artists for you to evaluate!`;
      case 'regenerate':       return `Regenerating your playlist from scratch!`;
      default:                 return `On it!`;
    }
  }

  _buildActionReply(actions, originalMsg) {
    if (actions.length === 0) return "Got it!";
    const first = actions[0];
    switch (first.type) {
      case 'adjust_sliders':   return `Adjusting your session sliders and refreshing the playlist! 🎛️`;
      case 'boost_genre':      return `Boosting **${first.genre}** — refreshing your playlist! 🎵`;
      case 'penalize_genre':   return `Reducing **${first.genre}** from the mix and re-ranking! ✂️`;
      case 'explain_playlist': return `Here's a summary of your playlist...`;
      case 'regenerate':       return `Regenerating your playlist! ✨`;
      case 'remember_fact':    return `Noted! I'll remember that permanently. 🧠`;
      default:                 return `Done!`;
    }
  }
}
