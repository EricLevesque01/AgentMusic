# TasteGraph (AgentMusic) Design Architecture

## LLM Model Routing Strategy

To optimize for both speed/cost and complex reasoning capabilities, the Agentic Pipeline routes tasks to different LLM tiers based on the cognitive load required.

### `fast` Tier (e.g., Gemini 2.0 Flash)
Used for tasks requiring rapid classification, structured data extraction, and formatting.

1. **Concierge Agent (Intent Parsing):**
   - **Task:** Converts natural language chat messages into structured tool calls (`adjust_sliders`, `boost_genre`, etc.).
   - **Why Fast:** This is a bounded classification problem. Smaller models excel at picking from a predefined list of tools and extracting arguments quickly, making the chat interface feel responsive.

2. **Narrator Agent (Track Explanations):**
   - **Task:** Generates a 1-sentence explanation for each track in the final playlist.
   - **Why Fast:** The heavy lifting of track selection is already complete. The model is simply formatting structured input (genres, artist names, sources) into a human-readable sentence array.

### `reasoning` Tier (e.g., Gemini 1.5 Pro)
Used for tasks requiring multi-step planning, complex constraints, and creative synthesis.

1. **Curator Agent (ReAct Loop):**
   - **Task:** Actively researches artists, fetches Spotify tracks, and iteratively builds a cohesive 10-track playlist based on the user's taste and session intent.
   - **Why Reasoning:** This requires maintaining state across multiple loops, evaluating tool outputs, and adhering strictly to complex rules (e.g., discovery vs. familiarity ratios). Small models typically fail at this level of context retention and multi-step execution.

2. **Narrator Agent (Sonic Dossier):**
   - **Task:** Writes a 3-4 paragraph "Musical Vibe" breakdown analyzing the user's taste with deep cultural context.
   - **Why Reasoning:** This requires high-level creative writing, a specific metaphorical tone (the "music historian best friend"), and synthesizing raw Wikipedia facts into a compelling narrative. Fast models often sound generic or robotic here.

## API Wrapper Integration
The `callWithTools` function in `gemini-api.js` has been updated to accept a `modelTier` parameter (`'fast'` or `'reasoning'`). The system automatically routes the request to the appropriate model, ensuring optimal performance without changing the underlying agent logic.
