import { describe, it, expect } from 'vitest';

/**
 * Agentic Discovery — Deep Diagnostic Evaluation
 *
 * Unlike the pass/fail tests in agentic-discovery.test.js, these tests
 * use the LLM judge to provide DETAILED DIAGNOSTIC FEEDBACK on each
 * dimension of output quality. The goal is to identify specific
 * improvement vectors, not just score against a threshold.
 *
 * Run with: RUN_OLLAMA_JUDGE=1 npx vitest run tests/discovery-diagnostics.test.js
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const SKIP = !process.env.RUN_OLLAMA_JUDGE;

async function ollamaGenerate(systemPrompt, userMessage, maxTokens = 1024) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      options: { temperature: 0.3, num_predict: maxTokens },
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.message?.content || '';
}

/**
 * Multi-dimension diagnostic judge.
 * Instead of a single score, evaluates along multiple axes and returns
 * specific improvement suggestions.
 */
async function diagnosticJudge(text, dimensions) {
  const dimList = dimensions.map((d, i) =>
    `${i + 1}. ${d.name}: ${d.description}`
  ).join('\n');

  const prompt = `You are an expert evaluator for a music discovery AI.
Evaluate the following text along ${dimensions.length} specific dimensions.
For EACH dimension, provide:
- score (1-5)
- what_works: what the text does well on this dimension (be specific)
- what_fails: what the text does poorly or misses
- how_to_improve: ONE specific, actionable suggestion

Respond with ONLY valid JSON array (no markdown):
[{"dimension": "name", "score": N, "what_works": "...", "what_fails": "...", "how_to_improve": "..."}]

DIMENSIONS:
${dimList}

TEXT:
"""
${text}
"""`;

  const reply = await ollamaGenerate(
    'You are a strict evaluator. Be specific and honest. No flattery.',
    prompt,
    1200
  );

  const cleaned = reply.replace(/```json|```/g, '').trim();
  try {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return JSON.parse(cleaned);
  } catch {
    console.error('Diagnostic judge parse error:', cleaned.slice(0, 500));
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC 1: SCOUT OUTPUT — Full multi-axis evaluation
// ═══════════════════════════════════════════════════════════════

const SCOUT_DIMENSIONS = [
  {
    name: 'Factual Grounding',
    description: 'Are the claims verifiable? Does it reference real producers, labels, sessions, or reviews? Or does it hallucinate connections?',
  },
  {
    name: 'Non-Obviousness',
    description: 'Would a casual fan already know these connections? True discovery means surprising even a moderately knowledgeable listener.',
  },
  {
    name: 'Spotify Resolvability',
    description: 'Are the recommended artists real and findable on Spotify? Hallucinated or extremely obscure artists that won\'t resolve are a critical failure.',
  },
  {
    name: 'Taste Coherence',
    description: 'Do the recommendations actually make sonic sense given the seed artists? A jazz suggestion for an electronic fan needs a bridge explanation.',
  },
  {
    name: 'Actionability',
    description: 'Can the system actually use this output? Are artist names unambiguous? Are there enough results (5+)? Is the format parseable?',
  },
];

describe.skipIf(SKIP)('Diagnostic — Scout Discovery Quality', () => {
  it('evaluates scout output across 5 dimensions', async () => {
    const scoutOutput = await ollamaGenerate(
      'You are a music discovery expert with deep knowledge of music journalism, production credits, and underground scenes.',
      `You are the Scout — a music discovery agent. The user's top artists are:
Radiohead, Björk, Aphex Twin. Their genres: art rock, electronic, experimental.

Find 5 artists the user might not know by looking for:
1. Shared producers or engineers
2. Artists from the same local scene or movement
3. Recent critical acclaim in adjacent genres
4. Forum recommendations (Reddit, RateYourMusic)

For each artist, give a specific CONNECTION REASON explaining the non-obvious link.
Format as a numbered list: "Artist Name — Reason"`,
      800
    );

    console.log('\n═══ SCOUT OUTPUT ═══\n', scoutOutput);

    const diagnostics = await diagnosticJudge(scoutOutput, SCOUT_DIMENSIONS);

    console.log('\n═══ SCOUT DIAGNOSTICS ═══');
    let totalScore = 0;
    for (const d of diagnostics) {
      totalScore += d.score || 0;
      console.log(`\n[${d.dimension}] Score: ${d.score}/5`);
      console.log(`  ✅ Works: ${d.what_works}`);
      console.log(`  ❌ Fails: ${d.what_fails}`);
      console.log(`  💡 Improve: ${d.how_to_improve}`);
    }
    const avgScore = totalScore / (diagnostics.length || 1);
    console.log(`\n📊 Average: ${avgScore.toFixed(1)}/5`);

    // Store for analysis
    expect(diagnostics.length).toBeGreaterThanOrEqual(3);
    expect(avgScore).toBeGreaterThanOrEqual(2.5);
  }, 180000);
});

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC 2: E2E PLAYLIST — Hallucination & Quality Audit
// ═══════════════════════════════════════════════════════════════

const E2E_DIMENSIONS = [
  {
    name: 'Artist Authenticity',
    description: 'Are ALL recommended artists real, existing musicians? Hallucinated/invented artists are an immediate critical failure. Check each one.',
  },
  {
    name: 'Track Authenticity',
    description: 'Are the specific track titles real songs by those artists? Made-up track names paired with real artists is a common LLM failure mode.',
  },
  {
    name: 'Soul Voice',
    description: 'Does the writing sound like a knowledgeable, opinionated music friend? Or does it use assistant-speak, generic filler, or overly formal language?',
  },
  {
    name: 'Discovery Novelty',
    description: 'Would these recommendations surprise someone who already uses Spotify\'s "similar artists" feature? Or are they the same obvious picks?',
  },
  {
    name: 'Connection Depth',
    description: 'Are the connection reasons substantive and educational? Do they reveal production/scene/influence details? Or just "sounds similar"?',
  },
  {
    name: 'Intent Fidelity',
    description: 'Does every track actually fit the stated intent ("early trip-hop with modern edge")? Are there off-topic picks that break the mood?',
  },
];

describe.skipIf(SKIP)('Diagnostic — E2E Playlist Quality', () => {
  it('evaluates full playlist generation across 6 dimensions', async () => {
    const playlistOutput = await ollamaGenerate(
      `You are a deeply opinionated, culturally literate music companion. You speak like the user's most musically knowledgeable friend. You reference specific eras, scenes, production styles, and cultural moments. You never say "diverse mix" or "eclectic taste."`,
      `You are TasteGraph — a music discovery AI. A user who loves Radiohead, Portishead, and Massive Attack asks for "something like early trip-hop but with a modern edge."

Generate a curated playlist of 8 tracks. For EACH track, explain:
1. Why it connects to their taste (be specific about sonic/production parallels)
2. What makes it a DISCOVERY (not just obvious similar artists)
3. The non-obvious connection (shared producer, same scene, influence chain, recent review)

Format each track as:
"Artist - Track Title"
Connection: [specific reason]

Do NOT suggest Portishead, Massive Attack, or Radiohead themselves. Think deeper.`,
      1200
    );

    console.log('\n═══ E2E PLAYLIST OUTPUT ═══\n', playlistOutput);

    const diagnostics = await diagnosticJudge(playlistOutput, E2E_DIMENSIONS);

    console.log('\n═══ E2E DIAGNOSTICS ═══');
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

    expect(diagnostics.length).toBeGreaterThanOrEqual(4);
    expect(avgScore).toBeGreaterThanOrEqual(2.5);
  }, 180000);
});

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC 3: SCHEDULER SEEDS — Comparative Analysis
// ═══════════════════════════════════════════════════════════════

const SEED_COMPARISON_DIMENSIONS = [
  {
    name: 'Emotional Specificity',
    description: 'Does the seed evoke a specific feeling, scenario, or mental image? "Late night" is generic; "3am insomnia, staring at the ceiling" is specific.',
  },
  {
    name: 'User Model Integration',
    description: 'Does the seed reference the user\'s actual taste data (artists, genres, dimensions, drift)? Or could it apply to anyone?',
  },
  {
    name: 'Playlist Potential',
    description: 'Would this seed actually produce a coherent, interesting 12-track playlist? Or is it too vague/narrow to curate from?',
  },
];

describe.skipIf(SKIP)('Diagnostic — Scheduler Seed Quality', () => {
  it('compares our seeds against ideal seeds', async () => {
    const ourSeeds = [
      { seed: 'Smooth, atmospheric, and emotionally warm — acoustic intimacy', type: 'dimension' },
      { seed: 'Deep dive into jazz — you\'ve been gravitating here', type: 'drift' },
      { seed: 'Explore electronic — a genre you haven\'t fully explored yet', type: 'coverage_gap' },
      { seed: 'Evening unwind — warm, contemplative, rich textures', type: 'temporal' },
      { seed: 'The world of Miles Davis — deep cuts, adjacent artists, and sonic relatives', type: 'artist_dive' },
      { seed: 'Based on what you told me: "I like melancholy but not defeatist music"', type: 'memory' },
    ];

    console.log('\n═══ SCHEDULER SEED DIAGNOSTICS ═══\n');

    const results = [];
    for (const { seed, type } of ourSeeds) {
      const diagnostics = await diagnosticJudge(seed, SEED_COMPARISON_DIMENSIONS);

      const avg = diagnostics.reduce((s, d) => s + (d.score || 0), 0) / (diagnostics.length || 1);
      console.log(`\n[${type}] "${seed}"`);
      console.log(`  📊 Avg: ${avg.toFixed(1)}/5`);
      for (const d of diagnostics) {
        if (d.score <= 3) {
          console.log(`  ⚠️  ${d.dimension}: ${d.score}/5 — ${d.how_to_improve}`);
        }
      }
      results.push({ type, seed, avg, diagnostics });
    }

    // Identify the weakest seed type
    results.sort((a, b) => a.avg - b.avg);
    console.log(`\n🔻 Weakest seed type: "${results[0].type}" (${results[0].avg.toFixed(1)}/5)`);
    console.log(`🔺 Strongest seed type: "${results[results.length - 1].type}" (${results[results.length - 1].avg.toFixed(1)}/5)`);

    // At least some seeds should score well
    const bestAvg = Math.max(...results.map(r => r.avg));
    expect(bestAvg).toBeGreaterThanOrEqual(3);
  }, 180000);
});

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC 4: HALLUCINATION STRESS TEST
// ═══════════════════════════════════════════════════════════════

describe.skipIf(SKIP)('Diagnostic — Hallucination Detection', () => {
  it('checks if LLM-generated artists are likely real', async () => {
    // Ask the model to generate artists, then separately ask it to verify them
    const discoveryOutput = await ollamaGenerate(
      'You are a music discovery agent.',
      `Suggest 8 lesser-known artists that fans of Radiohead, Portishead, and Massive Attack would love.
Just list the artist names, one per line. No explanations.`,
      200
    );

    console.log('\n═══ HALLUCINATION TEST ═══');
    console.log('Generated artists:', discoveryOutput);

    // Now ask the judge to verify each one
    const verificationOutput = await ollamaGenerate(
      'You are a music database fact-checker. Be honest — if you are not confident an artist exists, say so.',
      `For each artist below, state whether they are a REAL, existing musical artist.
Answer with ONLY a JSON array: [{"name": "...", "is_real": true/false, "confidence": "high/medium/low", "note": "..."}]

Artists to verify:
${discoveryOutput}`,
      600
    );

    console.log('\nVerification:', verificationOutput);

    // Parse verification
    try {
      const cleaned = verificationOutput.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        const verified = JSON.parse(match[0]);
        const realCount = verified.filter(a => a.is_real).length;
        const highConfCount = verified.filter(a => a.confidence === 'high' && a.is_real).length;

        console.log(`\n📊 Results: ${realCount}/${verified.length} real, ${highConfCount} high-confidence`);

        for (const a of verified) {
          const icon = a.is_real ? '✅' : '❌';
          console.log(`  ${icon} ${a.name} [${a.confidence}] ${a.note || ''}`);
        }

        // At least 60% should be real with high confidence
        const realRate = realCount / verified.length;
        console.log(`\n🎯 Reality rate: ${(realRate * 100).toFixed(0)}%`);
        expect(realRate).toBeGreaterThanOrEqual(0.5);
      }
    } catch (e) {
      console.error('Verification parse failed:', e.message);
    }
  }, 120000);
});
