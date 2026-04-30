/**
 * TasteGraph — LLM API Wrapper
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
const LLM_BACKEND = import.meta.env?.VITE_LLM_BACKEND || 'gemini'; // 'gemini' or 'ollama'
const OLLAMA_BASE_URL = import.meta.env?.VITE_OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env?.VITE_OLLAMA_MODEL || 'llama3.1';

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
 * @returns {{ functionCalls, textReply }}
 */
export async function callWithTools(systemPrompt, messages, toolDeclarations = [], modelTier = 'fast', useWebSearch = false) {
  if (LLM_BACKEND === 'ollama') {
    return _callOllama(systemPrompt, messages, toolDeclarations, modelTier);
  }
  return _callGemini(systemPrompt, messages, toolDeclarations, modelTier, useWebSearch);
}

// --- Gemini Backend ---

async function _callGemini(systemPrompt, messages, toolDeclarations, modelTier, useWebSearch) {
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
      maxOutputTokens: modelTier === 'reasoning' ? 4096 : 2048,
    },
  };

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

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
}

// --- Ollama Backend ---

async function _callOllama(systemPrompt, messages, toolDeclarations, modelTier) {
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

  // If there are tool declarations, instruct the model to output JSON matching the tool schema
  if (toolDeclarations.length > 0) {
    const toolNames = toolDeclarations.map(t => t.name);
    const toolSchemas = toolDeclarations.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    ollamaMessages[0].content += `\n\nYou have access to the following tools:\n${JSON.stringify(toolSchemas, null, 2)}\n\nTo use a tool, respond with ONLY a JSON object in this exact format:\n{"tool_call": {"name": "tool_name", "args": {...}}}\n\nIf you want to respond with text only (no tool), just write your response normally.\nAvailable tools: ${toolNames.join(', ')}`;
  }

  const body = {
    model: OLLAMA_MODEL,
    messages: ollamaMessages,
    stream: false,
    options: {
      temperature: 0.7,
      num_predict: modelTier === 'reasoning' ? 4096 : 2048,
    },
  };

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Ollama error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const reply = data.message?.content || '';

  // Try to parse tool calls from the response
  const functionCalls = [];
  try {
    // Check if the response is a JSON tool call
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
