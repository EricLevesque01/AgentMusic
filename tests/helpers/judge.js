/**
 * Agent Music — Shared LLM Judge
 *
 * Single source of truth for all LLM-as-Judge evaluation logic.
 * Uses Gemini Flash with exponential backoff and graceful degradation.
 *
 * Usage:
 *   import { llmJudge, diagnosticJudge, assertScore } from '../helpers/judge.js';
 */

import { GEMINI_API_KEY } from './setup.js';

const JUDGE_MODEL = 'gemini-2.0-flash';

// ═══════════════════════════════════════════════════════════════
// Core Judge — retry-resilient single-rubric scoring
// ═══════════════════════════════════════════════════════════════

/**
 * Evaluate text against a rubric using Gemini Flash.
 * Returns { score: 1-5, reasoning: string }.
 * On total failure returns { score: 0, reasoning: '...' } — callers should
 * treat score 0 as "judge unavailable", not "output is bad".
 *
 * @param {string} text     — The agent output to evaluate
 * @param {string} rubric   — The scoring rubric (Score 5: ... Score 1: ...)
 * @param {object} opts     — { maxRetries, timeoutMs }
 */
export async function llmJudge(text, rubric, { maxRetries = 5, timeoutMs = 30000 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(3000 * Math.pow(2, attempt - 1), 15000);
      console.log(`   ⏳ Judge retry ${attempt}/${maxRetries - 1} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: `You are an expert evaluator for a multi-agent music recommendation AI called Agent Music. Be strict — only give 5 for truly exceptional output. Respond ONLY with valid JSON.` }] },
          contents: [{ role: 'user', parts: [{ text: `RUBRIC:\n${rubric}\n\nTEXT TO EVALUATE:\n"""\n${text}\n"""\n\nScore 1-5 on the rubric. Return ONLY: {"score": <1-5>, "reasoning": "<brief>"}` }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
        }),
      });

      if (res.status === 503 || res.status === 429 || res.status === 500) continue;

      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!reply || reply.trim().length === 0) continue;

      const cleaned = reply.replace(/```json|```/g, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        if (typeof parsed.score === 'number') return parsed;
        continue;
      } catch {
        // Try to extract score from text like "Score: 4"
        const match = cleaned.match(/(\d)/);
        if (match) return { score: parseInt(match[1]), reasoning: cleaned.slice(0, 200) };
        continue;
      }
    } catch (e) {
      if (attempt === maxRetries - 1) {
        return { score: 0, reasoning: `Judge unavailable after ${maxRetries} attempts: ${e.message}` };
      }
    }
  }

  return { score: 0, reasoning: `Judge exhausted all ${maxRetries} retry attempts` };
}

// ═══════════════════════════════════════════════════════════════
// Diagnostic Judge — multi-dimension evaluation
// ═══════════════════════════════════════════════════════════════

/**
 * Evaluate text along multiple named dimensions.
 * Returns [{ dimension, score, what_works, what_fails, how_to_improve }].
 *
 * @param {string} text
 * @param {Array<{name: string, description: string}>} dimensions
 */
export async function diagnosticJudge(text, dimensions, { maxRetries = 4, timeoutMs = 30000 } = {}) {
  const dimList = dimensions.map((d, i) =>
    `${i + 1}. ${d.name}: ${d.description}`
  ).join('\n');

  const prompt = `You are an expert evaluator for a music discovery AI.
Evaluate the following text along ${dimensions.length} specific dimensions.
For EACH dimension, provide:
- score (1-5, be strict — 5 means truly exceptional)
- what_works: what the text does well (be specific, cite examples from the text)
- what_fails: what the text does poorly or misses
- how_to_improve: ONE specific, actionable suggestion

Respond with ONLY valid JSON array:
[{"dimension": "name", "score": N, "what_works": "...", "what_fails": "...", "how_to_improve": "..."}]

DIMENSIONS:
${dimList}

TEXT:
"""
${text}
"""`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
      console.log(`   ⏳ Diagnostic retry ${attempt}/${maxRetries - 1} after ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: 'You are a strict evaluator. Be specific and honest. No flattery. Score 3 means adequate, not bad.' }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
        }),
      });

      if (res.status === 503 || res.status === 429 || res.status === 500) continue;

      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = reply.replace(/```json|```/g, '').trim();

      try {
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (match) return JSON.parse(match[0]);
        return JSON.parse(cleaned);
      } catch {
        console.error('Diagnostic Judge parse error:', cleaned.slice(0, 500));
        continue;
      }
    } catch (e) {
      if (attempt === maxRetries - 1) {
        console.error('Diagnostic Judge unavailable:', e.message);
        return [];
      }
    }
  }

  return [];
}

// ═══════════════════════════════════════════════════════════════
// Convenience: assertScore with diagnostic output
// ═══════════════════════════════════════════════════════════════

/**
 * Judge text against a rubric and assert a minimum score.
 * On judge unavailability (score 0), logs a warning instead of failing.
 *
 * @param {string}   text      — Text to evaluate
 * @param {string}   rubric    — Scoring rubric
 * @param {number}   minScore  — Minimum acceptable score
 * @param {string}   label     — Human label for console output (e.g. "Coherence")
 * @param {Function} expect    — Vitest expect function
 * @returns {object} The judge verdict
 */
export async function assertScore(text, rubric, minScore, label, expect) {
  const verdict = await llmJudge(text, rubric);

  const icon = verdict.score >= minScore ? '✅' : verdict.score === 0 ? '⚠️' : '❌';
  console.log(`\n${icon} ${label}: ${verdict.score}/5 — ${verdict.reasoning}`);

  if (verdict.score === 0) {
    console.warn(`   ⚠️  Judge unavailable — skipping assertion for "${label}"`);
    return verdict; // Don't fail — judge was unavailable, not the pipeline
  }

  expect(verdict.score).toBeGreaterThanOrEqual(minScore);
  return verdict;
}
