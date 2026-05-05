/**
 * Agent Music — Playlist Scheduler
 * Proactively generates playlists in the background so users always have
 * fresh, curated content waiting. Uses the UserModel to generate intelligent
 * intent seeds rather than generic prompts.
 *
 * Lifecycle:
 *   - start()  — begins the cron loop (called once on app init)
 *   - stop()   — clears the interval (cleanup)
 *
 * Triggers (besides cron):
 *   - On app launch (if library is stale or empty)
 *   - After Taste Game rounds complete
 *   - After Reflection Agent runs (taste model updated)
 *
 * Staleness:
 *   - Unlistened playlists expire after 7 days
 *   - Listened playlists expire after 3 days
 *   - Purge runs on every cron tick
 *
 * Cost controls:
 *   - Won't generate if user has ≥3 unlistened playlists
 *   - Staggered generation (5s gaps between playlists)
 *   - Max 4 playlists per run
 *   - Min 15 minutes between runs
 */

import { DataStore } from '../data/data-store.js';
import { UserModel } from './user-model.js';

const MAX_UNLISTENED = 12;        // Keep up to 12 queued playlists (increased for demo)
const MAX_PER_RUN = 1;            // Generate ONLY 1 per run to avoid rate limits/bad data
const GENERATION_GAP_MS = 5000;
const MIN_RUN_INTERVAL_MS = 10 * 1000;        // Allow a run every 10 seconds
const CRON_INTERVAL_MS    = 45 * 1000;        // Check and generate 1 playlist every 45 seconds
const STALE_UNLISTENED_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
const STALE_LISTENED_MS   = 3 * 24 * 60 * 60 * 1000;  // 3 days

export class PlaylistScheduler {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this._running = false;
    this._intervalId = null;
  }

  /**
   * Start the cron loop. Call once on app init.
   * Immediately runs a check, then repeats on interval.
   */
  start() {
    // Initial run after a short delay to let the UI settle
    setTimeout(() => {
      this._tick();
    }, 3000);

    // Recurring cron — keeps Discover page fresh
    this._intervalId = setInterval(() => {
      this._tick();
    }, CRON_INTERVAL_MS);

    console.log(`PlaylistScheduler: Cron started (every ${CRON_INTERVAL_MS / 60000}min)`);
  }

  /**
   * Stop the cron loop (cleanup).
   */
  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Returns true if a generation run is actively in progress right now.
   * Used by the Home page to decide whether to show the skeleton card.
   */
  isCurrentlyRunning() {
    return this._running === true;
  }

  /**
   * Single cron tick: purge stale playlists, then generate new ones if needed.
   */
  async _tick() {
    this.purgeStale();
    await this.refreshIfNeeded();
  }

  /**
   * Remove playlists that have gone stale.
   * Unlistened → 7 days. Listened → 3 days.
   * Dispatches a library-updated event if anything changed.
   */
  purgeStale() {
    const library = DataStore.getPlaylistLibrary();
    const now = Date.now();
    const before = library.length;

    const fresh = library.filter(p => {
      const age = now - (p.createdAt || 0);
      if (p.listenedAt) return age < STALE_LISTENED_MS;
      return age < STALE_UNLISTENED_MS;
    });

    if (fresh.length < before) {
      DataStore.save('playlist_library', fresh);
      console.log(`PlaylistScheduler: Purged ${before - fresh.length} stale playlist(s)`);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('agentmusic:library-updated'));
      }
    }
  }


  /**
   * Check if the library needs refreshing and generate playlists if so.
   * Safe to call frequently — it guards against concurrent runs and rate limits.
   */
  async refreshIfNeeded() {
    if (this._running) return;

    // Check rate limit
    const state = DataStore.getSchedulerState();
    if (state.lastRunAt && (Date.now() - state.lastRunAt) < MIN_RUN_INTERVAL_MS) {
      return;
    }

    const unlistened = DataStore.getUnlistenedCount();
    if (unlistened >= MAX_UNLISTENED) return;

    const slotsNeeded = Math.min(MAX_PER_RUN, MAX_UNLISTENED - unlistened);
    if (slotsNeeded <= 0) return;

    this._running = true;
    DataStore.setSchedulerState({ lastRunAt: Date.now(), isRunning: true });

    try {
      const seeds = this._generateIntentSeeds();
      console.log(`PlaylistScheduler: Generating ${Math.min(slotsNeeded, seeds.length)} playlists...`);

      for (let i = 0; i < Math.min(slotsNeeded, seeds.length); i++) {
        const seed = seeds[i];

        try {
          // Stagger generation to avoid rate limits
          if (i > 0) await new Promise(r => setTimeout(r, GENERATION_GAP_MS));

          console.log(`PlaylistScheduler: Generating "${seed.intent}" (${i + 1}/${slotsNeeded})`);
          const ctx = await this.orchestrator.generatePlaylist('user_local', seed.intent);

          DataStore.saveToLibrary(ctx, seed.intent, 'scheduler');

          // Dispatch event so UI can update if visible
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('agentmusic:library-updated'));
          }
        } catch (err) {
          console.warn(`PlaylistScheduler: Failed to generate "${seed.intent}":`, err.message);
        }
      }
    } finally {
      this._running = false;
      DataStore.setSchedulerState({ lastRunAt: Date.now(), isRunning: false });
    }
  }

  /**
   * Generate intelligent intent seeds based on the UserModel.
   * These are the "themes" that drive background playlist generation.
   * Returns an array of { intent, category } objects.
   */
  _generateIntentSeeds() {
    const seeds = [];

    try {
      const tier1 = UserModel.loadTier1();
      const episodic = UserModel.getEpisodicMemory();
      const prefs = DataStore.getExplicitPreferences();
      const eloRatings = DataStore.getEloRatings();

      // Pre-compute reusable data
      const topArtists = Object.values(eloRatings)
        .filter(a => a.name && a.rating > 1500)
        .sort((a, b) => b.rating - a.rating);
      const topNames = topArtists.slice(0, 3).map(a => a.name);
      const topGenres = [...new Set(topArtists.slice(0, 5).flatMap(a => a.genres || []))].slice(0, 4);

      // Seed 1: Dominant MUSIC dimension — with artist anchoring
      const dims = tier1?.tasteProfile?.musicDimensions;
      if (dims && dims._confidence > 0) {
        const sorted = Object.entries(dims)
          .filter(([k]) => !k.startsWith('_'))  // filter ALL private/metadata keys
          .filter(([, v]) => typeof v === 'number')
          .sort((a, b) => b[1] - a[1]);
        const topDim = sorted[0];
        if (topDim && topNames.length > 0) {
          const dimTemplates = {
            mellow: `The contemplative side of ${topNames[0]} — acoustic intimacy, soft piano, and late-night warmth in the vein of ${topGenres[0] || 'your quieter favorites'}`,
            unpretentious: `Honest songwriting like ${topNames[0]} at their most stripped-back — no pretension, just groove and feeling`,
            sophisticated: `Complex arrangements and harmonic depth — the intricate ${topGenres[0] || 'jazz-adjacent'} side of your taste, channeling what makes ${topNames[0]} tick`,
            intense: `Raw energy and catharsis — the distorted, emotional edge of ${topNames[0]} and the heavier corner of your ${topGenres[0] || 'rock'} world`,
            contemporary: `Cutting-edge production and fresh sonics — artists pushing ${topGenres[0] || 'electronic'} forward the way ${topNames[0]} redefined their lane`,
          };
          const intent = dimTemplates[topDim[0]];
          // Only push if we have a real template — never let raw key names leak into intents
          if (intent) {
            seeds.push({ intent, category: 'dimension' });
          } else if (topNames.length > 0) {
            seeds.push({
              intent: `A curated mix built around ${topNames.slice(0, 2).join(' and ')} — deep cuts, adjacent artists, and hidden gems from their sonic world`,
              category: 'dimension',
            });
          }
        }
      }

      // Seed 2: Drift momentum — with specific subgenre and artist context
      const driftTrends = DataStore.load('drift_trends');
      if (driftTrends?.genreMomentum?.length > 0) {
        const rising = driftTrends.genreMomentum[0];
        const genre = rising.genre || rising;
        const genreArtists = topArtists
          .filter(a => (a.genres || []).some(g => g.toLowerCase().includes(genre.toLowerCase())))
          .map(a => a.name)
          .slice(0, 2);
        const anchor = genreArtists.length > 0 ? ` — following the thread from ${genreArtists.join(' and ')}` : '';
        seeds.push({
          intent: `Your ${genre} awakening${anchor}. You've been gravitating here in recent sessions — let's go deeper into the subgenres and scenes you haven't found yet`,
          category: 'drift',
        });
      }

      // Seed 3: Coverage gap — bridged through familiar taste
      const genreDist = tier1?.tasteProfile?.genreDistribution;
      if (genreDist) {
        const underExplored = Object.entries(genreDist)
          .filter(([k]) => k !== '_confidence')
          .sort((a, b) => a[1] - b[1])
          .filter(([, v]) => v > 0);
        if (underExplored.length > 0 && topNames.length > 0) {
          const gapGenre = underExplored[0][0];
          seeds.push({
            intent: `Your ${topGenres[0] || 'music'} ear might love the ${gapGenre} world — artists who share the DNA of ${topNames[0]} but operate in ${gapGenre}. Think cross-pollination, not genre tourism`,
            category: 'coverage_gap',
          });
        }
      }

      // Seed 4: Time-contextual — always generate regardless of UserModel state
      const hour = new Date().getHours();
      const timeAnchor = topNames.length > 0 ? topNames[Math.floor(Math.random() * topNames.length)] : null;
      if (hour >= 6 && hour < 10) {
        seeds.push({ intent: `Morning clarity — ${timeAnchor ? `the gentler side of ${timeAnchor} and ` : ''}acoustic warmth to ease into the day. No abrasive edges, just light and melody`, category: 'temporal' });
      } else if (hour >= 10 && hour < 14) {
        seeds.push({ intent: `Focus mode — instrumental music that stays out of the way. Steady, rhythmic, engineered for concentration${timeAnchor ? `. Think ${timeAnchor} on their most restrained` : ''}`, category: 'temporal' });
      } else if (hour >= 14 && hour < 18) {
        seeds.push({ intent: `Afternoon energy — the upbeat, rhythmic side of your taste${timeAnchor ? `, starting from ${timeAnchor}` : ''}. Music that makes you want to move`, category: 'temporal' });
      } else if (hour >= 18 && hour < 22) {
        seeds.push({ intent: `Evening wind-down — ${timeAnchor ? `the warm, contemplative textures of ${timeAnchor} and ` : ''}rich atmospheric sounds for unwinding after dark`, category: 'temporal' });
      } else {
        seeds.push({ intent: `3am listening — nocturnal ambient and atmospheric music for the insomniac hours${timeAnchor ? `. The shadowy corners of ${timeAnchor}'s sonic world` : ''}`, category: 'temporal' });
      }

      // Seed 5: Episodic callback — with session detail
      if (episodic?.sessions?.length > 0) {
        const bestSession = episodic.sessions.find(s => s.satisfaction === 'high');
        if (bestSession) {
          seeds.push({
            intent: `More like "${bestSession.summary || bestSession.intent || 'that great session'}" — the energy and taste that worked so well, but with new discoveries in the same orbit`,
            category: 'episodic',
          });
        }
      }

      // Seed 6: Top artist deep-dive — always generate if we have any rated artists
      if (topArtists.length > 0) {
        const pick = topArtists[Math.floor(Math.random() * Math.min(3, topArtists.length))];
        const genres = (pick.genres || []).slice(0, 2).join(' and ');
        seeds.push({
          intent: `Deep inside the world of ${pick.name} — the collaborators, side projects, influences, and sonic descendants that make ${genres || 'their sound'} what it is. Deep cuts welcome`,
          category: 'artist_dive',
        });
      }

      // Seed 7: Remembered preferences from chat — verbatim quote + context
      const memories = prefs.agent_memories || [];
      if (memories.length > 0) {
        const recent = memories[memories.length - 1];
        const artistContext = topNames.length > 0 ? ` Given your love of ${topNames.slice(0, 2).join(' and ')}, ` : ' ';
        seeds.push({
          intent: `You told me: "${recent}"${artistContext}— here's what that sounds like as a playlist`,
          category: 'memory',
        });
      }

    } catch (e) {
      console.warn('PlaylistScheduler: Seed generation partially failed:', e.message);
    }

    // Shuffle to avoid always generating in the same order
    for (let i = seeds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
    }

    // Pad with fallbacks if we couldn't generate enough organic seeds
    if (seeds.length < 3) {
      const fallbacks = [
        { intent: 'Critically acclaimed albums from the past year that deserve more attention — the ones the algorithm missed', category: 'fallback' },
        { intent: 'Hidden gems and B-sides — underappreciated tracks from artists who never got their due', category: 'fallback' },
        { intent: 'Genre-spanning connections — the invisible threads that link jazz to electronic to folk to everything in between', category: 'fallback' },
      ];
      for (const f of fallbacks) {
        if (!seeds.some(s => s.intent === f.intent)) {
          seeds.push(f);
        }
      }
    }

    return seeds;
  }
}
