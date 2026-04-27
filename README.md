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

5. **Concierge Agent (Pending)**
   - An LLM-powered (Gemini) "DJ" that can interact with the user via chat.
   - Takes natural language inputs (e.g., "I want female-led dark synthpop") and dynamically *injects* new artist recommendations into the active Taste Game pool for forced evaluation.

## Current Progress Roadmap

- [x] **Phase 1-4**: Basic UI setup, Vite configuration, and Spotify OAuth PKCE flow.
- [x] **Phase 5-6**: `ProfilerAgent` development and basic Elo ranking data store.
- [x] **Phase 7**: Taste Game interaction loop and Last.fm discovery pool expansion.
- [x] **Phase 8-9**: Advanced Matchmaking Strategies (UI badges, targeted active learning).
- [x] **Phase 10**: Deep data ingestion (Followed, Saved, Recent tracks) to harden the "Known Artist" baseline.
- [x] **Phase 11**: UI/UX overhaul (Premium Glassmorphism aesthetic, sleek components).
- [x] **Phase 12**: Hybrid Web Playback SDK integration for seamless in-game audio.
- [ ] **Phase 13**: **Concierge Agent** LLM integration and multi-agent artist injection.
- [ ] **Phase 14**: "Rejected" state visualization & 3-strike Elo pruning rules.
- [ ] **Phase 15**: Final playlist generation, sequencing, and Spotify export.

## Running Locally

1. Install dependencies: `npm install`
2. Start dev server: `npm run dev`
3. Navigate to `http://127.0.0.1:5173/` (Do not use `localhost` due to Spotify OAuth constraints).
