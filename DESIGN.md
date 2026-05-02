# TasteGraph (AgentMusic) Design Architecture

## LLM Model Routing Strategy

To optimize for both speed/cost and complex reasoning, the pipeline routes tasks to different LLM tiers based on cognitive load. Supports both **Gemini (cloud)** and **Ollama (local)** backends.

### Backend Configuration
- `VITE_LLM_BACKEND=gemini` — Uses Gemini API (default)
- `VITE_LLM_BACKEND=ollama` — Uses local Ollama for zero-cost testing

### `fast` Tier (Gemini 2.5 Flash / Ollama local)
Used for tasks requiring rapid classification, structured data extraction, and formatting.

1. **Concierge Agent (Intent Parsing):**
   - **Task:** Converts natural language chat messages into structured tool calls (`boost_genre`, `penalize_genre`, `taste_evolution`, etc.).
   - **Why Fast:** Bounded classification problem. Smaller models excel at picking from a predefined list of tools and extracting arguments quickly.
   - **Agentic Memory:** Reads episodic memory, drift trends, and narrative anchors to proactively surface cross-session insights. Builds proactive hints based on skip rate trends, genre momentum, and repeated favorites.

2. **Scout Agent (Agentic Retrieval Planning + Web Search):**
   - **Task:** Generates a structured retrieval plan with three modes: artist top-tracks, LLM-chosen specific tracks, and intent-filtered search queries. Also searches the web for topical connections via Google Search grounding.
   - **Why Fast:** Single-turn tool call — the LLM provides a retrieval plan from its world knowledge + web search, then the code executes via the Track Resolver.
   - **Track Resolver:** All Spotify interactions go through `track-resolver.js`, which provides per-run caching, automatic Last.fm fallback on 429 rate limits, and three retrieval modes.

3. **Narrator Agent (Track Explanations):**
   - **Task:** Generates a 1-sentence explanation for each track in the final playlist, plus a playlist title and summary.
   - **Why Fast:** The heavy lifting of track selection is already complete. The model formats structured input into human-readable prose.

4. **Suggested Artists Agent (Web-Grounded Discovery):**
   - **Task:** Uses LLM + Google Search grounding to find non-obvious artist recommendations from music journalism, forums, and reviews.
   - **Why Fast:** Single-turn tool call with web grounding.

### `reasoning` Tier (Gemini 2.5 Pro / Ollama local)
Used for tasks requiring multi-step planning, complex constraints, and creative synthesis.

1. **Curator Agent (Adaptive Selection):**
   - **Task:** Selects tracks from the candidate pool, enforcing adaptive constraints based on session intent (genre exploration = 1 per artist, artist deep-dive = unlimited, etc.).
   - **Why Reasoning:** Requires evaluating multiple competing constraints (diversity, genre integrity, era awareness, anti-spam gates) simultaneously and producing structured JSON output with reasoning.
   - **Scout Handoff:** Reads the Scout's blackboard to understand how the pool was assembled (source breakdown, agentic retrieval flags, rate-limit status) and prioritizes LLM-chosen tracks accordingly.

2. **Narrator Agent (Sonic Dossier / Musical Vibe):**
   - **Task:** Writes a 3-4 paragraph "Musical Vibe" breakdown analyzing the user's taste with deep cultural context.
   - **Why Reasoning:** Requires high-level creative writing, a specific metaphorical tone (the "music historian best friend"), and synthesizing raw Wikipedia facts into a compelling narrative.

### Per-Agent Model Router (Ollama Path)
When using local models, `model-router.js` maps each agent to its optimal model:

| Agent | Model | Why |
|---|---|---|
| Scout, Curator, Suggested | `qwen3:8b` | Best generalist for agentic/tool-calling tasks |
| Narrator | `hermes3:8b` | Best creative voice for narrative writing |
| Concierge, Reflection | `gemma3-tools:4b` | Classification specialist, community fine-tune for tool calls |
| LLM Judge | `gemma3:4b` | Universal fallback, proven in evaluation tests |

## Pipeline Flow

```
                    PlaylistScheduler (background)
                           ↓
User Intent → Profiler → Scout → Curator → Narrator → Playlist UI
                           ↑
                    [3 Knowledge Layers]
                    ├── Structured (Last.fm, MusicBrainz, Wikidata)
                    ├── LLM World Knowledge
                    └── Web Search Grounding (Google / SearXNG)
                           ↑
                    Concierge (chat — with episodic memory + taste evolution)
                           ↓
                    Session DJ → Reflection Agent → UserModel
                                      ↓
                              SuggestedArtistsAgent → Home Feed
```

## Three Knowledge Layers

| Layer | Source | Cost | Discovers |
|---|---|---|---|
| **Structured Graph** | Last.fm similar, MusicBrainz relationships, Wikidata P737 | Free APIs | Band members, collaborators, influences, similar artists |
| **LLM World Knowledge** | Gemini training data | 1 LLM call | Shared producers, scene connections, sonic DNA |
| **Live Web Search** | Gemini Google Search grounding / SearXNG + Ollama | 1 LLM call | Current reviews, forum buzz, new releases, trending artists |

## Resilient Track Resolution

All Spotify interactions are mediated by `track-resolver.js`, a resilient layer with three retrieval modes and multi-source fallback:

### Retrieval Modes
| Mode | Trigger | Use Case |
|---|---|---|
| `getTopTracks()` | Default / broad discovery | Artist's most popular tracks |
| `resolveSpecificTracks()` | LLM names exact tracks | Deep cuts, mood-specific songs (e.g., "Till There Was You") |
| `searchByIntent()` | Intent-filtered query | Spotify search with field filters (e.g., `artist:"Beatles" love ballad`) |

### Fallback Chain
1. **Per-run memory cache** — avoids redundant API calls within a single pipeline run
2. **DataStore response cache** — 24h TTL, persists across page reloads
3. **Spotify primary** — top-tracks or search endpoint
4. **Last.fm fallback** — on 429 rate limit, gets track names from Last.fm → resolves via Spotify search (different rate bucket)
5. **Minimal track shape** — absolute last resort, builds a non-playable track object from Last.fm data

### Rate-Limit Awareness
- `isSpotifyDegraded()` flag flips on first 429, stays on for 60s cooldown
- All agents automatically route through the fallback path while degraded
- Auto-recovery after cooldown period

## Adaptive Curation System

The Curator analyzes session intent and applies different parameters:

| Intent Type | Track Range | Max/Artist | Diversity |
|------------|-------------|------------|-----------|
| Genre Exploration | 12-20 | 1 | Maximum — every track from a different artist |
| Artist Focus | 8-20 | Unlimited | Single artist deep-dive |
| Mood/Activity | 15-25 | 2 | Balanced — familiar + discovery |
| General | 10-20 | 2 | Standard mix |

Post-selection verification algorithmically enforces these caps as a safety net.

## Inter-Agent Communication (Blackboard)

Agents communicate via a structured blackboard on `PipelineContext`:

| Writer | Reader | Data |
|---|---|---|
| Profiler | Scout, Curator | MUSIC dimensions, discovery profile, genre distribution, drift patterns |
| Scout | Curator | Search strategy, source breakdown, agentic retrieval flags, rate-limit status |
| Curator | Narrator | Selection thesis, discovery ratio, tradeoffs |
| Narrator | UI | Playlist title, sophistication level |

The Scout's handoff includes `usedAgenticRetrieval` and `sourceBreakdown` flags so the Curator knows which tracks were LLM-chosen (high priority) vs. generic top-tracks.

## Agentic Memory & Taste Evolution

### Three-Tier User Model
| Tier | Horizon | Persistence | Examples |
|---|---|---|---|
| **Tier 1: Durable Identity** | Months–years | localStorage (permanent) | MUSIC dimensions, anchor artists, genre distribution, narrative anchors |
| **Tier 2: Medium-Horizon** | Sessions–weeks | localStorage (rolling) | Behavioral evidence (500 events/type), episodic summaries (20 sessions) |
| **Tier 3: Live Session** | Current session | In-memory only | Skip streaks, mood shifts, explicit controls |

### Cross-Session Pattern Synthesis
The **Reflection Agent** runs at session end and:
1. Builds episodic summaries (skip rates, loved/skipped genres, artist highlights)
2. Extracts narrative anchors via LLM (e.g., "Consistently skips vocal jazz but loves instrumental")
3. Updates drift trends by comparing recent sessions (genre momentum, decline, discovery trajectory)
4. Infers functional profile from accumulated session motivations

### Proactive Concierge Insights
The **Concierge Agent** reads episodic memory and drift trends to proactively surface insights:
- "You've been gravitating toward post-punk lately — want me to go deeper?"
- "Your recent sessions have high skip rates — want something more familiar?"
- "Jazz is becoming a new obsession — it's appeared in 3 recent sessions"

## Playlist Scheduler

Background agent that proactively generates playlists using intelligent intent seeds:
- **Dimension-based:** Lean into dominant MUSIC personality dimension
- **Drift-based:** Ride the wave of evolving taste
- **Coverage-gap:** Explore under-explored genres
- **Temporal:** Time-of-day contextual (morning focus, late night atmosphere)
- **Episodic:** Callback to past successful sessions
- **Cost controls:** Max 3 unlistened playlists, 30-minute cooldown between runs

## Local Embedding Store

When using the Ollama backend, `embedding-store.js` provides in-browser semantic similarity:
- **Model:** `all-MiniLM-L6-v2` (23MB quantized ONNX via Transformers.js)
- **Storage:** IndexedDB (~7.7MB for 5,000 artists)
- **Used by:** Scout Hop-1 (replaces Last.fm similar-artist API for the local path)
- **Capabilities:** Artist-to-artist similarity, text-to-artist search, semantic genre matching

## API Wrapper Integration
The `callWithTools` function in `gemini-api.js` supports both Gemini and Ollama backends via the `VITE_LLM_BACKEND` environment variable. The system automatically routes requests to the appropriate model and translates message formats between Gemini-native and OpenAI-compatible chat formats. The `useWebSearch` parameter enables Google Search grounding for web-aware discovery.
