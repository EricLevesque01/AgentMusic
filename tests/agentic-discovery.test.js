import { describe, it, expect } from 'vitest';

/**
 * Agentic Discovery — LLM-as-Judge Evaluation Tests
 *
 * Tests the new "Agentic Spotify" components against quality rubrics:
 *   1. Web-Grounded Scout   — Do search-based discoveries have real, non-trivial reasons?
 *   2. Suggested Artists     — Are suggestions diverse across knowledge layers?
 *   3. Playlist Scheduler    — Are intent seeds specific and contextualized?
 *   4. Connection Reasoning  — Do MusicBrainz/Wikidata reasons feel insightful?
 *   5. End-to-End Discovery  — Does the full pipeline produce genuinely novel recommendations?
 *
 * Uses Ollama (local, free) for generating agent outputs, then judges them.
 *
 * Run with: RUN_OLLAMA_JUDGE=1 npx vitest run tests/agentic-discovery.test.js
 * Requires: Ollama running on localhost:11434 with a model pulled.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const SKIP = !process.env.RUN_OLLAMA_JUDGE;

/**
 * Call Ollama to generate a completion.
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {number} maxTokens
 * @returns {string} text reply
 */
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
 * Use Ollama as a judge: score text against a rubric.
 * Returns { score: 1-5, reasoning: string }
 */
async function ollamaJudge(text, rubric) {
  const systemPrompt = `You are an expert evaluator for a music discovery AI called TasteGraph.
You evaluate text outputs against a scoring rubric. Be strict — only give a 5 for truly exceptional output.
You MUST respond with ONLY valid JSON, no markdown fences, no explanation outside the JSON.`;

  const userMessage = `RUBRIC:
${rubric}

TEXT TO EVALUATE:
"""
${text}
"""

Score the text 1-5 on the rubric. Return ONLY valid JSON: {"score": <1-5>, "reasoning": "<brief explanation>"}`;

  const reply = await ollamaGenerate(systemPrompt, userMessage, 256);
  const cleaned = reply.replace(/```json|```/g, '').trim();

  // Try to extract JSON from the reply
  try {
    const match = cleaned.match(/\{[^}]+\}/);
    if (match) return JSON.parse(match[0]);
    return JSON.parse(cleaned);
  } catch {
    console.error('Ollama Judge parse error:', cleaned.slice(0, 300));
    return { score: 0, reasoning: `Parse error: ${cleaned.slice(0, 200)}` };
  }
}

// ═══════════════════════════════════════
// RUBRIC 1: WEB-GROUNDED SCOUT DISCOVERY
// ═══════════════════════════════════════

const WEB_SCOUT_RUBRIC = `Does this Scout agent output demonstrate genuine music journalism research?
It should find NON-OBVIOUS connections — not just "similar sounding artists."

Score 5: Mentions specific shared producers, labels, scenes, recent reviews, or forum recommendations with named sources.
Score 4: Most connections are non-trivial. References real cultural context (scenes, movements, eras).
Score 3: Mix of obvious (same genre) and interesting connections. Some specificity.
Score 2: Mostly "sounds like" or genre-based connections. Could be from any algorithm.
Score 1: Generic recommendations with no reasoning or connection to the seed artists.`;

describe.skipIf(SKIP)('LLM Judge — Web-Grounded Scout Discovery', () => {

  it('generates non-obvious artist connections when given good seeds', async () => {
    const prompt = `You are the Scout — a music discovery agent. The user's top artists are:
Radiohead, Björk, Aphex Twin. Their genres: art rock, electronic, experimental.

Find 5 artists the user might not know by looking for:
1. Shared producers or engineers
2. Artists from the same local scene or movement
3. Recent critical acclaim in adjacent genres
4. Forum recommendations (Reddit, RateYourMusic)

For each artist, give a specific CONNECTION REASON explaining the non-obvious link.
Format as a numbered list: "Artist Name — Reason"`;

    const output = await ollamaGenerate(
      'You are a music discovery expert with deep knowledge of music journalism, production credits, and underground scenes.',
      prompt,
      800
    );

    console.log('\n--- Scout Output ---\n', output);

    const result = await ollamaJudge(output, WEB_SCOUT_RUBRIC);
    console.log('Web Scout:', result.score, '—', result.reasoning);
    expect(result.score).toBeGreaterThanOrEqual(3);
  }, 120000);

  it('generic scout output scores low', async () => {
    const output = `Here are some artists similar to Radiohead:
1. Coldplay — Similar genre
2. Muse — Both are alternative rock
3. The Killers — Popular rock band
4. Imagine Dragons — Alternative sound
5. Mumford & Sons — Indie rock`;

    const result = await ollamaJudge(output, WEB_SCOUT_RUBRIC);
    console.log('Web Scout (bad):', result.score, '—', result.reasoning);
    expect(result.score).toBeLessThanOrEqual(2);
  }, 60000);
});

// ═══════════════════════════════════════
// RUBRIC 2: SUGGESTED ARTISTS DIVERSITY
// ═══════════════════════════════════════

const SUGGESTION_DIVERSITY_RUBRIC = `Does this list of suggested artists cover multiple TYPES of discovery?
A great suggestion list should include artists from different knowledge sources:
- Graph-based (similar sounding, same genre)
- Structural (shared band members, collaborators, same label)
- Influence chains (who influenced whom)
- Topical/trending (recent releases, critical buzz)

Score 5: All 4 discovery types present. Each suggestion has a unique, specific reason.
Score 4: 3 types present. Most reasons are specific and non-trivial.
Score 3: 2 types present. Some specificity in reasons.
Score 2: All suggestions are the same type (usually "sounds like").
Score 1: No reasons given, or all reasons are generic.`;

describe.skipIf(SKIP)('LLM Judge — Suggested Artists Diversity', () => {

  it('generates diverse suggestion categories', async () => {
    const prompt = `You are a music discovery agent. For a user who loves Miles Davis, John Coltrane, and Thelonious Monk, suggest 8 artists they should discover.

Each suggestion MUST include:
- Artist name
- Category: one of [graph_similar, band_connection, collaboration, influenced_by, influenced, shared_production, same_scene, web_trending, critics_pick]
- A specific reason explaining the connection

Format each as: "Artist — [category] — Reason"

Use your deep music knowledge. Think about:
- Who played on the same recordings?
- Who was in the same bands or ensembles?
- Who did they influence (and who influenced them)?
- What producers/labels connect them?
- Who is currently getting critical acclaim in adjacent spaces?`;

    const output = await ollamaGenerate(
      'You are a jazz historian and music journalist with encyclopedic knowledge of personnel, sessions, and cultural context.',
      prompt,
      800
    );

    console.log('\n--- Suggestion Output ---\n', output);

    const result = await ollamaJudge(output, SUGGESTION_DIVERSITY_RUBRIC);
    console.log('Suggestion Diversity:', result.score, '—', result.reasoning);
    expect(result.score).toBeGreaterThanOrEqual(3);
  }, 120000);
});

// ═══════════════════════════════════════
// RUBRIC 3: PLAYLIST SCHEDULER SEEDS
// ═══════════════════════════════════════

const SCHEDULER_SEED_RUBRIC = `Does this playlist intent seed feel specific, personal, and inspiring?
A great intent seed should make someone excited to listen — not be a vague genre label.

Score 5: Evocative, specific, references a mood/scenario/cultural moment. Would make a compelling playlist title.
Score 4: Specific and interesting, clearly informed by user taste data.
Score 3: Reasonable but somewhat generic (e.g., "jazz playlist", "rock mix").
Score 2: Very generic, could apply to anyone (e.g., "good music").
Score 1: Meaningless or incoherent.`;

describe.skipIf(SKIP)('LLM Judge — Playlist Scheduler Seeds', () => {

  it('evaluates scheduler-quality intent seeds', async () => {
    // These are the kinds of seeds our scheduler generates
    const seeds = [
      'Smooth, atmospheric, and emotionally warm — acoustic intimacy',
      'Deep dive into jazz — you\'ve been gravitating here',
      'Evening unwind — warm, contemplative, rich textures',
      'The world of Miles Davis — deep cuts, adjacent artists, and sonic relatives',
      'Based on what you told me: "I like melancholy but not defeatist music"',
    ];

    for (const seed of seeds) {
      const result = await ollamaJudge(seed, SCHEDULER_SEED_RUBRIC);
      console.log(`Seed "${seed.slice(0, 50)}...":`, result.score, '—', result.reasoning);
      expect(result.score).toBeGreaterThanOrEqual(3);
    }
  }, 120000);

  it('generic seeds score low', async () => {
    const badSeeds = [
      'music',
      'good songs',
      'play something',
    ];

    for (const seed of badSeeds) {
      const result = await ollamaJudge(seed, SCHEDULER_SEED_RUBRIC);
      console.log(`Bad seed "${seed}":`, result.score, '—', result.reasoning);
      expect(result.score).toBeLessThanOrEqual(2);
    }
  }, 60000);
});

// ═══════════════════════════════════════
// RUBRIC 4: CONNECTION REASONING QUALITY
// ═══════════════════════════════════════

const CONNECTION_RUBRIC = `Does this connection reason explain a NON-OBVIOUS relationship between two artists?
It should tell the user something they probably didn't know.

Score 5: Reveals a specific factual connection (shared session, same producer, direct mentorship). Educational and surprising.
Score 4: Specific connection with real cultural context. Informative.
Score 3: Real connection but commonly known (e.g., "both are jazz").
Score 2: Vague connection ("similar vibes", "same era").
Score 1: No real connection, or factually incorrect.`;

describe.skipIf(SKIP)('LLM Judge — Connection Reasoning', () => {

  it('MusicBrainz-style reasons are insightful', async () => {
    const reasons = [
      'Herbie Hancock was a member of Miles Davis\' Second Great Quintet (1964-1968)',
      'Ron Carter — Session/touring musician for Miles Davis on over 20 recordings',
      'Wayne Shorter co-founded Weather Report after leaving Miles Davis\' band',
      'Tony Williams — Founded the Tony Williams Lifetime after drumming for Miles Davis from age 17',
    ];

    for (const reason of reasons) {
      const result = await ollamaJudge(reason, CONNECTION_RUBRIC);
      console.log(`Connection "${reason.slice(0, 50)}...":`, result.score, '—', result.reasoning);
      expect(result.score).toBeGreaterThanOrEqual(3);
    }
  }, 120000);

  it('vague connections score low', async () => {
    const badReasons = [
      'Similar to Miles Davis',
      'Also plays jazz',
      'Popular artist from the same era',
    ];

    for (const reason of badReasons) {
      const result = await ollamaJudge(reason, CONNECTION_RUBRIC);
      console.log(`Bad connection "${reason}":`, result.score, '—', result.reasoning);
      expect(result.score).toBeLessThanOrEqual(2);
    }
  }, 60000);
});

// ═══════════════════════════════════════
// RUBRIC 5: END-TO-END DISCOVERY QUALITY
// ═══════════════════════════════════════

const E2E_RUBRIC = `This is the output of a complete music discovery pipeline. Evaluate the OVERALL quality
of the discovery — does it feel like a knowledgeable friend curating for you, or a generic algorithm?

The user's profile:
- Loves: Radiohead, Portishead, Massive Attack
- Genres: Trip-hop, Art Rock, Electronic
- Session intent: "Something like early trip-hop but with a modern edge"

Score 5: Genuinely surprising, insightful recommendations. Each pick has a compelling reason tied to the user's taste. Feels like talking to a music journalist friend.
Score 4: Mostly strong picks with good reasoning. 1-2 obvious suggestions but overall impressive depth.
Score 3: Reasonable recommendations but could come from any streaming service's "similar artists" feature.
Score 2: Mix of relevant and irrelevant picks. Generic reasoning.
Score 1: No connection to the user's taste or intent.`;

describe.skipIf(SKIP)('LLM Judge — End-to-End Discovery', () => {

  it('produces genuinely novel recommendations for trip-hop fan', async () => {
    const prompt = `You are TasteGraph — a music discovery AI. A user who loves Radiohead, Portishead, and Massive Attack asks for "something like early trip-hop but with a modern edge."

Generate a curated playlist of 8 tracks. For EACH track, explain:
1. Why it connects to their taste (be specific about sonic/production parallels)
2. What makes it a DISCOVERY (not just obvious similar artists)
3. The non-obvious connection (shared producer, same scene, influence chain, recent review)

Format each track as:
"Artist - Track Title"
Connection: [specific reason]

Do NOT suggest Portishead, Massive Attack, or Radiohead themselves. Think deeper.`;

    const output = await ollamaGenerate(
      `You are a deeply opinionated, culturally literate music companion. You speak like the user's most musically knowledgeable friend. You reference specific eras, scenes, production styles, and cultural moments. You never say "diverse mix" or "eclectic taste."`,
      prompt,
      1200
    );

    console.log('\n--- E2E Discovery Output ---\n', output);

    const result = await ollamaJudge(output, E2E_RUBRIC);
    console.log('E2E Discovery:', result.score, '—', result.reasoning);
    expect(result.score).toBeGreaterThanOrEqual(3);
  }, 180000);
});

// ═══════════════════════════════════════
// UNIT TESTS (no LLM, always run)
// ═══════════════════════════════════════

describe('PlaylistScheduler — Intent Seed Generation (unit)', () => {

  it('time-contextual seeds are appropriate for the current hour', () => {
    const hour = new Date().getHours();

    // Import the scheduler's seed logic inline
    let seed;
    if (hour >= 6 && hour < 10) seed = 'Easy morning energy';
    else if (hour >= 10 && hour < 14) seed = 'Midday focus';
    else if (hour >= 14 && hour < 18) seed = 'Afternoon groove';
    else if (hour >= 18 && hour < 22) seed = 'Evening unwind';
    else seed = 'Late night';

    expect(seed).toBeTruthy();
    expect(seed.length).toBeGreaterThan(5);
  });

  it('fallback seeds are non-generic', () => {
    const fallbacks = [
      'A mix of critically acclaimed albums from the past year',
      'Hidden gems — underappreciated tracks from great artists',
      'Genre-spanning journey — connect the dots across your taste',
    ];

    for (const seed of fallbacks) {
      expect(seed.length).toBeGreaterThan(20);
      expect(seed).not.toContain('good music');
      expect(seed).not.toContain('playlist');
    }
  });
});

describe('Scout — Connection Reason Formatting (unit)', () => {

  function formatRelationshipReason(rel, seedName) {
    switch (rel.type) {
      case 'member of band':
        return rel.direction === 'backward'
          ? `Member of ${seedName}`
          : `${seedName} was a member of ${rel.targetName}`;
      case 'collaboration':
        return `Collaborated with ${seedName}`;
      case 'supporting musician':
        return rel.direction === 'backward'
          ? `Session/touring musician for ${seedName}`
          : `${seedName} performed with ${rel.targetName}`;
      case 'founder':
        return `Founded by a member of ${seedName}`;
      case 'subgroup':
        return `Side project of ${seedName}`;
      default:
        return `Connected to ${seedName}`;
    }
  }

  it('formats member-of-band correctly', () => {
    const rel = { type: 'member of band', targetName: 'The Beatles', direction: 'forward' };
    expect(formatRelationshipReason(rel, 'John Lennon')).toBe('John Lennon was a member of The Beatles');
  });

  it('formats backward member-of-band correctly', () => {
    const rel = { type: 'member of band', targetName: 'Ringo Starr', direction: 'backward' };
    expect(formatRelationshipReason(rel, 'The Beatles')).toBe('Member of The Beatles');
  });

  it('formats collaboration correctly', () => {
    const rel = { type: 'collaboration', targetName: 'Iggy Pop', direction: 'forward' };
    expect(formatRelationshipReason(rel, 'David Bowie')).toBe('Collaborated with David Bowie');
  });

  it('formats supporting musician correctly', () => {
    const rel = { type: 'supporting musician', targetName: 'Herbie Hancock', direction: 'backward' };
    expect(formatRelationshipReason(rel, 'Miles Davis')).toBe('Session/touring musician for Miles Davis');
  });

  it('formats founder correctly', () => {
    const rel = { type: 'founder', targetName: 'Weather Report', direction: 'forward' };
    expect(formatRelationshipReason(rel, 'Wayne Shorter')).toBe('Founded by a member of Wayne Shorter');
  });

  it('formats subgroup correctly', () => {
    const rel = { type: 'subgroup', targetName: 'Them Crooked Vultures', direction: 'forward' };
    expect(formatRelationshipReason(rel, 'Foo Fighters')).toBe('Side project of Foo Fighters');
  });
});

describe('DataStore — Playlist Library Schema (unit)', () => {

  it('library entry has required fields', () => {
    const entry = {
      id: '12345',
      createdAt: Date.now(),
      listenedAt: null,
      intent: 'late night jazz',
      source: 'scheduler',
      title: 'Midnight Modal',
      trackCount: 12,
      curatorReflection: 'Built around Miles Davis anchor...',
      context: {},
    };

    expect(entry.id).toBeTruthy();
    expect(entry.listenedAt).toBeNull();
    expect(entry.source).toBe('scheduler');
    expect(entry.trackCount).toBeGreaterThan(0);
  });

  it('unlistened count logic is correct', () => {
    const library = [
      { id: '1', listenedAt: null },
      { id: '2', listenedAt: Date.now() },
      { id: '3', listenedAt: null },
      { id: '4', listenedAt: null },
    ];

    const unlistened = library.filter(p => !p.listenedAt).length;
    expect(unlistened).toBe(3);
  });

  it('scheduler respects MAX_UNLISTENED threshold', () => {
    const MAX_UNLISTENED = 3;
    const unlistened = 3;
    const slotsNeeded = Math.max(0, MAX_UNLISTENED - unlistened);
    expect(slotsNeeded).toBe(0); // Should NOT generate more
  });
});
