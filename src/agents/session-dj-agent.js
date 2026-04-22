/**
 * TasteGraph — Session DJ Agent
 * "The Vibe Check" — Adapts the playlist in real-time based on skip patterns.
 *
 * Perceives:  Skip events, listen duration, explicit feedback buttons
 * Decides:    Detect negative patterns → surface feedback modal
 * Acts:       Updates sessionAdjustments → triggers Orchestrator partial re-rank
 *
 * Rules:
 *  - 3+ consecutive skips → activate intervention
 *  - Skip < 10s → strong negative signal for that genre/energy
 *  - Full listen → positive signal
 */
import { DataStore } from '../data/data-store.js';

export class SessionDJAgent {
  constructor(onIntervention = null) {
    this.consecutiveSkips = 0;
    this.skipHistory      = [];
    this.listenHistory    = [];
    this.onIntervention   = onIntervention; // callback(adjustments)
    this.adjustments      = {
      penalizedGenres: [],
      boostedGenres:   [],
      intentOverride:  {},
      feedback:        [],
    };
  }

  /**
   * Record a skip event.
   * @param {object} candidate - The skipped candidate
   * @param {number} listenMs  - How long it was listened to (ms)
   */
  recordSkip(candidate, listenMs = 0) {
    this.consecutiveSkips++;
    this.skipHistory.push({ candidate, listenMs, ts: Date.now() });

    // Short skip (<10s) = strong negative signal
    if (listenMs < 10_000 && candidate.tags?.length) {
      const topTag = candidate.tags[0];
      const tagName = typeof topTag === 'object' ? topTag.name : topTag;
      if (tagName && !this.adjustments.penalizedGenres.includes(tagName)) {
        this.adjustments.penalizedGenres.push(tagName);
      }
    }

    if (this.consecutiveSkips >= 3) {
      this._triggerIntervention(candidate);
    }

    // Phase 2E: Persist to DataStore so TasteGame + Scout can read signals
    this._persistSignals();
  }

  /**
   * Record a full/positive listen.
   * @param {object} candidate
   */
  recordListen(candidate) {
    this.consecutiveSkips = 0; // Reset skip streak
    this.listenHistory.push({ candidate, ts: Date.now() });

    // Boost this track's genre
    if (candidate.tags?.length) {
      const topTag  = candidate.tags[0];
      const tagName = typeof topTag === 'object' ? topTag.name : topTag;
      if (tagName && !this.adjustments.boostedGenres.includes(tagName)) {
        this.adjustments.boostedGenres.push(tagName);
      }
    }

    // Phase 2E: Persist to DataStore
    this._persistSignals();
  }

  /**
   * Apply a user-selected feedback option.
   * Returns the updated session adjustments.
   */
  applyFeedback(feedbackType, candidate = null) {
    this.consecutiveSkips = 0;
    this.adjustments.feedback.push({ type: feedbackType, ts: Date.now() });

    switch (feedbackType) {
      case 'too_energetic':
        this.adjustments.intentOverride.energy =
          Math.max(0, (this.adjustments.intentOverride.energy ?? 0.5) - 0.2);
        break;

      case 'wrong_genre':
        if (candidate?.tags?.length) {
          const tag = candidate.tags[0];
          const tagName = typeof tag === 'object' ? tag.name : tag;
          if (tagName && !this.adjustments.penalizedGenres.includes(tagName)) {
            this.adjustments.penalizedGenres.push(tagName);
          }
        }
        break;

      case 'more_like_last':
        if (this.listenHistory.length > 0) {
          const lastLiked = this.listenHistory[this.listenHistory.length - 1];
          if (lastLiked.candidate.tags?.length) {
            const tag = lastLiked.candidate.tags[0];
            const tagName = typeof tag === 'object' ? tag.name : tag;
            if (tagName) this.adjustments.boostedGenres.push(tagName);
          }
        }
        break;

      case 'something_different':
        // Boost graph weight → more exploration
        this.adjustments.intentOverride.discovery =
          Math.min(1, (this.adjustments.intentOverride.discovery ?? 0.5) + 0.3);
        break;
    }

    return { ...this.adjustments };
  }

  /**
   * Check if intervention should be triggered.
   */
  shouldIntervene() {
    return this.consecutiveSkips >= 3;
  }

  /**
   * Reset ephemeral state (called on session end).
   */
  reset() {
    this.consecutiveSkips = 0;
    this.skipHistory      = [];
    this.listenHistory    = [];
    this.adjustments      = {
      penalizedGenres: [],
      boostedGenres:   [],
      intentOverride:  {},
      feedback:        [],
    };
  }

  _triggerIntervention(lastCandidate) {
    if (this.onIntervention) {
      this.onIntervention(this.adjustments, lastCandidate);
    }
  }

  /**
   * Persist accumulated signals to DataStore so TasteGame + Scout can read them.
   * This is the Phase 2E feedback loop — SessionDJ writes, other agents read.
   */
  _persistSignals() {
    try {
      const signals = DataStore.getSessionSignals();
      signals.skippedGenres = [...new Set([...signals.skippedGenres, ...this.adjustments.penalizedGenres])];
      signals.lovedGenres   = [...new Set([...signals.lovedGenres, ...this.adjustments.boostedGenres])];

      // Track skipped artists from skip history
      const skippedArtistNames = this.skipHistory
        .filter(s => s.listenMs < 10000 && s.candidate?.artistName)
        .map(s => s.candidate.artistName);
      signals.skippedArtists = [...new Set([...signals.skippedArtists, ...skippedArtistNames])];

      DataStore.setSessionSignals(signals);
    } catch (e) {
      // DataStore may not be available in test environments
    }
  }
}
