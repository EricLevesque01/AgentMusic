/**
 * TasteGraph — Local ReAct Agent
 *
 * Implements a proper tool-calling ReAct loop using Ollama's native
 * /api/chat tools API (no prompt injection, no framework needed).
 *
 * Architecture (from deep research):
 *   1. Send messages + tool schemas to /api/chat
 *   2. If response has message.tool_calls → execute the tool → append result → repeat
 *   3. If response has no tool_calls → return final text
 *
 * Works with any tool-calling capable model:
 *   qwen3:8b, hermes3:8b, gemma3-tools:4b, llama3.1:8b, mistral:7b
 *
 * Default tools available:
 *   - web_search: SearXNG local search
 *   - music_search: SearXNG music-specific search
 */

import { searchMusicWeb, searchWeb, isSearxngAvailable } from './searxng-api.js';
import { getModelForAgent, modelSupportsNativeTools } from './model-router.js';

// Re-export for consumers that want a single import point
export { isSearxngAvailable };


const OLLAMA_BASE_URL = import.meta.env?.VITE_OLLAMA_URL || '/ollama';

// ─────────────────────────────────────────────────────
// Built-in tool registry
// ─────────────────────────────────────────────────────

const BUILTIN_TOOLS = {
  /**
   * General web search via SearXNG
   */
  async web_search({ query, max_results = 5 }) {
    const results = await searchWeb(query, { maxResults: max_results });
    if (results.length === 0) return 'No results found. SearXNG may not be running.';
    return results.map((r, i) =>
      `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`
    ).join('\n\n');
  },

  /**
   * Music-specific search — biases toward music journalism, reviews, forums
   */
  async music_search({ query, recent = false }) {
    const results = await searchMusicWeb(query, { maxResults: 6, recent });
    if (results.length === 0) return 'No music search results. SearXNG may not be running.';
    return results.map((r, i) =>
      `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`
    ).join('\n\n');
  },
};

// ─────────────────────────────────────────────────────
// Tool schema declarations (Ollama/OpenAI format)
// ─────────────────────────────────────────────────────

export const SEARCH_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the public web for current facts, journalism, reviews, and discussions.',
      parameters: {
        type: 'object',
        properties: {
          query:       { type: 'string',  description: 'Search query' },
          max_results: { type: 'integer', description: 'Number of results (default 5)', default: 5 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'music_search',
      description: 'Search specifically for music journalism, artist bios, reviews (Pitchfork, RateYourMusic, AllMusic), and forum discussions (Reddit r/listentothis, r/ifyoulikeblank).',
      parameters: {
        type: 'object',
        properties: {
          query:  { type: 'string',  description: 'Music-focused search query' },
          recent: { type: 'boolean', description: 'Restrict to past year results', default: false },
        },
        required: ['query'],
      },
    },
  },
];

// ─────────────────────────────────────────────────────
// Core ReAct loop
// ─────────────────────────────────────────────────────

/**
 * Run a local agent with tool-calling support.
 *
 * @param {object} opts
 * @param {string}   opts.agentName    - Agent identifier for model routing ('scout', 'narrator', etc.)
 * @param {string}   opts.system       - System prompt
 * @param {string}   opts.user         - Initial user message
 * @param {Array}    opts.tools        - Tool schema objects (default: SEARCH_TOOL_SCHEMAS)
 * @param {object}   opts.toolRegistry - { toolName: async fn } map (default: BUILTIN_TOOLS)
 * @param {number}   opts.maxSteps     - Max tool-call iterations before giving up (default 6)
 * @param {object}   opts.formatSchema - Optional JSON schema for structured output
 * @param {Function} opts.onThought    - Optional callback for streaming reasoning steps
 * @returns {Promise<{ content: string, messages: Array, toolCallCount: number }>}
 */
export async function runLocalAgent({
  agentName = 'default',
  system,
  user,
  tools = SEARCH_TOOL_SCHEMAS,
  toolRegistry = BUILTIN_TOOLS,
  maxSteps = 6,
  formatSchema = null,
  onThought = null,
} = {}) {
  const model = getModelForAgent(agentName);
  const supportsNativeTools = modelSupportsNativeTools(model);

  if (!supportsNativeTools) {
    // Fall back to the legacy prompt-injection path for models without native tool support
    return _runWithPromptInjection({ model, system, user, tools, toolRegistry, maxSteps, onThought });
  }

  const messages = [
    { role: 'system', content: system },
    { role: 'user',   content: user },
  ];

  let toolCallCount = 0;

  for (let step = 0; step < maxSteps; step++) {
    const body = {
      model,
      stream: false,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(formatSchema ? { format: formatSchema } : {}),
      options: { temperature: 0.3 },
    };

    if (onThought && step > 0) onThought(`Local agent (${model}): processing tool results...`);

    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ollama error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data    = await res.json();
    const message = data.message;
    messages.push(message);

    // No tool calls → final answer
    if (!message.tool_calls?.length) {
      return {
        content:       message.content || '',
        messages,
        toolCallCount,
        model,
      };
    }

    // Execute each tool call and append results
    for (const call of message.tool_calls) {
      const toolName = call.function?.name;
      const toolArgs = call.function?.arguments ?? {};
      const fn = toolRegistry[toolName];

      if (!fn) {
        console.warn(`LocalAgent: unknown tool "${toolName}"`);
        messages.push({ role: 'tool', content: `Error: unknown tool "${toolName}"` });
        continue;
      }

      toolCallCount++;
      if (onThought) onThought(`Local agent: searching → ${toolName}("${JSON.stringify(toolArgs).slice(0, 80)}")`);

      try {
        const result = await fn(toolArgs);
        messages.push({ role: 'tool', content: typeof result === 'string' ? result : JSON.stringify(result) });
      } catch (err) {
        messages.push({ role: 'tool', content: `Tool error: ${err.message}` });
      }
    }
  }

  throw new Error(`LocalAgent: max steps (${maxSteps}) exceeded without final answer`);
}

// ─────────────────────────────────────────────────────
// Legacy fallback: prompt-injection tool "calling"
// Used for models without native tool support (e.g. gemma3:4b)
// ─────────────────────────────────────────────────────

async function _runWithPromptInjection({ model, system, user, tools, toolRegistry, maxSteps, onThought }) {
  const toolSchemas = tools.map(t => ({
    name: t.function?.name,
    description: t.function?.description,
    parameters: t.function?.parameters,
  }));

  const injectedSystem = tools.length > 0
    ? `${system}\n\nYou have access to these tools:\n${JSON.stringify(toolSchemas, null, 2)}\n\nTo use a tool, respond with ONLY:\n{"tool_call": {"name": "tool_name", "args": {...}}}\nOtherwise respond normally.`
    : system;

  const messages = [
    { role: 'system', content: injectedSystem },
    { role: 'user',   content: user },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model, stream: false, messages, options: { temperature: 0.3 } }),
    });

    const data  = await res.json();
    const reply = data.message?.content || '';
    messages.push({ role: 'assistant', content: reply });

    // Check for tool call pattern
    try {
      const trimmed = reply.trim();
      const jsonStr = trimmed.startsWith('{') ? trimmed
        : (trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || [])[1];

      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        if (parsed.tool_call) {
          const { name, args } = parsed.tool_call;
          const fn = toolRegistry[name];
          if (fn) {
            if (onThought) onThought(`Local agent: searching → ${name}`);
            const result = await fn(args || {});
            messages.push({ role: 'user', content: `Tool result for ${name}:\n${result}` });
            continue;
          }
        }
      }
    } catch { /* not a tool call */ }

    return { content: reply, messages, toolCallCount: step, model };
  }

  return { content: '', messages, toolCallCount: maxSteps, model };
}

/**
 * Convenience: run Scout-style web-grounded discovery for a set of seed artists.
 * Returns formatted search findings ready to feed into the Curator.
 */
export async function runScoutWebSearch(seedArtists, sessionIntent, onThought = null) {
  const names = seedArtists.slice(0, 4).map(a => a.name).join(', ');

  return runLocalAgent({
    agentName: 'scout',
    system: `You are a music discovery Scout. Search the web to find non-obvious artist connections, recent critical buzz, and scene relationships. Always use the music_search tool to ground your findings in real sources. Be specific — cite artist names, album titles, producer credits, and publications.`,
    user: `The user's top artists are: ${names}
Their session intent: "${sessionIntent || 'discover something new'}"

Search for:
1. Producers or engineers who worked with these artists AND other artists
2. What music journalism says about artists in adjacent scenes right now
3. Forum recommendations (Reddit r/ifyoulikeblank, RateYourMusic) for fans of ${names}
4. Any recent (2024-2025) releases that critics compare to these artists

Return a list of 6-8 discovered artists with specific connection reasons.`,
    tools: SEARCH_TOOL_SCHEMAS,
    maxSteps: 8,
    onThought,
  });
}
