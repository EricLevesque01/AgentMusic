import { callWithTools } from '../data/gemini-api.js';
import { MACRO_GENRES } from '../data/genre-taxonomy.js';

export class PlannerAgent {
  /**
   * Generates an execution plan based on the user's intent and taste state.
   */
  async createResearchPlan(tasteState, sessionIntent, onThought = null) {
    if (onThought) onThought("Planner: Analyzing session intent and taste profile...");
    
    // Fallback if no intent
    if (!sessionIntent || typeof sessionIntent !== 'string' || sessionIntent.trim() === '') {
      if (onThought) onThought("Planner: No intent provided. Defaulting to standard taste exploration.");
      return { 
        strategy: "Standard exploration based on historical favorites.", 
        tool_calls: [
          { tool: 'getTopArtists', args: {} },
          { tool: 'getRecommendations', args: { seed_genres: tasteState.topGenres.slice(0,2) } }
        ] 
      };
    }

    const topGenres = tasteState.topGenres || [];
    
    const prompt = `You are the Lead Music Discovery Planner for an intelligent ReWOO multi-agent pipeline.
Your job is to analyze the user's intent and output a strict JSON research plan to dictate exactly how the Scout Agent will fetch music.

USER INTENT: "${sessionIntent}"
BACKGROUND TASTE: Top Genres: ${topGenres.slice(0, 5).join(', ')}

AVAILABLE GENRE TAXONOMY (For precise targeting):
${Object.entries(MACRO_GENRES).map(([macro, subs]) => `- ${macro}: ${subs.slice(0, 8).join(', ')}...`).join('\n')}

AVAILABLE TOOLS (Scout Execution Endpoints):
- "searchArtist": { "query": string } -> Fetches top tracks for a specific artist.
- "getSimilarArtists": { "artist": string } -> Fetches Last.fm crowdsourced overlap (what other real people listen to).
- "searchCulturalWeb": { "query": string } -> Connects to the Live Internet via Google Search to scrape forums (e.g., Reddit r/popheads, r/indieheads), blogs (Pitchfork), or current news to find exactly what people are saying online right now. Example query: "What are the best underground midwest emo bands blowing up on Reddit right now?"
- "getRecommendations": { "seed_genres": string[] } -> Algorithmic Spotify discovery.
- "searchTracks": { "query": string } -> Use advanced Spotify query syntax (e.g., "genre:indie rock year:2020-2023").
- "getTopArtists": {} -> Fetches tracks strictly from the user's historical favorites.
- "getTrendingSignals": { "topic": string } -> Fetches currently trending internet tracks from local database.

RULES:
1. NEVER use "getTopArtists" unless the user's intent explicitly asks for familiar music, their favorites, or is extremely generic.
2. If the user asks for new music, a specific genre, or adjacent artists, build a diverse tool list using getSimilarArtists, getRecommendations, etc.
3. Your plan must be adaptive and intelligent.
4. Return ONLY a valid JSON object matching this EXACT schema:
{
  "strategy": "A 1-sentence explanation of your tactical approach.",
  "tool_calls": [
    { "tool": "toolName", "args": { "argName": "argValue" } }
  ]
}`;

    try {
      const { textReply } = await callWithTools(prompt, [{ role: 'user', parts: [{ text: 'Create JSON research plan.' }] }], [], 'fast');
      
      let rawText = textReply.trim();
      if (rawText.startsWith('\`\`\`json')) rawText = rawText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      if (rawText.startsWith('\`\`\`')) rawText = rawText.replace(/\`\`\`/g, '').trim();
      
      const plan = JSON.parse(rawText);
      if (onThought) onThought(`> Strategy: ${plan.strategy}`);
      return plan;
    } catch (err) {
      console.warn("PlannerAgent Error:", err.message);
      if (onThought) onThought("> Strategy fallback: Standard exploration.");
      return {
        strategy: "Fallback to standard discovery.",
        tool_calls: [
          { tool: 'getTopArtists', args: {} },
          { tool: 'getRecommendations', args: { seed_genres: tasteState.topGenres.slice(0,2) } }
        ]
      };
    }
  }
}
