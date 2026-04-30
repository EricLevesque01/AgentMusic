# TasteGraph (AgentMusic) Design Architecture

## LLM Model Routing Strategy

To optimize for both speed/cost and complex reasoning, the pipeline routes tasks to different LLM tiers based on cognitive load. Supports both **Gemini (cloud)** and **Ollama (local)** backends.

### Backend Configuration
- `VITE_LLM_BACKEND=gemini` — Uses Gemini API (default)
- `VITE_LLM_BACKEND=ollama` — Uses local Ollama for zero-cost testing

### `fast` Tier (Gemini 2.5 Flash / Ollama local)
Used for tasks requiring rapid classification, structured data extraction, and formatting.

1. **Concierge Agent (Intent Parsing):**
   - **Task:** Converts natural language chat messages into structured tool calls (`boost_genre`, `penalize_genre`, etc.).
   - **Why Fast:** Bounded classification problem. Smaller models excel at picking from a predefined list of tools and extracting arguments quickly.

2. **Scout Agent (Retrieval Planning):**
   - **Task:** Generates a structured list of real artist names to look up, given a session intent like "explore jazz."
   - **Why Fast:** Single-turn tool call — the LLM provides artist names from its world knowledge, then the code executes the actual API lookups against Spotify and Last.fm.

3. **Narrator Agent (Track Explanations):**
   - **Task:** Generates a 1-sentence explanation for each track in the final playlist, plus a playlist title and summary.
   - **Why Fast:** The heavy lifting of track selection is already complete. The model formats structured input into human-readable prose.

### `reasoning` Tier (Gemini 2.5 Pro / Ollama local)
Used for tasks requiring multi-step planning, complex constraints, and creative synthesis.

1. **Curator Agent (Adaptive Selection):**
   - **Task:** Selects tracks from the candidate pool, enforcing adaptive constraints based on session intent (genre exploration = 1 per artist, artist deep-dive = unlimited, etc.).
   - **Why Reasoning:** Requires evaluating multiple competing constraints (diversity, genre integrity, era awareness, anti-spam gates) simultaneously and producing structured JSON output with reasoning.

2. **Narrator Agent (Sonic Dossier / Musical Vibe):**
   - **Task:** Writes a 3-4 paragraph "Musical Vibe" breakdown analyzing the user's taste with deep cultural context.
   - **Why Reasoning:** Requires high-level creative writing, a specific metaphorical tone (the "music historian best friend"), and synthesizing raw Wikipedia facts into a compelling narrative.

## Pipeline Flow

```
User Intent → Profiler → Scout → Curator → Narrator → Playlist UI
                                    ↑
                              Concierge (chat)
                                    ↓
                            Session DJ → Reflection Agent → UserModel
```

## Adaptive Curation System

The Curator analyzes session intent and applies different parameters:

| Intent Type | Track Range | Max/Artist | Diversity |
|------------|-------------|------------|-----------|
| Genre Exploration | 12-15 | 1 | Maximum — every track from a different artist |
| Artist Focus | 8-15 | Unlimited | Single artist deep-dive |
| Mood/Activity | 10-18 | 2 | Balanced — familiar + discovery |
| General | 12-18 | 2 | Standard mix |

Post-selection verification algorithmically enforces these caps as a safety net.

## API Wrapper Integration
The `callWithTools` function in `gemini-api.js` supports both Gemini and Ollama backends via the `VITE_LLM_BACKEND` environment variable. The system automatically routes requests to the appropriate model and translates message formats between Gemini-native and OpenAI-compatible chat formats.
