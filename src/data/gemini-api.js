/**
 * TasteGraph — Gemini API Wrapper
 * Powers the Concierge Agent with function-calling for intent parsing.
 *
 * Model: gemini-2.0-flash (free tier, 15 RPM)
 * API Key from EchoDJ project: AIzaSyDpa2Gq6KeFiUUxO2a_zNctLMZlA9HnyuU
 */

const GEMINI_API_KEY = 'AIzaSyDpa2Gq6KeFiUUxO2a_zNctLMZlA9HnyuU';
const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Send a chat message to Gemini with optional function declarations.
 * @param {string}   systemPrompt
 * @param {Array}    messages          - { role: 'user'|'model', parts: [{text}] }[]
 * @param {Array}    toolDeclarations  - Gemini function declarations
 * @returns {{ functionCalls, textReply }}
 */
export async function callWithTools(systemPrompt, messages, toolDeclarations = []) {
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: messages,
    tools: toolDeclarations.length
      ? [{ function_declarations: toolDeclarations }]
      : undefined,
    generationConfig: {
      temperature:     0.7,
      maxOutputTokens: 512,
    },
  };

  const response = await fetch(GEMINI_URL, {
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
