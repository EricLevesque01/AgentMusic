/**
 * Agent Music — LLM API Wrapper
 * Supports Gemini (cloud) and Ollama (local) backends.
 *
 * Backend selection:
 *   - Set VITE_LLM_BACKEND=ollama in .env to use local Ollama
 *   - Default: gemini (cloud, requires VITE_GEMINI_API_KEY)
 *
 * Ollama setup:
 *   1. Install Ollama: https://ollama.com
 *   2. Pull a model: `ollama pull llama3.1` or `ollama pull qwen2.5`
 *   3. Set VITE_LLM_BACKEND=ollama and optionally VITE_OLLAMA_MODEL in .env
 *   4. Ollama must be running on http://localhost:11434
 */
const GEMINI_API_KEY = import.meta.env?.VITE_GEMINI_API_KEY;
const LLM_BACKEND    = import.meta.env?.VITE_LLM_BACKEND || 'gemini';
const OLLAMA_BASE_URL = import.meta.env?.VITE_OLLAMA_URL  || '/ollama';

import { getModelForAgent, modelSupportsNativeTools } from './model-router.js';

const GEMINI_MODELS = {
  fast: 'gemini-2.5-flash',       // Chat, intent parsing, session summaries
  reasoning: 'gemini-2.5-pro'     // Curator ReAct loop, profile analysis
};

/**
 * Send a chat message to the configured LLM with optional function declarations.
 * @param {string}   systemPrompt
 * @param {Array}    messages          - { role: 'user'|'model', parts: [{text}] }[]
 * @param {Array}    toolDeclarations  - Gemini function declarations
 * @param {string}   modelTier         - 'fast' (default) or 'reasoning'
 * @param {boolean}  useWebSearch      - Whether to enable Google Search grounding (Gemini only)
 * @param {string}   agentName         - Agent identifier for local model routing
 * @param {object}   formatSchema      - Optional JSON schema for Ollama structured output (ignored by Gemini)
 * @returns {{ functionCalls, textReply }}
 */
export async function callWithTools(systemPrompt, messages, toolDeclarations = [], modelTier = 'fast', useWebSearch = false, agentName = 'default', formatSchema = null) {
  if (LLM_BACKEND === 'ollama') {
    return _callOllama(systemPrompt, messages, toolDeclarations, modelTier, agentName, formatSchema);
  }
  return _callGemini(systemPrompt, messages, toolDeclarations, modelTier, useWebSearch, formatSchema);
}

// --- Gemini Backend ---

async function _callGemini(systemPrompt, messages, toolDeclarations, modelTier, useWebSearch, formatSchema = null) {
  const modelName = GEMINI_MODELS[modelTier] || GEMINI_MODELS.fast;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

  const toolsObj = [];
  if (toolDeclarations.length > 0) {
    toolsObj.push({ function_declarations: toolDeclarations });
  }
  if (useWebSearch) {
    toolsObj.push({ google_search: {} });
  }

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: messages,
    tools: toolsObj.length > 0 ? toolsObj : undefined,
    generationConfig: {
      temperature:     0.7,
      maxOutputTokens: 8192,
      ...(formatSchema && (!toolsObj || toolsObj.length === 0) ? { 
        responseMimeType: "application/json", 
        responseSchema: formatSchema 
      } : {})
    },
  };

  // Retry with exponential backoff for timeouts, rate limits, and server errors
  const MAX_RETRIES = 2;
  const BASE_DELAY_MS = 2000;
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(90000), // 90s timeout per attempt
      });

      // Retry on rate limit (429) or server errors (5xx)
      if (response.status === 429 || response.status >= 500) {
        const errBody = await response.json().catch(() => ({}));
        lastError = new Error(`Gemini API error (${response.status}): ${errBody.error?.message || response.statusText}`);
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`Gemini API ${response.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error: ${err.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const parts     = candidate?.content?.parts || [];

      const functionCalls = parts
        .filter(p => p.functionCall)
        .map(p => p.functionCall);

      const textReply = parts
        .filter(p => p.text)
        .map(p => p.text)
        .join('');

      return { functionCalls, textReply };

    } catch (err) {
      lastError = err;
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError' || err.message?.includes('timeout');
      if (isTimeout && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`Gemini API timeout — retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

// --- Ollama Backend ---

async function _callOllama(systemPrompt, messages, toolDeclarations, modelTier, agentName = 'default', formatSchema = null) {
  const model = getModelForAgent(agentName);
  const useNativeTools = modelSupportsNativeTools(model) && toolDeclarations.length > 0;

  // Convert Gemini message format → Ollama/OpenAI chat format
  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of messages) {
    const role = msg.role === 'model' ? 'assistant' : msg.role === 'tool' ? 'tool' : 'user';
    const text = msg.parts?.map(p => p.text || (p.functionResponse ? JSON.stringify(p.functionResponse) : '')).join('') || '';
    if (text) {
      ollamaMessages.push({ role, content: text });
    }
  }

  // Build the request body
  const body = {
    model,
    messages: ollamaMessages,
    stream: false,
    options: {
      temperature: 0.7,
      num_predict: modelTier === 'reasoning' ? 4096 : 2048,
    },
    // JSON schema constraint — enforces syntactically valid structured output.
    // Critical for Curator agent: eliminates malformed JSON failures.
    // Only applied when no tools are active (format + tools conflict in Ollama).
    ...(formatSchema && !useNativeTools ? { format: formatSchema } : {}),
  };

  if (useNativeTools) {
    // Use Ollama's native tool calling API (qwen3, hermes3, gemma3-tools, llama3.1)
    body.tools = toolDeclarations.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  } else if (toolDeclarations.length > 0) {
    // Legacy prompt-injection fallback for models without native tool support
    const toolSchemas = toolDeclarations.map(t => ({
      name: t.name, description: t.description, parameters: t.parameters,
    }));
    ollamaMessages[0].content += `\n\nYou have access to the following tools:\n${JSON.stringify(toolSchemas, null, 2)}\n\nTo use a tool, respond with ONLY a JSON object in this exact format:\n{"tool_call": {"name": "tool_name", "args": {...}}}\n\nIf you want to respond with text only (no tool), just write your response normally.\nAvailable tools: ${toolDeclarations.map(t => t.name).join(', ')}`;
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000), // 60s timeout — local models may be slower
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Ollama error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const reply = data.message?.content || '';

  // Try to parse tool calls from the response
  const functionCalls = [];

  // Path 1: Native Ollama tool calling (qwen3, hermes3, gemma3-tools)
  // Tool calls arrive in data.message.tool_calls, not in content text.
  if (data.message?.tool_calls?.length > 0) {
    for (const tc of data.message.tool_calls) {
      if (tc.function) {
        functionCalls.push({
          name: tc.function.name,
          args: tc.function.arguments || {},
        });
      }
    }
    if (functionCalls.length > 0) {
      return { functionCalls, textReply: reply };
    }
  }

  // Path 2: Legacy prompt-injection fallback — parse tool_call from content text
  try {
    const trimmed = reply.trim();
    if (trimmed.startsWith('{') && trimmed.includes('tool_call')) {
      const parsed = JSON.parse(trimmed);
      if (parsed.tool_call) {
        functionCalls.push({
          name: parsed.tool_call.name,
          args: parsed.tool_call.args || {},
        });
        return { functionCalls, textReply: '' };
      }
    }

    // Also check for JSON wrapped in markdown fences
    const fenceMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
      const parsed = JSON.parse(fenceMatch[1]);
      if (parsed.tool_call) {
        functionCalls.push({
          name: parsed.tool_call.name,
          args: parsed.tool_call.args || {},
        });
        return { functionCalls, textReply: '' };
      }
    }
  } catch (e) {
    // Not a tool call — treat as text reply
  }

  return { functionCalls, textReply: reply };
}
