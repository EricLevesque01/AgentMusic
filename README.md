# TasteGraph — Active Learning Discovery Engine

TasteGraph is a multi-agent, active-learning web application that discovers and maps a user's musical preferences using forced pairwise comparisons (Elo Rating System) and intelligent data aggregation.

## Core Architecture

TasteGraph relies on several distinct modules and agents to orchestrate the user experience:

1. **Auth & API (Spotify & Last.fm)**
   - Uses pure client-side PKCE OAuth 2.0 to connect to Spotify.
   - Fetches multi-source data: Short/Med/Long-term top artists, Saved Tracks, Followed Artists, and Recently Played tracks.
   - Utilizes Last.fm for highly accurate "Similar Artist" seeding.

2. **Profiler Agent**
   - Ingests the raw Spotify/Last.fm data and builds a comprehensive "Known Artist" baseline.
   - Prevents the system from misclassifying long-time favorites as "New Discoveries."

3. **Taste Game (Active Learning Engine)**
   - The core interaction loop. It presents two artists and forces the user to choose their preference.
   - **Matchmaking Strategies**: Implements specific strategies like *Benchmark Test* (Known vs. New), *Tie-Breaker* (similar Elo), and *Genre Clash* (cross-genre evaluation).
   - **Bradley-Terry / Elo System**: Ranks the user's implicit preferences over time, adjusting scores based on expected outcomes and upsets.

4. **Hybrid Spotify Web Player**
   - Integrated directly into the game cards.
   - **Premium Users**: Uses the official Spotify Web Playback SDK to play full-length tracks seamlessly in the background.
   - **Free Users**: Gracefully falls back to 30-second `preview_url` HTML5 audio elements.

5. **Concierge Agent**
   - An LLM-powered (Gemini/Ollama) "DJ" that interacts with the user via chat.
   - Takes natural language inputs (e.g., "I want female-led dark synthpop") and dynamically *injects* new artist recommendations into the active Taste Game pool for forced evaluation.
   - Parses intents into structured tool calls for the Orchestrator pipeline.

6. **Multi-Agent Playlist Pipeline**
   - **Scout**: LLM-guided retrieval plan → Last.fm graph expansion → Spotify lookup
   - **Curator**: Adaptive intent analysis, per-artist caps, quality gates, post-selection verification
   - **Narrator**: RAG-grounded explanations with Wikipedia enrichment
   - **Session DJ**: Real-time skip/listen tracking for feedback loops
   - **Reflection Agent**: Post-session learning → episodic memory → drift trends

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

## Running Locally

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and add your API keys
3. Start dev server: `npm run dev`
4. Navigate to `http://127.0.0.1:5173/` (Do not use `localhost` due to Spotify OAuth constraints)

### Using Ollama (Local LLM — no API credits needed)

1. Install Ollama: https://ollama.com
2. Pull a model: `ollama pull llama3.1`
3. Set `VITE_LLM_BACKEND=ollama` in your `.env` file
4. Optionally set `VITE_OLLAMA_MODEL=llama3.1` (default)
