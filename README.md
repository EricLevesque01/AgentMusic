# TasteGraph — Active Learning Discovery Engine

TasteGraph is a multi-agent, active-learning web application that discovers and maps a user's musical preferences using forced pairwise comparisons (Elo Rating System) and intelligent data aggregation. It features a conversational AI interface that remembers past sessions and proactively surfaces taste evolution insights.

## Core Architecture

TasteGraph relies on several distinct modules and agents to orchestrate the user experience:

1. **Auth & API (Spotify & Last.fm)**
   - Uses pure client-side PKCE OAuth 2.0 to connect to Spotify.
   - Fetches multi-source data: Short/Med/Long-term top artists, Saved Tracks, Followed Artists, and Recently Played tracks.
   - Utilizes Last.fm for highly accurate "Similar Artist" seeding.

2. **Profiler Agent**
   - Ingests the raw Spotify/Last.fm data and builds a comprehensive "Known Artist" baseline.
   - Computes MUSIC psychological dimensions, genre distribution, mainstreaminess, and discovery profile.
   - Detects taste drift by comparing recent behavioral evidence to historical patterns.

3. **Taste Game (Active Learning Engine)**
   - The core interaction loop. It presents two artists and forces the user to choose their preference.
   - **Matchmaking Strategies**: Implements specific strategies like *Benchmark Test* (Known vs. New), *Tie-Breaker* (similar Elo), and *Genre Clash* (cross-genre evaluation).
   - **Bradley-Terry / Elo System**: Ranks the user's implicit preferences over time, adjusting scores based on expected outcomes and upsets.

4. **Hybrid Spotify Web Player**
   - Integrated directly into the game cards.
   - **Premium Users**: Uses the official Spotify Web Playback SDK to play full-length tracks seamlessly in the background.
   - **Free Users**: Gracefully falls back to 30-second `preview_url` HTML5 audio elements.

5. **Concierge Agent (Conversational Memory)**
   - An LLM-powered (Gemini/Ollama) "DJ" that interacts with the user via chat.
   - Takes natural language inputs (e.g., "I want female-led dark synthpop") and dynamically *injects* new artist recommendations into the active Taste Game pool for forced evaluation.
   - **Agentic Memory**: Reads episodic session history, drift trends, and narrative anchors to proactively surface cross-session insights like "You've been gravitating toward post-punk lately — want me to go deeper?"
   - Parses intents into structured tool calls for the Orchestrator pipeline.

6. **Multi-Agent Playlist Pipeline**
   - **Scout**: LLM-guided retrieval plan with 3 modes (top tracks, specific LLM-chosen tracks, intent-filtered search) → Last.fm fallback → Track Resolver with per-run caching
   - **Curator**: Adaptive intent analysis, Scout blackboard handoff reading, per-artist caps, quality gates, post-selection verification
   - **Narrator**: RAG-grounded explanations with Wikipedia enrichment
   - **Session DJ**: Real-time skip/listen tracking for feedback loops
   - **Reflection Agent**: Post-session learning → episodic memory → drift trends → narrative anchors

7. **Resilient Track Resolver**
   - Central layer between agents and Spotify API with multi-source fallback.
   - **Three retrieval modes**: `getTopTracks()`, `resolveSpecificTracks()` (LLM names exact songs), `searchByIntent()` (Spotify field-filtered search).
   - **Rate-limit awareness**: Auto-switches to Last.fm fallback on 429, with 60s cooldown and auto-recovery.
   - **Per-run caching**: Eliminates redundant Spotify searches when the same artist appears across multiple resolution paths.

8. **Three-Tier User Model**
   - **Tier 1 (Durable)**: MUSIC dimensions, anchor artists, genre distribution, narrative anchors — persisted permanently.
   - **Tier 2 (Medium-Horizon)**: Behavioral evidence (rolling 500 events), episodic session summaries (20 sessions), drift trends.
   - **Tier 3 (Live Session)**: Skip streaks, mood shifts, explicit controls — in-memory only.

## Current Progress Roadmap

- [x] **Phase 1-4**: Basic UI setup, Vite configuration, and Spotify OAuth PKCE flow.
- [x] **Phase 5-6**: `ProfilerAgent` development and basic Elo ranking data store.
- [x] **Phase 7**: Taste Game interaction loop and Last.fm discovery pool expansion.
- [x] **Phase 8-9**: Advanced Matchmaking Strategies (UI badges, targeted active learning).
- [x] **Phase 10**: Deep data ingestion (Followed, Saved, Recent tracks) to harden the "Known Artist" baseline.
- [x] **Phase 11**: UI/UX overhaul (Premium Glassmorphism aesthetic, sleek components).
- [x] **Phase 12**: Hybrid Web Playback SDK integration for seamless in-game audio.
- [x] **Phase 13**: Concierge Agent LLM integration and multi-agent artist injection.
- [x] **Phase 14**: Settled artist detection, "Don't know this artist" action, Elo pruning rules.
- [x] **Phase 15**: Adaptive playlist generation with intent-aware curation and Spotify export.
- [x] **Phase 16**: Pipeline hardening — MUSIC dimension tuning, cold-start guards, beforeunload safety, skip tracking, Map serialization, responsive UI.
- [x] **Phase 17**: Resilient track resolution — Last.fm fallback, per-run caching, agentic retrieval modes (specificTracks, searchQueries).
- [x] **Phase 18**: Agentic memory — cross-session pattern synthesis, proactive Concierge insights, taste evolution surfacing.

## Running Locally

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and add your API keys
3. Start dev server: `npm run dev`
4. Navigate to `http://127.0.0.1:5173/` (Do not use `localhost` due to Spotify OAuth constraints)

### Using Ollama (Local LLM — no API credits needed)

1. Install Ollama: https://ollama.com
2. Pull models:
   ```
   ollama pull qwen3:8b          # Scout, Curator, Suggested Artists
   ollama pull hermes3:8b        # Narrator
   ollama pull gemma3-tools:4b   # Concierge, Reflection
   ollama pull gemma3:4b         # LLM Judge, universal fallback
   ```
3. Set `VITE_LLM_BACKEND=ollama` in your `.env` file
4. Optionally override per-agent models via `VITE_MODEL_SCOUT`, `VITE_MODEL_NARRATOR`, etc.
