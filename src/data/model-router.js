/**
 * Agent Music — Model Router
 *
 * Maps each agent to its optimal local model based on deep research findings:
 *   - Qwen3 8B: best generalist for agentic/tool-calling tasks (Scout, Curator, Suggested Artists)
 *   - Hermes 3 8B: best creative voice for narrative writing (Narrator)
 *   - gemma3-tools 4B: best small specialist for classification/reflection (Concierge, Reflection)
 *   - gemma3 4B: universal fallback (already working in tests)
 *
 * Override any agent's model via environment variables.
 *
 * Setup (pull required models):
 *   ollama pull qwen3:8b          # ~5.2GB — Scout, Curator, Suggested Artists
 *   ollama pull hermes3:8b        # ~4.7GB — Narrator
 *   ollama pull gemma3-tools:4b   # ~3.3GB — Concierge, Reflection (community fine-tune)
 *   ollama pull gemma3:4b         # ~3.3GB — LLM Judge, universal fallback
 */

// Per-agent model assignments (research-backed defaults)
const AGENT_MODELS = {
  scout:      import.meta.env?.VITE_MODEL_SCOUT     || 'qwen3:8b',
  curator:    import.meta.env?.VITE_MODEL_CURATOR   || 'qwen3:8b',
  narrator:   import.meta.env?.VITE_MODEL_NARRATOR  || 'hermes3:8b',
  concierge:  import.meta.env?.VITE_MODEL_CONCIERGE || 'gemma3-tools:4b',
  suggested:  import.meta.env?.VITE_MODEL_SUGGESTED || 'qwen3:8b',
  reflection: import.meta.env?.VITE_MODEL_REFLECTION|| 'gemma3-tools:4b',
  judge:      import.meta.env?.VITE_MODEL_JUDGE     || 'gemma3:4b',
  // Fallback for any unregistered agent
  default:    import.meta.env?.VITE_OLLAMA_MODEL    || 'qwen3:8b',
};

// Capability tiers — what each model class can reliably do
export const MODEL_CAPABILITIES = {
  'qwen3:8b': {
    toolCalling: true,
    structuredOutput: true,
    webSearch: true,       // via SearXNG tool
    creativeVoice: 'good',
    notes: 'Best generalist for agentic tasks. MCP-aware.',
  },
  'hermes3:8b': {
    toolCalling: true,
    structuredOutput: true,
    webSearch: true,
    creativeVoice: 'excellent',
    notes: 'Best for long-form creative/narrative output. Strong roleplay coherence.',
  },
  'gemma3-tools:4b': {
    toolCalling: true,
    structuredOutput: true,
    webSearch: false,      // too small for grounded synthesis
    creativeVoice: 'basic',
    notes: 'Community fine-tune optimized for Ollama tool_calls parsing. Narrow tasks only.',
  },
  'gemma3:4b': {
    toolCalling: false,    // uses prompt-injection fallback
    structuredOutput: true,
    webSearch: false,
    creativeVoice: 'basic',
    notes: 'Universal fallback. Already proven in LLM judge tests.',
  },
};

/**
 * Get the optimal model name for a given agent.
 * @param {string} agentName - 'scout' | 'curator' | 'narrator' | 'concierge' | 'suggested' | 'reflection' | 'judge'
 * @returns {string} Ollama model name
 */
export function getModelForAgent(agentName) {
  return AGENT_MODELS[agentName] || AGENT_MODELS.default;
}

/**
 * Check if a model natively supports Ollama tool calling
 * (vs. the legacy prompt-injection fallback).
 */
export function modelSupportsNativeTools(modelName) {
  return MODEL_CAPABILITIES[modelName]?.toolCalling ?? false;
}

/**
 * Check if the current agent's model can do web-grounded synthesis.
 */
export function modelSupportsWebSearch(modelName) {
  return MODEL_CAPABILITIES[modelName]?.webSearch ?? false;
}

/**
 * List all configured agent→model mappings (for debug/status display).
 */
export function getModelSummary() {
  return Object.entries(AGENT_MODELS)
    .filter(([k]) => k !== 'default')
    .map(([agent, model]) => ({
      agent,
      model,
      capabilities: MODEL_CAPABILITIES[model] || { toolCalling: false, structuredOutput: false },
    }));
}
