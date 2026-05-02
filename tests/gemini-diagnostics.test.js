import { describe, it, expect } from 'vitest';

/**
 * Agentic Discovery — Gemini Diagnostic Evaluation
 *
 * Same diagnostic framework as discovery-diagnostics.test.js, but uses:
 *   - Gemini Flash as GENERATOR (tests the actual production model)
 *   - Gemini Flash as JUDGE (higher quality evaluation)
 *   - Web search grounding (tests the real agentic search path)
 *
 * Also evaluates the IMPROVED scheduler seeds (post-diagnostic fix).
 *
 * Run with: RUN_GEMINI_JUDGE=1 npx vitest run tests/gemini-diagnostics.test.js
 * Requires: VITE_GEMINI_API_KEY in environment.
 *
 * Cost estimate: ~$0.05-0.10 total (well within $10 budget)
 */

const API_KEY = process.env.VITE_GEMINI_API_KEY;
const SKIP = !API_KEY || !process.env.RUN_GEMINI_JUDGE;
const MODEL = 'gemini-2.0-flash';

/**
 * Call Gemini Flash directly.
 */
async function geminiGenerate(systemPrompt, userMessage, { maxTokens = 1024, useWebSearch = false } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
  };

  if (useWebSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  // Retry with exponential backoff for rate limiting
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
      console.log(`  ⏳ Retry ${attempt}/3 after ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 503 || res.status === 429) {
      if (attempt < 3) continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}

/**
 * Multi-dimension diagnostic judge using Gemini.
 */
async function diagnosticJudge(text, dimensions) {
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

  const reply = await geminiGenerate(
    'You are a strict evaluator. Be specific and honest. No flattery. Score 3 means adequate, not bad.',
    prompt,
    { maxTokens: 1500 }
  );

  const cleaned = reply.replace(/```json|```/g, '').trim();
  try {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return JSON.parse(cleaned);
  } catch {
    console.error('Gemini Judge parse error:', cleaned.slice(0, 500));
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC 1: WEB-GROUNDED SCOUT (the real agentic test)
// This is the KEY difference vs Ollama — Gemini can actually search
// ═══════════════════════════════════════════════════════════════

const SCOUT_DIMENSIONS = [
  { name: 'Factual Grounding', description: 'Are the claims verifiable? Does it cite real producers, labels, reviews, or forum posts? Do the sources appear to be from real web results?' },
  { name: 'Non-Obviousness', description: 'Would a casual fan already know these connections? True discovery surprises even knowledgeable listeners.' },
  { name: 'Spotify Resolvability', description: 'Are all recommended artists real and findable on Spotify?' },
  { name: 'Source Diversity', description: 'Does the output draw from MULTIPLE types of sources (reviews, forums, production credits, scene history)? Or is it all from one type?' },
  { name: 'Recency', description: 'Does the output reference recent events, releases, or reviews (2024-2026)? Or only historical facts?' },
];

describe.skipIf(SKIP)('Gemini Diagnostic — Web-Grounded Scout', () => {
  it('evaluates scout with REAL web search grounding', async () => {
    const scoutOutput = await geminiGenerate(
      'You are a music discovery expert. Use your search results to find NON-OBVIOUS connections.',
      `The user's top artists are: Radiohead, Björk, Aphex Twin.
Their genres: art rock, electronic, experimental.

Search the web to find 5 artists the user might not know by looking for:
1. Shared producers or engineers (who engineered their albums?)
2. Artists from the same local scene or movement
3. Recent critical acclaim in adjacent genres (2024-2026 reviews)
4. Forum recommendations (Reddit, RateYourMusic threads)

For each artist, give a specific CONNECTION REASON explaining the non-obvious link.
Cite your sources when possible.
Format as a numbered list: "Artist Name — Reason"`,
      { maxTokens: 1000, useWebSearch: true }
    );

    console.log('\n═══ WEB-GROUNDED SCOUT OUTPUT (Gemini) ═══\n', scoutOutput);

    const diagnostics = await diagnosticJudge(scoutOutput, SCOUT_DIMENSIONS);

    console.log('\n═══ SCOUT DIAGNOSTICS (Gemini) ═══');
    let totalScore = 0;
    for (const d of diagnostics) {
      totalScore += d.score || 0;
      console.log(`\n[${d.dimension}] Score: ${d.score}/5`);
      console.log(`  ✅ Works: ${d.what_works}`);
      console.log(`  ❌ Fails: ${d.what_fails}`);
      console.log(`  💡 Improve: ${d.how_to_improve}`);
    }
    console.log(`\n📊 Average: ${(totalScore / (diagnostics.length || 1)).toFixed(1)}/5`);

    expect(diagnostics.length).toBeGreaterThanOrEqual(3);
  }, 120000);
});

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC 2: IMPROVED SCHEDULER SEEDS (post-fix evaluation)
// ═══════════════════════════════════════════════════════════════

const SEED_DIMENSIONS = [
  { name: 'Emotional Specificity', description: 'Does it evoke a specific feeling/scenario? "Late night" is generic; "3am insomnia, staring at the ceiling" is specific.' },
  { name: 'User Model Integration', description: 'Does it reference specific artist names, genres, or user preferences? Or could it apply to anyone?' },
  { name: 'Playlist Potential', description: 'Would this seed produce a coherent, interesting 12-track playlist? Or is it too vague/narrow?' },
];

describe.skipIf(SKIP)('Gemini Diagnostic — Improved Scheduler Seeds', () => {
  it('evaluates the FIXED seeds (v2) vs the old seeds (v1)', async () => {
    // OLD seeds (what we had before — the ones that scored 1.8/5 avg)
    const v1Seeds = [
      { seed: 'Smooth, atmospheric, and emotionally warm — acoustic intimacy', type: 'dimension_v1' },
      { seed: "Deep dive into jazz — you've been gravitating here", type: 'drift_v1' },
      { seed: "Explore electronic — a genre you haven't fully explored yet", type: 'coverage_gap_v1' },
      { seed: 'Evening unwind — warm, contemplative, rich textures', type: 'temporal_v1' },
    ];

    // NEW seeds (after the fix — inject real artist/genre data)
    const v2Seeds = [
      { seed: 'The contemplative side of Radiohead — acoustic intimacy, soft piano, and late-night warmth in the vein of alternative rock', type: 'dimension_v2' },
      { seed: "Your jazz awakening — following the thread from Miles Davis and John Coltrane. You've been gravitating here in recent sessions — let's go deeper into the subgenres and scenes you haven't found yet", type: 'drift_v2' },
      { seed: "Your alternative rock ear might love the electronic world — artists who share the DNA of Radiohead but operate in electronic. Think cross-pollination, not genre tourism", type: 'coverage_gap_v2' },
      { seed: "Evening wind-down — the warm, contemplative textures of Radiohead and rich alternative rock sounds for unwinding after dark", type: 'temporal_v2' },
    ];

    console.log('\n═══ SEED COMPARISON: v1 (old) vs v2 (improved) ═══\n');

    const allResults = [];
    for (const { seed, type } of [...v1Seeds, ...v2Seeds]) {
      const diagnostics = await diagnosticJudge(seed, SEED_DIMENSIONS);
      const avg = diagnostics.reduce((s, d) => s + (d.score || 0), 0) / (diagnostics.length || 1);
      allResults.push({ type, seed: seed.slice(0, 60), avg, diagnostics });

      const version = type.includes('v1') ? '❌ OLD' : '✅ NEW';
      console.log(`\n${version} [${type}] "${seed.slice(0, 70)}..."`);
      console.log(`  📊 Avg: ${avg.toFixed(1)}/5`);
      for (const d of diagnostics) {
        console.log(`    ${d.dimension}: ${d.score}/5${d.score <= 3 ? ' ⚠️ ' + d.how_to_improve : ''}`);
      }
    }

    // Compare v1 vs v2 averages
    const v1Avg = allResults.filter(r => r.type.includes('v1')).reduce((s, r) => s + r.avg, 0) / v1Seeds.length;
    const v2Avg = allResults.filter(r => r.type.includes('v2')).reduce((s, r) => s + r.avg, 0) / v2Seeds.length;
    const improvement = v2Avg - v1Avg;

    console.log(`\n══════════════════════════════════`);
    console.log(`📊 v1 (old) average: ${v1Avg.toFixed(1)}/5`);
    console.log(`📊 v2 (new) average: ${v2Avg.toFixed(1)}/5`);
    console.log(`📈 Improvement: +${improvement.toFixed(1)} points`);
    console.log(`══════════════════════════════════`);

    // v2 should be meaningfully better
    expect(v2Avg).toBeGreaterThan(v1Avg);
  }, 300000);
});

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC 3: E2E WITH WEB SEARCH (the full agentic pipeline)
// ═══════════════════════════════════════════════════════════════

const E2E_DIMENSIONS = [
  { name: 'Artist Authenticity', description: 'Are ALL artists real? Hallucinated artists are critical failures.' },
  { name: 'Discovery Novelty', description: 'Would these surprise someone who already uses Spotify similar-artists? Do any come from recent web sources?' },
  { name: 'Connection Depth', description: 'Are reasons substantive? Do they cite production credits, scene context, or recent reviews?' },
  { name: 'Web-Sourced Insights', description: 'Does the output contain information that could ONLY come from searching the web (recent reviews, 2024+ releases, current forum discussions)? Or is it all from training data?' },
  { name: 'Intent Fidelity', description: 'Does every recommendation fit the stated intent? Are there off-topic picks?' },
];

describe.skipIf(SKIP)('Gemini Diagnostic — E2E with Web Search', () => {
  it('evaluates web-grounded discovery vs static knowledge', async () => {
    // Generate WITH web search
    const webOutput = await geminiGenerate(
      `You are TasteGraph, a music discovery AI. You speak like the user's most knowledgeable music friend. Never say "diverse mix" or "eclectic taste."`,
      `A user loves Radiohead, Portishead, and Massive Attack. They want "something like early trip-hop but with a modern edge."

Search the web to find 6 recommendations. For each:
1. Artist - Track (must be real)
2. Why it connects to their taste (production/sonic parallels)
3. What makes it a discovery (cite your source: a review, forum post, or article)

Prioritize: recent releases (2024-2026), artists under 500K monthly Spotify listeners, and connections from real music journalism.`,
      { maxTokens: 1200, useWebSearch: true }
    );

    console.log('\n═══ WEB-GROUNDED E2E OUTPUT ═══\n', webOutput);

    const diagnostics = await diagnosticJudge(webOutput, E2E_DIMENSIONS);

    console.log('\n═══ E2E DIAGNOSTICS (Gemini + Web Search) ═══');
    let totalScore = 0;
    const weakest = { score: 6, dim: '' };
    const strongest = { score: 0, dim: '' };

    for (const d of diagnostics) {
      const s = d.score || 0;
      totalScore += s;
      if (s < weakest.score) { weakest.score = s; weakest.dim = d.dimension; }
      if (s > strongest.score) { strongest.score = s; strongest.dim = d.dimension; }

      console.log(`\n[${d.dimension}] Score: ${s}/5`);
      console.log(`  ✅ Works: ${d.what_works}`);
      console.log(`  ❌ Fails: ${d.what_fails}`);
      console.log(`  💡 Improve: ${d.how_to_improve}`);
    }

    const avgScore = totalScore / (diagnostics.length || 1);
    console.log(`\n📊 Average: ${avgScore.toFixed(1)}/5`);
    console.log(`🏆 Strongest: ${strongest.dim} (${strongest.score}/5)`);
    console.log(`⚠️  Weakest:  ${weakest.dim} (${weakest.score}/5)`);
  }, 180000);
});

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC 4: AGENTIC CAPABILITY — Does it search diverse sources?
// ═══════════════════════════════════════════════════════════════

const AGENTIC_DIMENSIONS = [
  { name: 'Source Count', description: 'How many DISTINCT source types are referenced? (music reviews, forums, databases, news, interviews, social media). Score 5 = 5+ source types.' },
  { name: 'Insight Originality', description: 'Are the insights things you could NOT get from Spotify\'s API? (e.g., "this artist just got a 9.0 on Pitchfork" or "trending on r/listentothis this week")' },
  { name: 'Temporal Awareness', description: 'Does it reference CURRENT events (2025-2026)? Score 5 = multiple recent references. Score 1 = only historical knowledge.' },
  { name: 'Cross-Source Synthesis', description: 'Does it combine information from multiple sources into a coherent insight? Or just list facts from one source at a time?' },
];

describe.skipIf(SKIP)('Gemini Diagnostic — Agentic Search Capability', () => {
  it('evaluates breadth and depth of web-grounded research', async () => {
    const researchOutput = await geminiGenerate(
      'You are a music research agent. Search broadly across diverse sources.',
      `Research the current state of the trip-hop revival. The user loves classic trip-hop (Portishead, Massive Attack, Tricky) and wants to know:

1. Which NEW artists (2024-2026) are carrying the torch? Search for recent reviews and articles.
2. What are Reddit and music forum communities saying about modern trip-hop?
3. Are there any recent albums that critics have compared to Dummy or Mezzanine?
4. Which producers from the original scene are still active or mentoring new artists?

Cite your sources. Be specific about where each piece of information comes from.`,
      { maxTokens: 1500, useWebSearch: true }
    );

    console.log('\n═══ AGENTIC RESEARCH OUTPUT ═══\n', researchOutput);

    const diagnostics = await diagnosticJudge(researchOutput, AGENTIC_DIMENSIONS);

    console.log('\n═══ AGENTIC CAPABILITY DIAGNOSTICS ═══');
    for (const d of diagnostics) {
      console.log(`\n[${d.dimension}] Score: ${d.score}/5`);
      console.log(`  ✅ Works: ${d.what_works}`);
      console.log(`  ❌ Fails: ${d.what_fails}`);
      console.log(`  💡 Improve: ${d.how_to_improve}`);
    }

    const avg = diagnostics.reduce((s, d) => s + (d.score || 0), 0) / (diagnostics.length || 1);
    console.log(`\n📊 Agentic Capability Score: ${avg.toFixed(1)}/5`);
  }, 180000);
});
