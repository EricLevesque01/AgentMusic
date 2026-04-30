import { describe, it, expect } from 'vitest';

/**
 * LLM-as-Judge Evaluation Tests
 *
 * Uses Gemini Flash to evaluate agent output quality against 5 rubrics:
 * 1. Soul Consistency   — Does it sound like TasteGraph?
 * 2. Personalization     — Does it use the user model?
 * 3. Calibration         — Does the playlist match genre distribution?
 * 4. Cross-Agent Alignment — Do Curator and Narrator agree?
 * 5. Intent Adherence    — Does output match session request?
 *
 * Run with: RUN_LLM_JUDGE=1 npx vitest run tests/llm-judge.test.js
 * Requires VITE_GEMINI_API_KEY in environment.
 */

const API_KEY = process.env.VITE_GEMINI_API_KEY;
const SKIP = !API_KEY || !process.env.RUN_LLM_JUDGE;

/**
 * Call Gemini Flash directly to evaluate text against a rubric.
 * Returns { score: 1-5, reasoning: string }.
 */
async function llmJudge(text, rubric) {
  const systemPrompt = `You are an expert evaluator for a music recommendation AI called TasteGraph.
You evaluate text outputs against a scoring rubric. Be strict — only give a 5 for truly exceptional output.
You MUST respond with ONLY valid JSON, no markdown fences.`;

  const userMessage = `RUBRIC:
${rubric}

TEXT TO EVALUATE:
"""
${text}
"""

Score the text 1-5 on the rubric. Return ONLY valid JSON: {"score": <1-5>, "reasoning": "<brief explanation>"}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
    }),
  });

  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = reply.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error('LLM Judge failed to return valid JSON:', reply);
    return { score: 0, reasoning: `Parse error: ${cleaned.slice(0, 200)}` };
  }
}

// ═══════════════════════════════════════
// RUBRIC 1: SOUL CONSISTENCY
// ═══════════════════════════════════════

const SOUL_RUBRIC = `Does this text sound like it was written by a deeply opinionated,
culturally literate music companion who speaks like the user's most knowledgeable friend?

Score 5: Warm, specific, uses real cultural references, feels like a friend talking.
Score 4: Mostly warm and specific, minor lapses into generic language.
Score 3: Functional but could be from any music app. Some personality.
Score 2: Generic, uses filler phrases like "diverse mix" or "eclectic taste."
Score 1: Robotic, reads like a template or API documentation.`;

describe.skipIf(SKIP)('LLM Judge — Soul Consistency', () => {

  it('warm, specific narrator output scores ≥ 4', async () => {
    const output = `This set rides the line between Miles Davis' cool-jazz restraint
and Kamasi Washington's spiritual maximalism — it's the sound of someone who wants
their jazz contemplative but never boring. I anchored the whole thing around that
Kind of Blue tension you keep coming back to, then let it drift into Nils Frahm's
piano minimalism for the comedown.`;

    const result = await llmJudge(output, SOUL_RUBRIC);
    console.log('Soul (good):', result.score, '—', result.reasoning);
    expect(result.score).toBeGreaterThanOrEqual(4);
  }, 30000);

  it('generic output scores ≤ 2', async () => {
    const output = `Here is a diverse mix of 20 tracks based on your listening history.
The playlist includes a wide range of genres to match your eclectic taste. We hope
you enjoy this carefully curated selection of music.`;

    const result = await llmJudge(output, SOUL_RUBRIC);
    console.log('Soul (bad):', result.score, '—', result.reasoning);
    expect(result.score).toBeLessThanOrEqual(2);
  }, 30000);
});

// ═══════════════════════════════════════
// RUBRIC 2: PERSONALIZATION DEPTH
// ═══════════════════════════════════════

const PERSONALIZATION_RUBRIC = `Given the following user context, does the text
demonstrate deep awareness of this specific user's identity, preferences, and history?

USER CONTEXT:
- Anchor artist: Miles Davis (Elo 1850, confirmed #1)
- Core genres: Jazz (45%), Indie (30%), Ambient (15%)
- Narrative anchor: "I like melancholy but not defeatist music"
- Last session: Skipped all vocal jazz, loved instrumental
- Sophistication: engaged (not expert)
- Session intent: "late night jazz"

Score 5: References specific user facts, adapts tone to sophistication, respects stated preferences.
Score 4: References most user context, minor misses.
Score 3: Acknowledges the user vaguely but doesn't use specifics.
Score 2: Generic personalization ("based on your taste").
Score 1: No personalization whatsoever.`;

describe.skipIf(SKIP)('LLM Judge — Personalization Depth', () => {

  it('deeply personalized narrator output scores ≥ 4', async () => {
    const output = `I built this around your Miles Davis anchor — that Kind of Blue
restraint you keep returning to. Kamasi Washington is a discovery bet: he bridges
the classic modal sound you love with a more spiritual, modern energy. I kept
everything instrumental tonight since last time vocal jazz tracks lost you instantly.
The Nils Frahm closer stretches into ambient — melancholic but never defeatist,
exactly your lane.`;

    const result = await llmJudge(output, PERSONALIZATION_RUBRIC);
    console.log('Personalization (good):', result.score, '—', result.reasoning);
    expect(result.score).toBeGreaterThanOrEqual(4);
  }, 30000);

  it('generic personalization scores ≤ 2', async () => {
    const output = `Based on your listening history, we've selected tracks that
match your musical preferences. This playlist features a variety of artists
you might enjoy.`;

    const result = await llmJudge(output, PERSONALIZATION_RUBRIC);
    console.log('Personalization (bad):', result.score, '—', result.reasoning);
    expect(result.score).toBeLessThanOrEqual(2);
  }, 30000);
});

// ═══════════════════════════════════════
// RUBRIC 3: CALIBRATION ACCURACY
// ═══════════════════════════════════════

const CALIBRATION_RUBRIC = `The user's genre distribution target is:
- Jazz / Blues: 45% (~9 of 20 tracks)
- Alternative / Indie: 30% (~6 of 20 tracks)
- Electronic / Ambient: 15% (~3 of 20 tracks)
- Other: 10% (~2 of 20 tracks)

Score 5: Distribution matches within ±1 track of all targets.
Score 4: Distribution matches within ±2 tracks, no category missing.
Score 3: Broadly correct but some categories off by 3+.
Score 2: One genre dominates disproportionately.
Score 1: Distribution bears no resemblance to targets.`;

describe.skipIf(SKIP)('LLM Judge — Calibration Accuracy', () => {

  it('well-calibrated playlist scores ≥ 4', async () => {
    const output = `PLAYLIST (20 tracks):
Jazz (8): Miles Davis - Blue in Green, Bill Evans - Peace Piece, Chet Baker - Almost Blue,
  Ahmad Jamal - Poinciana, Kamasi Washington - Clair de Lune, Thelonious Monk - Round Midnight,
  John Coltrane - Naima, Charles Mingus - Goodbye Pork Pie Hat
Indie (6): Radiohead - Everything in Its Right Place, Big Thief - Not, Adrianne Lenker - anything,
  Japanese Breakfast - Kokomo IN, Alvvays - Dreams Tonite, Elliott Smith - Between the Bars
Ambient (3): Nils Frahm - Says, Brian Eno - Music for Airports 1/1, Stars of the Lid - Requiem
Other (3): Khruangbin - Maria También, Hiatus Kaiyote - Breathing Underwater, Floating Points - Silhouettes`;

    const result = await llmJudge(output, CALIBRATION_RUBRIC);
    console.log('Calibration (good):', result.score, '—', result.reasoning);
    expect(result.score).toBeGreaterThanOrEqual(4);
  }, 30000);
});

// ═══════════════════════════════════════
// RUBRIC 4: CROSS-AGENT ALIGNMENT
// ═══════════════════════════════════════

const ALIGNMENT_RUBRIC = `Two texts are provided: a Curator Reflection and a Narrator Explanation.
They should be aligned — the Narrator should reference or build upon the Curator's reasoning.

Score 5: Narrator explicitly references the Curator's thesis and expands on it.
Score 4: Narrator's framing is consistent with Curator's reasoning.
Score 3: No contradiction, but Narrator seems to work independently.
Score 2: Minor contradictions or Narrator ignores key Curator decisions.
Score 1: Direct contradiction.`;

describe.skipIf(SKIP)('LLM Judge — Cross-Agent Alignment', () => {

  it('aligned curator+narrator scores ≥ 4', async () => {
    const combined = `CURATOR REFLECTION:
Built an arc from cool jazz through modal to modern spiritual jazz. Excluded vocal
jazz per user's session behavior. Kamasi Washington is the discovery bet — bridges
classic and modern. Nils Frahm closer provides ambient wind-down.

NARRATOR OUTPUT:
This playlist traces a line from Bill Evans' cool restraint through Miles Davis'
modal explorations, landing on Kamasi Washington's spiritual maximalism. I kept it
instrumental throughout — you made it clear last session that vocals break the spell.
Kamasi is the bridge between the classic sound you love and something genuinely new.
The Nils Frahm closer lets the whole thing exhale.`;

    const result = await llmJudge(combined, ALIGNMENT_RUBRIC);
    console.log('Alignment (good):', result.score, '—', result.reasoning);
    expect(result.score).toBeGreaterThanOrEqual(4);
  }, 30000);

  it('contradicting curator+narrator scores ≤ 2', async () => {
    const combined = `CURATOR REFLECTION:
Excluded vocal jazz and pop. Focused on instrumental jazz with ambient closer.
Intentionally avoided high-energy tracks for this late-night session.

NARRATOR OUTPUT:
This energetic playlist kicks off with some upbeat vocal jazz to get you moving!
We threw in some pop anthems and party tracks to keep the energy high all night.`;

    const result = await llmJudge(combined, ALIGNMENT_RUBRIC);
    console.log('Alignment (bad):', result.score, '—', result.reasoning);
    expect(result.score).toBeLessThanOrEqual(2);
  }, 30000);
});

// ═══════════════════════════════════════
// RUBRIC 5: INTENT ADHERENCE
// ═══════════════════════════════════════

const INTENT_RUBRIC = `The session intent was: "late night jazz for studying, no lyrics please."

Score 5: Every track is appropriate for late-night studying, instrumental, and jazz-adjacent.
Score 4: 1-2 tracks stretch the definition but are justified as discoveries.
Score 3: Mostly on-intent but 3+ tracks feel misplaced.
Score 2: Mix of on-intent and random selections.
Score 1: The playlist ignores the intent entirely.`;

describe.skipIf(SKIP)('LLM Judge — Intent Adherence', () => {

  it('on-intent playlist scores ≥ 4', async () => {
    const output = `Miles Davis - Blue in Green, Bill Evans - Peace Piece,
Chet Baker - Almost Blue (instrumental), Ahmad Jamal - Poinciana,
Kamasi Washington - Clair de Lune, Nils Frahm - Says,
Brian Eno - Music for Airports 1/1, Floating Points - Silhouettes (iii),
Ryuichi Sakamoto - Merry Christmas Mr. Lawrence, Bohren & der Club of Gore - Black City Skyline`;

    const result = await llmJudge(output, INTENT_RUBRIC);
    console.log('Intent (good):', result.score, '—', result.reasoning);
    expect(result.score).toBeGreaterThanOrEqual(4);
  }, 30000);

  it('off-intent playlist scores ≤ 2', async () => {
    const output = `Eminem - Lose Yourself, AC/DC - Thunderstruck,
Taylor Swift - Shake It Off, Kendrick Lamar - HUMBLE,
Dua Lipa - Levitating, The Weeknd - Blinding Lights,
Beyoncé - Crazy in Love, Drake - Hotline Bling`;

    const result = await llmJudge(output, INTENT_RUBRIC);
    console.log('Intent (bad):', result.score, '—', result.reasoning);
    expect(result.score).toBeLessThanOrEqual(2);
  }, 30000);
});
