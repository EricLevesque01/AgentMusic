# Agent Music — Agentic Music Discovery Engine

> **A multi-agent AI system that learns your musical taste through active comparison and delivers intelligent, context-aware playlist curation.**

Agent Music is a fully client-side web application built on a pipeline of cooperating AI agents. Rather than relying on a single monolithic model, each agent in the system is purpose-built for a narrow task — and routed to the language model best suited to that task. The system learns from every interaction: comparisons, skips, listening history, and natural language conversation all flow back into a shared taste representation that gets smarter over time.

---

## Table of Contents

- [Why Multi-Agent?](#why-multi-agent)
- [System Architecture](#system-architecture)
- [The Agent Pipeline](#the-agent-pipeline)
  - [Profiler Agent](#1-profiler-agent)
  - [Scout Agent](#2-scout-agent)
  - [Curator Agent](#3-curator-agent)
  - [Narrator Agent](#4-narrator-agent)
  - [Concierge Agent](#5-concierge-agent)
  - [Session DJ Agent](#6-session-dj-agent)
  - [Reflection Agent](#7-reflection-agent)
  - [Suggested Artists Agent](#8-suggested-artists-agent)
  - [Cultural Scout](#9-cultural-scout)
- [LLM Selection Rationale](#llm-selection-rationale)
- [Supporting Infrastructure](#supporting-infrastructure)
- [The Taste Game (Active Learning)](#the-taste-game-active-learning)
- [Data Storage Architecture](#data-storage-architecture)
- [Running Locally](#running-locally)

---

## Why Multi-Agent?

A single LLM cannot reliably do all of the following at once:
- Parse live Spotify API data
- Rank artists with a statistically grounded system
- Write compelling, personalized prose
- Make tool calls to multiple external APIs
- Maintain cross-session memory
- Curate a 12-track playlist with intent-specific diversity rules

The multi-agent approach solves this by **specialization**. Each agent has a narrow, well-defined contract: it reads from a shared `PipelineContext` ("the blackboard"), does one thing well, and writes its output back. This is intentional — it mirrors the design principles behind systems like LangChain's agent executors but keeps the implementation lean and fully browser-native (no Node.js backend required).

The tradeoff is coordination overhead. We manage this with a strict **sequential Promise queue** on all Spotify API calls (one request every 100ms), per-run caching in the Track Resolver, and a shared blackboard pattern that lets agents passively read each other's outputs without tight coupling.

---

## System Architecture

```
User Intent (natural language)
          │
          ▼
┌─────────────────────────────────────────────────┐
│              Orchestrator                        │
│  (coordinates pipeline, owns PipelineContext)    │
└────┬──────────┬──────────┬──────────────────────┘
     │          │          │
     ▼          ▼          ▼
┌─────────┐ ┌────────┐ ┌──────────────┐
│Profiler │ │ Scout  │ │Cultural Scout│
│  Agent  │ │ Agent  │ │  (web RAG)   │
└────┬────┘ └───┬────┘ └──────┬───────┘
     │          │              │
     │    CandidatePool ◄──────┘
     │          │
     ▼          ▼
┌──────────────────────┐
│    Curator Agent      │
│  (intent + selection) │
└──────────┬────────────┘
           │  scoredPlaylist
           ▼
┌──────────────────────┐
│    Narrator Agent     │
│  (explanations + RAG) │
└──────────┬────────────┘
           │
           ▼
      Final Playlist
      (saved to DataStore)
           │
           ├──► PlaylistView (UI)
           ├──► Spotify Export
           └──► Reflection Agent (background)
```

---

## The Agent Pipeline

### 1. Profiler Agent

**File:** `src/agents/profiler-agent.js`
**Runs:** At pipeline start and on Compare screen init
**Purpose:** Build a comprehensive portrait of the user's musical identity from raw Spotify data.

The Profiler ingests up to 6 sources from Spotify simultaneously:
- **Short/Medium/Long-term top artists** — 50 artists each, representing different time horizons
- **Saved tracks** — extracts artist signals from the user's personal library
- **Followed artists** — explicit affinity signals (stronger than implicit listening)
- **Recently played** — real-time mood signal

These are merged, deduplicated, and run through a series of analytical passes:

| Dimension | What It Computes |
|-----------|-----------------|
| **MUSIC Dimensions** | 5-axis psychographic model: Mellow, Unpretentious, Sophisticated, Intense, Contemporary |
| **Genre Distribution** | Weighted frequency map across Spotify's genre taxonomy |
| **Mainstreaminess** | Follower-count-based proxy for how mainstream the user's taste runs |
| **Specialist Index** | Concentration of taste — how narrowly focused vs. omnivorous |
| **Discovery Profile** | Composite signal used to set Scout's hop depth |

The Profiler also reads the user's Elo ratings (from the Compare screen) and produces a `topRankedArtists` list — sorted by calibrated preference rather than raw Spotify popularity.

**Key design decision:** We cache Spotify data for 24 hours in localStorage (with `stripHeavyMetadata` to remove the `available_markets` arrays that bloat each artist object by ~2KB). This prevents the pipeline from hammering Spotify on every page load and keeps the app responsive.

---

### 2. Scout Agent

**File:** `src/agents/scout-agent.js`
**Runs:** Phase 2 of the playlist pipeline
**Purpose:** Discover and retrieve candidate tracks that the Curator will select from.

The Scout is the most complex agent. Its job is to translate a user's intent (e.g., "late night driving, moody indie rock") into a concrete **CandidatePool** of 20-60 tracks — with enough diversity that the Curator has real options to work with.

#### Intent Classification

Before calling any LLM, the Scout performs a **synchronous regex-based classification** of the intent:
- `specific` — user named an artist ("check out Geese", "I want more Radiohead")
- `exploration` — user wants to discover something new ("explore jazz", "underground electronic")
- `broad` — user wants familiar favorites ("play my usual stuff")
- `general` — default

This classification gates the entire retrieval strategy. A `specific` request suppresses seed-expansion (we don't flood the pool with The Strokes just because the user likes them) and routes more tracks to the named artist.

#### The Retrieval Plan (LLM-Guided)

The Scout calls the LLM to produce a structured **retrieval plan** with three tool-based output modes:

| Mode | When Used | How It Works |
|------|-----------|-------------|
| `artists` | Broad discovery, artist focus | Looks up top tracks for each named artist via the resilient Track Resolver |
| `specificTracks` | Mood, theme, deep cuts | LLM names exact songs; Track Resolver searches Spotify for each by name+artist |
| `searchQueries` | Intent-filtered discovery | Spotify field-filtered searches (e.g., `artist:"Miles Davis" ballad`) |

For an `artist_focus` intent, the **primary artist** gets up to 20 tracks fetched; supporting/context artists get 4 each. For other intents, the primary artist gets 12.

#### Hop Depth (Graph Traversal)

After intent-based retrieval, the Scout optionally expands the pool via the music graph:
- **Hop 0:** Top tracks from the user's own Elo-ranked artists
- **Hop 1:** Last.fm "Similar Artists" → resolve through Spotify
- **Hop 2:** Genre exploration — used for high-adventurousness or explicit discovery intents

The hop depth is determined dynamically from the intent text and the user's `discoveryProfile`.

#### Pool Starvation Guard

If the pool has fewer than 15 candidates after intent retrieval, the Scout runs a secondary Last.fm expansion from the intent-sourced artists — ensuring the Curator always has enough material to reach the target track count.

---

### 3. Curator Agent

**File:** `src/agents/curator-agent.js`
**Runs:** Phase 3 of the playlist pipeline
**Purpose:** Select the final tracks, set diversity rules, write per-track reasoning, and name the playlist.

The Curator is the system's artistic decision-maker. It receives the full CandidatePool from the Scout and must produce a ranked, curated selection that matches the user's intent.

#### Intent Analysis

Before calling the LLM, the Curator runs its own regex-based intent analysis to set curation parameters:

| Intent Type | Target Tracks | Max Per Artist | Diversity Strategy |
|-------------|--------------|----------------|--------------------|
| `artist_focus` | 10–15 | 10 | Primary artist dominates; context artists sparse |
| `genre_exploration` | 12–16 | 2 | Maximum diversity — every track ideally a different artist |
| `mood_activity` | 10–15 | 4 | Cluster by mood; mini-dives of 3-5 from a core artist are fine |
| `general` | 10–15 | 3 | Balance familiarity with discovery |

These parameters are passed verbatim to the LLM in the system prompt, along with:
- The user's full Taste DNA Brief (north star artist, core identity, momentum)
- The Scout's blackboard handoff (how the pool was assembled, what sources contributed)
- Quality gates for spam/content farm filtering (no AI-generated titles, no <500ms tracks)

#### The Curation Loop

The Curator uses a **two-attempt strategy**:
1. Parse the LLM's JSON response for track IDs and per-track reasons
2. If the first attempt produces fewer than 5 valid tracks, immediately retry with a simplified prompt

After selection, it runs `_verifyPlaylist()` to enforce hard constraints (per-artist caps, minimum track count) and then pads to a **hard floor of 8 tracks** from the clean pool if needed.

**Key design decision:** We intentionally dropped strict JSON schema enforcement (Gemini's `responseSchema` feature) for the Curator after finding it caused generation loops on large dynamic arrays. The Curator now produces free-form JSON guided by the system prompt, parsed by a robust `extractJSON()` helper. This is faster and more reliable in practice.

---

### 4. Narrator Agent

**File:** `src/agents/narrator-agent.js`
**Runs:** Background phase after Curator; also on Profile page
**Purpose:** Explain why tracks were chosen and generate the user's "Sonic Dossier."

The Narrator has two distinct responsibilities:

**Track Enrichment** — For discovery tracks (hop distance ≥ 1, cultural discoveries), the Narrator generates 2-3 sentence cultural context blurbs. Example: instead of "Similar to Jeff Buckley," it writes "Tim Buckley pioneered the baroque folk vocal style that Jeff Buckley inherited — hearing the father clarifies everything strange and transcendent about the son." This uses a Wikipedia RAG fetch for the top 3 artists in the playlist.

**Agentic Profile Analysis** — On the Profile page, the Narrator generates the user's "Musical Vibe" section: a tagline, hero description, vibe analysis paragraph, and dynamic tier list — all grounded in the user's actual Elo rankings and Wikipedia context for their top artists. This uses a **cache-first strategy** with a 24-hour TTL keyed to the user's current top-5 artist fingerprint.

---

### 5. Concierge Agent

**File:** `src/ui/components/chat-panel.js` + `src/agents/orchestrator.js`
**Runs:** Always-on chat panel
**Purpose:** Natural language interface to the entire pipeline, with cross-session memory.

The Concierge is the user-facing conversational agent. It can:
- Parse intents and trigger full playlist generation pipelines
- Inject specific artists into the Compare screen for forced evaluation
- Surface cross-session pattern insights ("You've been gravitating toward post-punk lately")
- Extract and persist user facts to `agent_memories` (e.g., "doesn't like electronic music")

**Agentic Memory:** The Concierge reads from three memory layers:
- Episodic session summaries (last 20 sessions)
- Drift trends (taste evolution over time)
- Narrative anchors (the user's "music story" — first concerts, formative albums)

Facts extracted from conversation are written back to `explicit_preferences.agent_memories` and read by the Scout and Curator on every subsequent pipeline run.

---

### 6. Session DJ Agent

**File:** `src/agents/session-dj-agent.js`
**Runs:** Background, always active during a session
**Purpose:** Real-time feedback loop — detects skip streaks and mood shifts.

The Session DJ monitors track skip/listen events from the playlist player. When it detects 3+ consecutive skips, it triggers a "DJ intervention" modal with proposed adjustments (e.g., "Seems like you're not feeling the tempo — want me to shift toward something more driving?"). These adjustments are written to `session_signals` in the DataStore, which the Scout reads on the next pipeline run.

---

### 7. Reflection Agent

**File:** `src/agents/reflection-agent.js`
**Runs:** Fire-and-forget on session end (hash change, page unload)
**Purpose:** Extract durable knowledge from session behavior and persist it.

After each session, the Reflection Agent processes the full event log — skips, listens, ratings, dismissed playlists — and writes structured updates to:
- **Episodic memory:** A narrative summary of what happened ("Deep-dived into post-punk, skipped everything upbeat, rated Fontaines DC highest")
- **Drift trends:** Moving average of taste dimension shifts
- **Narrative anchors:** Extracts memorable "music story" moments from conversation

This runs asynchronously and does not block the UI.

---

### 8. Suggested Artists Agent

**File:** `src/agents/suggested-artists.js`
**Runs:** On Home page load (deferred, idle callback)
**Purpose:** Surface non-obvious discovery candidates the user hasn't heard yet, with genuine explanations.

The Suggested Artists agent runs a three-layer research pipeline:

| Layer | Source | What It Finds |
|-------|--------|--------------|
| **Layer 1A** | Last.fm Similar Artists | Genre adjacency (fast, high recall) |
| **Layer 1B** | MusicBrainz Relationships | Band members, side projects, collaborators |
| **Layer 1C** | Wikidata Influence Graph | Who influenced whom (historical lineage) |
| **Layer 2+3** | LLM + Web Search | Scene connections, shared producers, cultural context |

After discovery, a **reason enrichment pass** rewrites the raw API-sourced labels ("fans also listen to X") into genuine music-critical blurbs using the LLM's world knowledge.

Results are cached with a quality gate: if >40% of cached reasons are still generic boilerplate, the cache is silently revalidated in the background while the cached version shows instantly (stale-while-revalidate pattern).

---

### 9. Cultural Scout

**File:** `src/agents/cultural-scout.js`
**Runs:** Pre-Scout phase in the pipeline (non-blocking)
**Purpose:** Ground discovery in real-world context — events, press, community signals.

The Cultural Scout uses the LLM's web grounding (Gemini's Google Search tool, or SearXNG for local) to find:
- Artists with recent cultural momentum (new album, critical buzz)
- Event-adjacent discoveries (touring with a favorite artist)
- Community-validated connections (niche forum discussions)

Its output is written to `blackboard.culturalIntelligence` and read by the Scout agent, which injects these artists into the candidate pool as `cultural_discovery` sources.

---

## LLM Selection Rationale

Agent Music supports two LLM backends: **Gemini** (cloud, default) and **Ollama** (local). Each agent is routed to the model that best matches its task profile.

### Gemini (Cloud Default)

| Model | Tier | Used By |
|-------|------|---------|
| `gemini-2.5-flash` | `fast` | Scout retrieval plan, Concierge chat, session summaries, intent parsing |
| `gemini-2.5-pro` | `reasoning` | Curator selection loop, Narrator profile analysis |

**Why two Gemini models?** Flash is significantly faster and cheaper — it's more than capable for structured JSON output (retrieval plans, memory extraction). Pro's extended thinking is reserved for the Curator's ReAct-style curation loop where reasoning quality directly affects playlist quality.

### Ollama (Local — No API Credits Required)

| Model | Agent(s) | Why This Model |
|-------|---------|---------------|
| `qwen3:8b` | Scout, Curator, Suggested Artists | Best generalist for agentic/tool-calling tasks at 8B scale. MCP-aware, reliable structured output, strong at multi-step reasoning. |
| `hermes3:8b` | Narrator | Strongest creative voice at 8B scale. Fine-tuned for long-form narrative and roleplay coherence — produces genuinely engaging track descriptions rather than generic summaries. |
| `gemma3-tools:4b` | Concierge, Reflection | Community fine-tune optimized specifically for Ollama tool_call parsing. Runs fast on CPU for classification and structured extraction tasks where creativity isn't needed. |
| `gemma3:4b` | LLM Judge, fallback | Universal fallback — proven reliable across all test cases. Used as the safety net when a specialized model fails. |

**The core principle:** Use the **smallest model that reliably does the job**. The Narrator needs creative voice — it gets Hermes 3. The Reflection Agent just needs to classify events into structured JSON — it gets Gemma 4B. This keeps local inference fast enough to run on a consumer laptop.

All models can be overridden per-agent via environment variables (`VITE_MODEL_SCOUT`, `VITE_MODEL_CURATOR`, etc.).

---

## Supporting Infrastructure

### Track Resolver (`src/data/track-resolver.js`)

All Spotify track lookups route through a central resilient resolver rather than calling the Spotify API directly. This gives us:

- **Multi-source fallback:** On 429 rate limits, switches to Last.fm → Spotify search (different quota bucket) with a 60-second cooldown and auto-recovery
- **Per-run caching:** If the same artist appears in the intent override, MusicBrainz expansion, and cultural discovery phases, Spotify is only called once
- **Three retrieval modes:**
  - `getTopTracks()` — Popular tracks for an artist
  - `resolveSpecificTracks()` — LLM names exact songs; we search for them
  - `searchByIntent()` — Spotify field-filtered search (`artist:"X" mood keyword`)

### Spotify API Queue (`src/data/spotify-api.js`)

All Spotify API calls pass through a strict **serialized Promise queue** with a 100ms enforced interval between requests. This replaced a timestamp-based throttle that failed under concurrent async calls — the old approach allowed multiple Promises to read the same shared timestamp simultaneously, bypassing the delay entirely and triggering 429 cascades.

### DataStore (`src/data/data-store.js`)

All persistence uses localStorage via a unified `DataStore` class. Key design choices:
- **Dual-store pattern:** `playlist_library` (primary, enriched with intent/source metadata) and `saved_playlists` (legacy compatibility). Both use the same entry ID so deletes propagate correctly.
- **Deep-clone on save:** `scoredPlaylist` is JSON round-tripped before persistence to break shared object references that would otherwise corrupt silently under `JSON.stringify`
- **Blackboard excluded:** The pipeline's `blackboard` object (which accumulates intermediate agent data) is intentionally excluded from serialization — it's too large for localStorage and is only needed during active pipeline execution.

---

## The Taste Game (Active Learning)

The Compare screen implements a **pairwise preference learning** system built on Elo ratings with Bradley-Terry extensions.

**Why pairwise comparisons?** Direct rating scales ("Rate this artist 1-5") produce biased, inconsistent data. Forced choices between two specific options produce far more reliable preference signals — this is the same insight behind systems like Beli and every serious recommender that uses active learning.

**Matchmaking strategies:**
- **Benchmark Test** — Known vs. New: calibrates a new artist against an anchor the user has already rated
- **Tie-Breaker** — Similar Elo: resolves ambiguity between artists the user seems to rate similarly
- **Genre Clash** — Cross-genre: surfaces hidden preferences by forcing comparisons across style boundaries
- **Bradley-Terry Information Gain** — Selects the pair that maximally reduces uncertainty in the preference model

**Pool expansion:** The game starts with the user's actual Spotify library, then expands via Last.fm similar artists as the session progresses. Artists with high win streaks trigger expansion from their genre neighborhood, ensuring the pool never stagnates.

---

## Data Storage Architecture

```
localStorage (via DataStore)
├── tg_elo_ratings          — Elo scores, win/loss counts per artist (core ranking data)
├── tg_explicit_preferences — favorite_artists, disliked_genres, agent_memories
├── tg_playlist_library     — Generated playlists (primary store, enriched metadata)
├── tg_saved_playlists      — Legacy compatibility store (same IDs as library)
├── tg_top_artists          — Profiler cache (24h TTL, stripped metadata)
├── tg_top_tracks           — Profiler cache (24h TTL)
├── tg_suggested_artists    — Suggestion row cache (stale-while-revalidate)
├── tg_session_signals      — Skip/love signals (ephemeral, cleared on session end)
├── tg_agentic_profile_cache— Narrator's profile analysis (24h TTL, artist-hash keyed)
└── tg_cache_*              — Track resolver response cache (per-artist, 24h TTL)
```

---

## Running Locally

### Prerequisites
- Node.js 18+
- Spotify Developer App (free) — [Create one here](https://developer.spotify.com/dashboard)
- Gemini API Key (free tier available) — [Get one here](https://aistudio.google.com)

### Setup & API Keys

To run Agent Music locally, you **must** supply your own API keys. Because of Spotify's development mode restrictions and LLM token costs, there is no shared public key.

#### 1. Spotify API Key
Spotify requires all apps in Development Mode to explicitly allowlist users.
1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Under App Settings, set the **Redirect URI** to `http://127.0.0.1:5173/`.
3. Click on **User Management** and add your Spotify email address (and any friends you want to test with, up to 25 users).
4. Copy your **Client ID** — you will need it below.

#### 2. Gemini API Key (Optional if using Ollama)
Agent Music uses Google's Gemini models by default because they are incredibly fast and offer a generous free tier.
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click **Create API Key**.
3. Copy the key — you will need it below.

#### 3. Installation

```bash
git clone https://github.com/EricLevesque01/AgentMusic.git
cd AgentMusic
npm install
cp .env.example .env
```

Open your `.env` file and paste your keys:
```env
VITE_SPOTIFY_CLIENT_ID="your_spotify_client_id_here"
VITE_GEMINI_API_KEY="your_gemini_api_key_here"
```

Start the dev server:
```bash
npm run dev
```

Navigate to `http://127.0.0.1:5173/` — **do not use `localhost`** due to Spotify OAuth redirect URI constraints.

### Using Ollama (Local LLM — No API Credits)

```bash
# Install Ollama: https://ollama.com
ollama pull qwen3:8b          # ~5.2GB — Scout, Curator, Suggested Artists
ollama pull hermes3:8b        # ~4.7GB — Narrator
ollama pull gemma3-tools:4b   # ~3.3GB — Concierge, Reflection
ollama pull gemma3:4b         # ~3.3GB — LLM Judge, universal fallback
```

Set `VITE_LLM_BACKEND=ollama` in your `.env` file. Optionally override per-agent models:

```env
VITE_LLM_BACKEND=ollama
VITE_MODEL_SCOUT=qwen3:8b
VITE_MODEL_CURATOR=qwen3:8b
VITE_MODEL_NARRATOR=hermes3:8b
VITE_MODEL_CONCIERGE=gemma3-tools:4b
VITE_MODEL_REFLECTION=gemma3-tools:4b
```

### Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SPOTIFY_CLIENT_ID` | ✅ | Spotify app client ID |
| `VITE_GEMINI_API_KEY` | Cloud mode only | Gemini API key |
| `VITE_LLM_BACKEND` | No | `gemini` (default) or `ollama` |
| `VITE_OLLAMA_URL` | No | Ollama base URL (default: `/ollama` via Vite proxy) |
| `VITE_MODEL_SCOUT` | No | Override Scout's local model |
| `VITE_MODEL_CURATOR` | No | Override Curator's local model |
| `VITE_MODEL_NARRATOR` | No | Override Narrator's local model |
| `VITE_MODEL_CONCIERGE` | No | Override Concierge's local model |
| `VITE_MODEL_REFLECTION` | No | Override Reflection Agent's local model |
