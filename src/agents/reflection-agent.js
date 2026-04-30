/**
 * TasteGraph — Reflection Agent
 * "The Learner" — Runs at session end to distill short-term signals into long-term memory.
 *
 * Perceives: Session DJ data (skip/listen history), pipeline context, UserModel Tier 3
 * Decides:   What patterns are worth promoting to Tier 1/2
 * Acts:      Writes episodic summaries, updates narrative anchors, detects drift trends
 *
 * Critical Rule: This is the ONLY agent that writes to Tier 1 from behavioral data.
 * All other agents operate on session state only.
 */

import { callWithTools } from '../data/gemini-api.js';
import { UserModel } from './user-model.js';

export class ReflectionAgent {

  /**
   * Run post-session reflection.
   * Called by Orchestrator.endSession() when the user navigates away or explicitly ends.
   *
   * @param {Object} sessionData — { skipHistory, listenHistory, adjustments } from SessionDJ
   * @param {Object} pipelineContext — the last PipelineContext from the pipeline
   * @returns {Object} — { episodicSummary, newAnchors, driftTrends }
   */
  async reflect(sessionData, pipelineContext) {
    const results = {
      episodicSummary: null,
      newAnchors: [],
      driftUpdated: false,
    };

    // --- 1. Build episodic summary ---
    const summary = this._buildEpisodicSummary(sessionData, pipelineContext);
    results.episodicSummary = summary;

    try {
      UserModel.addEpisodicSummary(summary);
    } catch (e) {
      console.warn('ReflectionAgent: Failed to persist episodic summary:', e.message);
    }

    // --- 2. Extract narrative anchors from behavioral patterns ---
    const anchors = await this._extractNarrativeAnchors(sessionData, pipelineContext);
    results.newAnchors = anchors;

    for (const anchor of anchors) {
      try {
        UserModel.addNarrativeAnchor(anchor.text, 'agent_inferred');
      } catch (e) { /* UserModel may not be available */ }
    }

    // --- 3. Update drift trends by comparing recent sessions ---
    try {
      this._updateDriftTrends();
      results.driftUpdated = true;
    } catch (e) {
      console.warn('ReflectionAgent: Drift trend update failed:', e.message);
    }

    // --- 4. Infer functional profile from accumulated session motivations (Task 7.3) ---
    try {
      const functionalUpdate = this._inferFunctionalProfile();
      results.functionalProfileUpdated = functionalUpdate;
    } catch (e) {
      console.warn('ReflectionAgent: Functional profile inference failed:', e.message);
      results.functionalProfileUpdated = false;
    }

    return results;
  }

  /**
   * Infer dominant listening functions from accumulated session motivations.
   * Only fires after 3+ sessions have motivation data.
   * Source: R2 — "what effect the user wants from music"
   */
  _inferFunctionalProfile() {
    const episodic = UserModel.getEpisodicMemory();
    const sessions = episodic.sessions || [];

    // Collect all sessions with motivation data
    const motivatedSessions = sessions.filter(s => s.motivation);
    if (motivatedSessions.length < 3) return false;

    // Tally motivation types
    const motivationCounts = {};
    for (const s of motivatedSessions) {
      motivationCounts[s.motivation] = (motivationCounts[s.motivation] || 0) + 1;
    }

    // Map motivation strings to functionalProfile fields
    const motivationToField = {
      emotion_regulation: 'emotionRegulation',
      arousal_modulation: 'arousalModulation',
      focus: 'focusAid',
      identity_expression: 'identityExpression',
      social_bonding: 'socialBonding',
      transcendence: 'transcendence',
      companionship: 'companionship',
      nostalgia: 'nostalgia',
    };

    // Compute normalized weights (0-1 scale)
    const total = motivatedSessions.length;
    const model = UserModel.loadTier1();

    let changed = false;
    for (const [motivation, count] of Object.entries(motivationCounts)) {
      const field = motivationToField[motivation];
      if (field && model.functionalProfile.primaryFunctions[field] !== undefined) {
        const weight = Math.round((count / total) * 100) / 100;
        model.functionalProfile.primaryFunctions[field] = weight;
        changed = true;
      }
    }

    if (changed) {
      model.functionalProfile._confidence = Math.min(0.85, motivatedSessions.length / 10);
      UserModel.saveTier1(model);
    }

    return changed;
  }

  /**
   * Build a structured episodic summary of this session.
   */
  _buildEpisodicSummary(sessionData, context) {
    const { skipHistory = [], listenHistory = [], adjustments = {} } = sessionData;
    const sessionState = UserModel.getSessionState?.() || {};

    // Compute basic stats
    const totalTracks = skipHistory.length + listenHistory.length;
    const skipRate = totalTracks > 0 ? Math.round((skipHistory.length / totalTracks) * 100) : 0;

    // Identify most skipped and most loved genres
    const skippedGenres = {};
    for (const s of skipHistory) {
      const tags = s.candidate?.tags || [];
      for (const t of tags.slice(0, 2)) {
        const name = typeof t === 'object' ? t.name : t;
        if (name) skippedGenres[name] = (skippedGenres[name] || 0) + 1;
      }
    }

    const lovedGenres = {};
    for (const l of listenHistory) {
      const tags = l.candidate?.tags || [];
      for (const t of tags.slice(0, 2)) {
        const name = typeof t === 'object' ? t.name : t;
        if (name) lovedGenres[name] = (lovedGenres[name] || 0) + 1;
      }
    }

    const topSkipped = Object.entries(skippedGenres).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
    const topLoved = Object.entries(lovedGenres).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);

    // Loved artists
    const lovedArtists = [...new Set(listenHistory.map(l => l.candidate?.artistName).filter(Boolean))].slice(0, 5);

    return {
      date: new Date().toISOString().split('T')[0],
      intent: context?.sessionIntent || sessionState.intent || 'general',
      motivation: sessionState.motivation || null,
      timeOfDay: sessionState.context?.timeOfDay || null,
      stats: {
        totalTracks,
        skips: skipHistory.length,
        listens: listenHistory.length,
        skipRate,
      },
      topSkippedGenres: topSkipped,
      topLovedGenres: topLoved,
      lovedArtists,
      adjustmentsMade: {
        boostedGenres: adjustments.boostedGenres || [],
        penalizedGenres: adjustments.penalizedGenres || [],
      },
      summary: `Session "${context?.sessionIntent || 'general'}": ${listenHistory.length} listens, ${skipHistory.length} skips (${skipRate}% skip rate). ${topLoved.length > 0 ? `Loved: ${topLoved.join(', ')}.` : ''} ${topSkipped.length > 0 ? `Skipped: ${topSkipped.join(', ')}.` : ''}`.trim(),
    };
  }

  /**
   * Use an LLM call to extract narrative anchors from session patterns.
   * These are natural language observations about the user's taste identity.
   */
  async _extractNarrativeAnchors(sessionData, context) {
    const { skipHistory = [], listenHistory = [] } = sessionData;

    // Only attempt if we have enough data
    if (listenHistory.length < 3 && skipHistory.length < 3) return [];

    const lovedArtists = [...new Set(listenHistory.map(l => l.candidate?.artistName).filter(Boolean))].slice(0, 5);
    const skippedArtists = [...new Set(skipHistory.filter(s => s.listenMs < 10000).map(s => s.candidate?.artistName).filter(Boolean))].slice(0, 5);

    const prompt = `You are analyzing a music listening session to extract lasting taste insights.

SESSION DATA:
- Intent: "${context?.sessionIntent || 'general'}"
- Listened to: ${lovedArtists.join(', ') || 'none tracked'}
- Rapidly skipped: ${skippedArtists.join(', ') || 'none'}
- Skip rate: ${skipHistory.length}/${skipHistory.length + listenHistory.length}

Extract 0-2 durable taste observations. Only include observations that reveal something LASTING about the user's identity — not session-specific preferences.

Examples of good anchors:
- "Consistently skips vocal jazz but loves instrumental jazz"
- "Gravitates toward post-2010 indie but rejects classic rock"

Return a JSON array of strings. If no durable insights, return [].`;

    try {
      const result = await callWithTools(
        prompt,
        [{ role: 'user', parts: [{ text: 'Extract taste anchors.' }] }],
        [], 'fast'
      );

      const cleaned = result.textReply.replace(/```json|```/g, '').trim();
      const anchors = JSON.parse(cleaned);

      if (Array.isArray(anchors)) {
        return anchors
          .filter(a => typeof a === 'string' && a.length > 10 && a.length < 200)
          .map(text => ({ text, source: 'agent_inferred' }));
      }
    } catch (e) {
      console.warn('ReflectionAgent: Narrative anchor extraction failed:', e.message);
    }

    return [];
  }

  /**
   * Update drift trends by comparing the last 5 episodic summaries.
   */
  _updateDriftTrends() {
    const episodic = UserModel.getEpisodicMemory();
    const sessions = episodic.sessions || [];

    if (sessions.length < 3) return; // Not enough data

    const recent = sessions.slice(0, 5);

    // Genre momentum: which genres appear in topLovedGenres across multiple sessions?
    const genreFreq = {};
    for (const s of recent) {
      for (const g of (s.topLovedGenres || [])) {
        genreFreq[g] = (genreFreq[g] || 0) + 1;
      }
    }
    const momentum = Object.entries(genreFreq)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([genre, count]) => ({ genre, sessions: count }));

    // Genre decline: which genres appear in topSkippedGenres?
    const declineFreq = {};
    for (const s of recent) {
      for (const g of (s.topSkippedGenres || [])) {
        declineFreq[g] = (declineFreq[g] || 0) + 1;
      }
    }
    const decline = Object.entries(declineFreq)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([genre, count]) => ({ genre, sessions: count }));

    // Discovery trajectory: are skip rates going up or down?
    const skipRates = recent.map(s => s.stats?.skipRate || 0);
    let discoveryTrajectory = 'stable';
    if (skipRates.length >= 3) {
      const recentAvg = skipRates.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
      const olderAvg = skipRates.slice(-2).reduce((a, b) => a + b, 0) / 2;
      if (recentAvg > olderAvg + 10) discoveryTrajectory = 'declining'; // skipping more = not enjoying discoveries
      if (recentAvg < olderAvg - 10) discoveryTrajectory = 'improving'; // skipping less = hitting the mark
    }

    UserModel.setDriftTrends({
      genreMomentum: momentum,
      genreDecline: decline,
      discoveryTrajectory,
    });
  }
}
