/**
 * TasteGraph — Gemini API Wrapper
 * Powers the Concierge Agent with function-calling for intent parsing.
 *
 */
const GEMINI_API_KEY = import.meta.env?.VITE_GEMINI_API_KEY;
const MODELS = {
  fast: 'gemini-2.5-flash',       // Chat, intent parsing, session summaries
  reasoning: 'gemini-2.5-pro'     // Curator ReAct loop, profile analysis
};

/**
 * Send a chat message to Gemini with optional function declarations.
 * @param {string}   systemPrompt
 * @param {Array}    messages          - { role: 'user'|'model', parts: [{text}] }[]
 * @param {Array}    toolDeclarations  - Gemini function declarations
 * @param {string}   modelTier         - 'fast' (default) or 'reasoning'
 * @param {boolean}  useWebSearch      - Whether to enable Google Search grounding
 * @returns {{ functionCalls, textReply }}
 */
export async function callWithTools(systemPrompt, messages, toolDeclarations = [], modelTier = 'fast', useWebSearch = false) {
  const modelName = MODELS[modelTier] || MODELS.fast;
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
      maxOutputTokens: toolDeclarations.length > 0 ? 2048 : 512,
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
