/**
 * TasteGraph — Taste Game Component
 *
 * Artist pool strategy:
 *   1. User's top 50 Spotify artists (sorted by listen frequency)
 *   2. Last.fm similar artists for top 10 → search Spotify for each
 *      → deduped pool of ~100-200 artists for rich variety
 *
 * Game mechanics:
 *   - Unlimited rounds — play as long as you want
 *   - "Finish Session" button appears after 5+ rounds
 *   - Artists selected weighted randomly: known > similar > new (ensures variety)
 *   - Running leaderboard updates live
 */
import { ProfilerAgent } from '../../agents/profiler-agent.js';
import { DataStore } from '../../data/data-store.js';
import { getSimilarArtists } from '../../data/lastfm-api.js';
import { getArtistTopTracks, searchArtist, searchArtists } from '../../data/spotify-api.js';
import { initSpotifyPlayer, playTrack, pauseTrack } from '../../data/spotify-player.js';
import * as elo from '../../engine/elo.js';

const DEFAULT_ELO = 1500;
const MIN_ROUNDS_TO_FINISH = 5;

// Anchor artists representing broad, distinct macro-genres for cold-start profiling
const COLD_START_ANCHORS = [
  // Pop
  'Michael Jackson', 'Madonna', 'Prince', 'Lady Gaga', 'Taylor Swift', 'The Weeknd', 'Britney Spears', 'Ariana Grande',
  // Hip-Hop
  '2Pac', 'The Notorious B.I.G.', 'Wu-Tang Clan', 'JAY-Z', 'Outkast', 'Kendrick Lamar', 'Kanye West', 'Nas', 'Missy Elliott',
  // Rock / Classic Rock
  'The Beatles', 'The Rolling Stones', 'Led Zeppelin', 'Pink Floyd', 'Queen', 'David Bowie', 'Fleetwood Mac', 'Jimi Hendrix',
  // R&B / Soul
  'Stevie Wonder', 'Aretha Franklin', 'Marvin Gaye', 'James Brown', 'Erykah Badu', 'Lauryn Hill', 'Frank Ocean', 'Beyoncé',
  // Electronic / Dance
  'Kraftwerk', 'Daft Punk', 'Aphex Twin', 'The Chemical Brothers', 'Skrillex', 'Burial', 'Deadmau5', 'Justice',
  // Metal
  'Black Sabbath', 'Iron Maiden', 'Metallica', 'Slayer', 'Tool', 'Megadeth', 'Slipknot', 'System Of A Down',
  // Country / Folk
  'Johnny Cash', 'Dolly Parton', 'Willie Nelson', 'Bob Dylan', 'Joni Mitchell', 'Shania Twain', 'Garth Brooks', 'Kacey Musgraves',
  // Alternative / Indie
  'The Smiths', 'Nirvana', 'Radiohead', 'The Strokes', 'Tame Impala', 'Arcade Fire', 'Arctic Monkeys', 'Pixies',
  // Jazz / Blues
  'Miles Davis', 'John Coltrane', 'B.B. King', 'Muddy Waters', 'Ella Fitzgerald', 'Louis Armstrong', 'Nina Simone'
];

// Hybrid playback logic attached globally for onclick handlers
window.playTrackHybrid = async (uri, previewUrl, artistId) => {
  const btn = document.getElementById(`play-btn-${artistId}`);
  if (!btn) return;
  const isPlaying = btn.dataset.playing === 'true';
  
  // Pause everything else
  document.querySelectorAll('.play-btn-hybrid').forEach(b => {
    b.dataset.playing = 'false';
    b.innerHTML = '▶ Play Top Track';
    b.style.background = '';
    b.style.color = '';
    b.style.borderColor = 'var(--border-glass)';
  });
  document.querySelectorAll('audio').forEach(a => {
    a.pause();
    a.currentTime = 0;
  });
  
  try { await pauseTrack(); } catch(e) {}
  
  if (!isPlaying) {
    btn.dataset.playing = 'true';
    btn.innerHTML = '⏸ Playing...';
    btn.style.background = 'var(--accent-primary)';
    btn.style.color = 'white';
    btn.style.borderColor = 'var(--accent-primary)';
    
    try {
      // 1. Try playing full song via Web Playback SDK (Premium)
      await playTrack(uri);
    } catch (err) {
      // 2. Fallback to 30-sec preview (Free tier or disconnected)
      if (previewUrl) {
        const audio = document.getElementById(`audio-${artistId}`);
        if (audio) {
          audio.play();
          btn.innerHTML = '⏸ Previewing...';
        }
      } else {
        btn.innerHTML = '❌ No Preview (Premium Req)';
        setTimeout(() => {
          btn.dataset.playing = 'false';
          btn.innerHTML = '▶ Play Top Track';
          btn.style.background = '';
          btn.style.color = '';
        }, 2000);
      }
    }
  }
};

export class TasteGame {
  constructor(container) {
    this.container = container;
    this.profiler  = new ProfilerAgent();

    // Artist pools
    this.knownArtists   = []; // anchors (base game pool)
    this.spotifyArtists = []; // from user's actual Spotify listening data (injected over time)
    this.relatedArtists = []; // from Last.fm similar artist search
    this.allArtists     = []; // merged, deduped
    this.roundsPlayed  = 0;
    this.pair          = null;
    this.isLoading     = false;
    this.history       = []; // for undo functionality
    this.injectedQueue = []; // queue of LLM-injected artists
    this.calibrationTask = null; // Beli-style binary search state
    this.winStreaks    = {}; // Track hot streaks for dynamic expansion

    // Listen for LLM injections
    window.addEventListener('tastegraph:inject-artists', async (e) => {
      const names = e.detail;
      const newArtists = [];
      for (const name of names) {
        try {
          const found = await searchArtist(name);
          if (found) newArtists.push(found);
        } catch(err) {}
      }
      
      for (const a of newArtists) {
        if (!this.allArtists.some(existing => existing.id === a.id)) {
          a.isConciergePick = true; // Mark them specially
          this.allArtists.push(a);
          this.injectedQueue.push(a);
        }
      }
      
      // If we're waiting for the next round (or skipping), auto-trigger it if possible.
    });
  }

  async init() {
    this.renderLoading('Building your artist pool...');
    try {
      const tasteState = await this.profiler.buildTasteState();
      
      // 1. Save Spotify listening data to be "sprinkled in" strategically later
      this.spotifyArtists = tasteState.artists || [];

      // 2. Intelligent Anchor Selection: Prioritize real preferences over random cold-start anchors
      this.renderLoading('Building the foundational artist pool...');
      
      const explicitFavorites = tasteState.explicitPreferences?.favorite_artists || [];
      const spotifyTop = this.spotifyArtists.slice(0, 15).map(a => a.name);
      
      let sessionAnchors = [...new Set([...explicitFavorites, ...spotifyTop])];
      
      // If the user is brand new (no Spotify history, no explicit preferences), fallback to broad anchors
      if (sessionAnchors.length < 5) {
        const fallback = [...COLD_START_ANCHORS].sort(() => 0.5 - Math.random()).slice(0, 15 - sessionAnchors.length);
        sessionAnchors.push(...fallback);
      } else {
        // Shuffle and limit to 15
        sessionAnchors = sessionAnchors.sort(() => 0.5 - Math.random()).slice(0, 15);
      }
      
      const resolvedAnchors = [];
      const anchorPromises = sessionAnchors.map(name => searchArtist(name).catch(() => null));
      const results = await Promise.all(anchorPromises);
      for (const found of results) {
        if (found) resolvedAnchors.push(found);
      }
      this.knownArtists = resolvedAnchors;

      // 3. Initial expansion based on intelligent anchors
      this.renderLoading('Discovering related artists...');
      await this._expandPool(this.knownArtists.slice(0, 5), tasteState.topGenres || []);

      // Merge and dedup by Spotify ID
      this._mergePools();

      if (this.allArtists.length < 2) {
        this.renderError('Failed to initialize artist pool. Please try again.');
        return;
      }

      // Initialize Spotify Web Player in background if user has Premium
      initSpotifyPlayer().catch(err => console.log('Spotify Web Player not available:', err));

      this.roundsPlayed = 0;
      this.nextRound();
    } catch (err) {
      this.renderError('Failed to initialize game.');
      console.error(err);
    }
  }

  _mergePools() {
    const seen = new Set();
    this.allArtists = [...this.knownArtists, ...this.relatedArtists].filter(a => {
      if (!a?.id || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }

  /**
   * Expand the artist pool with Last.fm similar artists resolved through Spotify search.
   * Fetches similar artists for each seed, searches Spotify, deduplicates.
   */
  async _expandPool(seedArtists, topGenres) {
    const knownIds  = new Set(this.knownArtists.map(a => a.id));
    const namesSeen = new Set(this.knownArtists.map(a => a.name.toLowerCase()));
    const resolved  = [];

    // Fetch similar artists from Last.fm in parallel (batch 3 at a time)
    for (let i = 0; i < seedArtists.length; i += 3) {
      const batch = seedArtists.slice(i, i + 3);
      const results = await Promise.all(
        batch.map(seed => getSimilarArtists(seed.name, 8).catch(() => []))
      );

      const similarNames = results.flat().map(a => a.name);
      const uniqueNames  = [...new Set(similarNames)].filter(
        n => !namesSeen.has(n.toLowerCase())
      );

      // Search Spotify for each unique name
      const spotifyResults = await Promise.all(
        uniqueNames.slice(0, 12).map(name => searchArtist(name).catch(() => null))
      );

      for (const artist of spotifyResults) {
        if (artist && !knownIds.has(artist.id) && !namesSeen.has(artist.name.toLowerCase())) {
          namesSeen.add(artist.name.toLowerCase());
          knownIds.add(artist.id);
          resolved.push(artist);
        }
      }
    }

    this.relatedArtists = resolved;
  }

  /**
   * Pick a random pair — weighted toward known artists to ensure
   * the user recognises at least one side, while still surfacing
   * discovery artists regularly.
   *
   * Weight: known=3, related=1 (so ~75% chance of a known artist per pick)
   */
  _pickWeightedArtist(excludeId = null) {
    const eloRatings = DataStore.getEloRatings();
    const pool = [];
    
    // Known artists — weighted by information gain
    for (const a of this.knownArtists) { 
      const skips = eloRatings[a.id]?.skips || 0;
      const comps = eloRatings[a.id]?.comparison_count || 0;
      if (a.id !== excludeId && !this._hasPlayed(a.id, excludeId) && !(skips >= 3 && comps === 0)) {
        const weight = this._getInfoGainWeight(eloRatings[a.id]);
        for (let i = 0; i < weight; i++) pool.push(a);
      } 
    }
    
    // Discovery artists — weighted but still dampened by comparison count
    for (const a of this.relatedArtists) { 
      const skips = eloRatings[a.id]?.skips || 0;
      const comps = eloRatings[a.id]?.comparison_count || 0;
      if (a.id !== excludeId && !this._hasPlayed(a.id, excludeId) && !(skips >= 3 && comps === 0)) { 
        const weight = this._getInfoGainWeight(eloRatings[a.id]);
        for (let i = 0; i < weight; i++) pool.push(a);
      } 
    }                              

    if (pool.length === 0) {
      const knownIds = new Set(this.knownArtists.map(a => a.id));
      const viableAll = this.allArtists;
      return viableAll.find(a => a.id !== excludeId && !this._hasPlayed(a.id, excludeId));
    }
    
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Calculate information-gain weight for an artist.
   * Artists with many comparisons and predictable outcomes get lower weight.
   * Returns 0-3 (pool entries): 3 = fresh/uncertain, 0 = fully settled.
   *
   * IMPORTANT: settled artists HARD-return 0 — no probabilistic leakage.
   * A settled artist can only appear as a calibration *opponent*, never as a
   * free participant in the general pool.
   */
  _getInfoGainWeight(eloData) {
    if (!eloData) return 3; // Never compared = maximum weight
    const comps = eloData.comparison_count || 0;
    if (comps === 0) return 3;

    // Hard-zero for settled artists — this is the primary fix for the
    // "Jeff Buckley appearing every round" regression.
    if (this._isSettled(eloData)) return 0;

    const wins = eloData.wins || 0;
    const winRate = wins / comps;
    // Information entropy: most info when winRate ~ 0.5, least when near 0 or 1
    const entropy = -(winRate * Math.log2(winRate + 0.001) + (1 - winRate) * Math.log2(1 - winRate + 0.001));

    // Decay curve: weight drops with comparison count, faster for predictable artists
    // comps=0→3, comps=5→2, comps=10→1-2, comps=15+→0-1
    const decayFactor = Math.max(0, 1 - (comps / 20));
    const weight = Math.round(3 * decayFactor * (0.3 + 0.7 * entropy));
    return Math.max(0, Math.min(3, weight));
  }

  /**
   * Check if an artist is considered "settled" (predictable outcomes, many comparisons).
   */
  _isSettled(eloData) {
    if (!eloData) return false;
    const comps = eloData.comparison_count || 0;
    if (comps < 6) return false;
    const wins = eloData.wins || 0;
    const winRate = wins / comps;
    return winRate > 0.75 || winRate < 0.25;
  }

  /**
   * Coverage Gap Detection — Beli-style.
   * Identifies the macro-genre/era bucket with the fewest total comparisons
   * so the game can proactively surface under-explored taste territory.
   *
   * Phase 2E: Reads SessionDJ signals to deprioritize genres the user is skipping.
   * Phase 3:  Checks era/decade buckets alongside genre buckets.
   *
   * Returns { label, candidates[] } or null if coverage is balanced.
   */
  _getCoverageGap(eloRatings) {
    const GENRE_BUCKETS = [
      { label: 'hip-hop',     match: ['hip hop', 'rap', 'trap', 'drill'] },
      { label: 'rock',        match: ['rock', 'punk', 'grunge', 'metal', 'hardcore'] },
      { label: 'pop',         match: ['pop', 'dance pop', 'electropop'] },
      { label: 'electronic',  match: ['electronic', 'edm', 'house', 'techno', 'ambient', 'experimental'] },
      { label: 'r&b / soul',  match: ['r&b', 'soul', 'funk', 'neo soul'] },
      { label: 'jazz / blues',match: ['jazz', 'blues', 'swing', 'bop'] },
      { label: 'folk / country', match: ['folk', 'country', 'americana', 'bluegrass'] },
      { label: 'classical',   match: ['classical', 'orchestral', 'chamber'] },
    ];

    // Phase 3: Era buckets based on artist beginYear (from MusicBrainz, cached in EloRating)
    const ERA_BUCKETS = [
      { label: 'pre-1980s classics', eraTest: (year) => year > 0 && year < 1980 },
      { label: '80s–90s',            eraTest: (year) => year >= 1980 && year < 2000 },
      { label: '2000s–2010s',        eraTest: (year) => year >= 2000 && year < 2015 },
      { label: 'recent (2015+)',     eraTest: (year) => year >= 2015 },
    ];

    // Phase 2E: Read session signals — deprioritize genres the user is actively skipping
    let sessionSkips = [];
    try {
      sessionSkips = DataStore.getSessionSignals()?.skippedGenres || [];
    } catch (e) { /* DataStore may not be available in tests */ }

    // --- Genre coverage ---
    const genreCoverage = GENRE_BUCKETS.map(bucket => {
      let totalComps = 0;
      const candidates = [];
      for (const artist of this.allArtists) {
        const artistGenres = (artist.genres || []).map(g => g.toLowerCase());
        const matches = bucket.match.some(m => artistGenres.some(g => g.includes(m)));
        if (matches) {
          const comps = eloRatings[artist.id]?.comparison_count || 0;
          totalComps += comps;
          if (this._getInfoGainWeight(eloRatings[artist.id]) > 0) candidates.push(artist);
        }
      }
      return { ...bucket, totalComps, candidates, type: 'genre' };
    }).filter(b => b.candidates.length >= 2);

    // --- Era coverage ---
    const eraCoverage = ERA_BUCKETS.map(bucket => {
      let totalComps = 0;
      const candidates = [];
      for (const artist of this.allArtists) {
        const beginYear = eloRatings[artist.id]?.beginYear || 0;
        if (beginYear > 0 && bucket.eraTest(beginYear)) {
          const comps = eloRatings[artist.id]?.comparison_count || 0;
          totalComps += comps;
          if (this._getInfoGainWeight(eloRatings[artist.id]) > 0) candidates.push(artist);
        }
      }
      return { ...bucket, totalComps, candidates, type: 'era' };
    }).filter(b => b.candidates.length >= 2);

    // Merge genre + era coverage
    let coverage = [...genreCoverage, ...eraCoverage];

    // Phase 2E: Filter out genres the user is actively skipping this session
    if (sessionSkips.length > 0) {
      const skipSet = new Set(sessionSkips.map(g => g.toLowerCase()));
      coverage = coverage.filter(b =>
        !b.match || !b.match.some(m => skipSet.has(m))
      );
    }

    if (coverage.length === 0) return null;

    // Sort by fewest comparisons — most under-explored first
    coverage.sort((a, b) => a.totalComps - b.totalComps);
    const gap = coverage[0];

    // Only fire if this bucket is meaningfully behind the average
    const avgComps = coverage.reduce((s, b) => s + b.totalComps, 0) / coverage.length;
    if (gap.totalComps > avgComps * 0.6) return null; // Close enough — don't force it

    // Sort candidates by least-compared first
    gap.candidates.sort((a, b) =>
      (eloRatings[a.id]?.comparison_count || 0) - (eloRatings[b.id]?.comparison_count || 0)
    );
    return gap;
  }

  _getClosestAnchor(targetId, knownRanked, eloRatings) {
    const targetElo = eloRatings[targetId]?.rating || 1500;
    
    // Calculate distance for all valid anchors
    const candidates = [];
    for (const anchor of knownRanked) {
      if (anchor.id === targetId || this._hasPlayed(targetId, anchor.id)) continue;
      const anchorElo = eloRatings[anchor.id]?.rating || 1500;
      candidates.push({ anchor, diff: Math.abs(anchorElo - targetElo) });
    }
    
    if (candidates.length === 0) return knownRanked[Math.floor(Math.random() * knownRanked.length)];
    
    // Sort by absolute distance and take the top 7 closest
    candidates.sort((a, b) => a.diff - b.diff);
    const poolSize = Math.min(7, candidates.length);
    const topCandidates = candidates.slice(0, poolSize);
    
    // Pick one randomly from the pool to keep the game fresh!
    return topCandidates[Math.floor(Math.random() * topCandidates.length)].anchor;
  }

  _hasPlayed(aId, bId) {
    const eloRatings = DataStore.getEloRatings();
    return eloRatings[aId]?.matchups?.[bId] === true;
  }

  /**
   * Active Learning / Strategic Pair Selection
   * Instead of purely random matching, we use strategies to maximize information gain
   * and explore the user's taste boundaries, drawing from active learning principles.
   */
  _selectStrategicPair() {
    const strategyRoll = Math.random();
    const eloRatings = DataStore.getEloRatings();
    
    // Filter out "rejected" discoveries. If a discovery (an artist not in the known base)
    // drops below 1450 Elo, they have lost multiple times and we should stop showing them.
    const knownIds = new Set(this.knownArtists.map(a => a.id));
    const viableRelated = this.relatedArtists;
    
    // Filter ALL pools by information gain — settled artists are HARD-excluded.
    // Weight 0 = nothing left to learn from this artist as a free participant.
    // They can still appear as *opponents* in a calibration task.
    const viableAll = this.allArtists.filter(a => this._getInfoGainWeight(eloRatings[a.id]) > 0);

    // Sort known artists by Elo to identify "benchmarks"
    const knownRanked = this.knownArtists
      .slice()
      .sort((a, b) => (eloRatings[b.id]?.rating || 1500) - (eloRatings[a.id]?.rating || 1500));

    // 0. Beli-Style Calibration (Binary Search)
    // If we are actively calibrating a new artist, or need to start one
    if (this.calibrationTask) {
      const { targetId, low, high } = this.calibrationTask;
      const targetArtist = this.allArtists.find(a => a.id === targetId);
      
      if (!targetArtist) {
        this.calibrationTask = null;
      } else {
        // Build ranked opponents list, EXCLUDING the target artist itself
        const rankedOpponents = this.knownArtists
          .filter(a => eloRatings[a.id] && a.id !== targetId)
          .sort((a, b) => eloRatings[b.id].rating - eloRatings[a.id].rating);
          
        // Clamp bounds to valid range
        const clampedHigh = Math.min(high, rankedOpponents.length - 1);
        
        if (rankedOpponents.length > 0 && low <= clampedHigh) {
          const rawMid = Math.floor((low + clampedHigh) / 2);
          
          // Add up to 15% noise to the binary search index to increase variety!
          const windowSize = Math.max(0, Math.floor((clampedHigh - low) * 0.15));
          const noise = Math.floor(Math.random() * (windowSize * 2 + 1)) - windowSize;
          let mid = Math.max(low, Math.min(clampedHigh, rawMid + noise));
          
          let opponent = rankedOpponents[mid];
          
          // Ensure we haven't already matched them during this calibration
          if (this._hasPlayed(targetId, opponent.id, eloRatings)) {
             let found = false;
             for (let i = 1; i <= (clampedHigh - low); i++) {
                if (mid + i <= clampedHigh && !this._hasPlayed(targetId, rankedOpponents[mid + i].id, eloRatings)) { mid = mid + i; found = true; break; }
                if (mid - i >= low && !this._hasPlayed(targetId, rankedOpponents[mid - i].id, eloRatings)) { mid = mid - i; found = true; break; }
             }
             if (!found) {
                // All opponents in bounds are exhausted; terminate calibration early
                this.calibrationTask.low = clampedHigh + 1;
                return this._selectStrategicPair();
             }
             opponent = rankedOpponents[mid];
          }

          this.calibrationTask.mid = mid;
          this.calibrationTask.high = clampedHigh; // Keep bounds valid
          return { A: targetArtist, B: opponent, strategy: 'calibration', insight: `⚖️ Calibrating: Where does ${targetArtist.name} rank?` };
        } else {
          // bounds collapsed or no valid opponents, finish task
          this.calibrationTask = null;
        }
      }
    }

    // Try to start a new calibration task if we have fresh uncalibrated artists
    const uncalibrated = this.allArtists.find(a => !eloRatings[a.id]);
    
    if (uncalibrated && knownRanked.length >= 3) {
      this.calibrationTask = {
        targetId: uncalibrated.id,
        low: 0,
        high: knownRanked.length - 1,
        mid: -1
      };
      // Recursively call to trigger the calibration
      return this._selectStrategicPair();
    }

    // 0. Broad Exploration Phase (Rounds 1-4)
    // If we are just starting (especially for cold-starts without Spotify), force Genre Clashes
    // between anchors to quickly map out the user's broad macro-preferences without jumping to conclusions.
    if (this.roundsPlayed <= 4 && viableAll.length >= 2) {
      const a = viableAll[Math.floor(Math.random() * viableAll.length)];
      const aGenres = new Set(a.genres || []);
      const clashCandidates = viableAll.filter(c => c.id !== a.id && !this._hasPlayed(a.id, c.id) && !(c.genres || []).some(g => aGenres.has(g)));
      if (clashCandidates.length > 0) {
        const b = clashCandidates[Math.floor(Math.random() * clashCandidates.length)];
        return { A: a, B: b, strategy: 'clash', insight: '🌍 Broad Exploration: Which style do you prefer?' };
      }
    }

    // 1. Concierge Injection (Highest Priority)
    if (this.injectedQueue && this.injectedQueue.length > 0) {
      const b = this.injectedQueue.shift();
      const a = this._getClosestAnchor(b.id, knownRanked, eloRatings);
      const pair = Math.random() > 0.5 ? { A: a, B: b } : { A: b, B: a };
      return { ...pair, strategy: 'injection', insight: '⚔️ Contender: Can this challenger beat your favorites?' };
    }

    // 1.6. Coverage Gap (~15%): Proactively explore an under-covered genre/style.
    // Similar to how Beli prompts you on restaurant categories you haven't rated.
    if (strategyRoll < 0.15) {
      const gap = this._getCoverageGap(eloRatings);
      if (gap && gap.candidates.length >= 2) {
        const [a, b] = gap.candidates;
        const pair = Math.random() > 0.5 ? { A: a, B: b } : { A: b, B: a };
        return { ...pair, strategy: 'coverage', insight: `🗺️ Expanding taste map: Exploring your ${gap.label} preferences` };
      }
    }

    // 1.5. Spotify History Sprinkling (~25% chance if available)
    // Pulls an artist from the user's actual Spotify listening data and pits them against an anchor.
    if (strategyRoll < 0.25 && this.spotifyArtists.length > 0) {
      // Pop a random artist from their listening data
      const bIndex = Math.floor(Math.random() * this.spotifyArtists.length);
      const b = this.spotifyArtists.splice(bIndex, 1)[0];
      
      // Ensure they are in the active pool
      if (!this.allArtists.some(existing => existing.id === b.id)) {
        this.knownArtists.push(b);
        this._mergePools();
      }

      // Pit them against an artist with similar Elo so they have to climb the ladder
      const a = this._getClosestAnchor(b.id, knownRanked, eloRatings);
      const pair = Math.random() > 0.5 ? { A: a, B: b } : { A: b, B: a };
      return { ...pair, strategy: 'spotify_history', insight: '🎧 Listening History: Re-discovering a personal favorite.' };
    }
      
    // 2. The Benchmark Test (~40%): Pit a discovery artist against a top-tier known artist.
    // This quickly establishes if the discovery is a new favorite or just okay.
    if (strategyRoll < 0.4 && viableRelated.length > 0 && knownRanked.length > 0) {
      const b = viableRelated[Math.floor(Math.random() * viableRelated.length)];
      // Pick a known artist with similar Elo
      const a = this._getClosestAnchor(b.id, knownRanked, eloRatings);
      const pair = Math.random() > 0.5 ? { A: a, B: b } : { A: b, B: a };
      return { ...pair, strategy: 'benchmark', insight: '🎯 Benchmark Test: Can this discovery beat a top favorite?' };
    }

    // 2. Uncertainty Sampling (~30%): Pit two artists with the closest Elo scores.
    // This refines the exact ranking boundary between them, providing maximum information gain.
    if (strategyRoll < 0.7 && viableAll.length > 2) {
      // Pick a random artist, then find the one closest to them in Elo
      const a = viableAll[Math.floor(Math.random() * viableAll.length)];
      const aElo = eloRatings[a.id]?.rating || 1500;
      
      let closest = null;
      let minDiff = Infinity;
      
      // Add slight randomness so it's not ALWAYS the exact closest every time
      for (const candidate of viableAll) {
        if (candidate.id === a.id || this._hasPlayed(a.id, candidate.id, eloRatings)) continue;
        const diff = Math.abs((eloRatings[candidate.id]?.rating || 1500) - aElo) + (Math.random() * 30); 
        if (diff < minDiff) {
          minDiff = diff;
          closest = candidate;
        }
      }
      if (closest) {
        const pair = Math.random() > 0.5 ? { A: a, B: closest } : { A: closest, B: a };
        return { ...pair, strategy: 'uncertainty', insight: '⚖️ Tie-Breaker: Resolving a close match in your rankings.' };
      }
    }

    // 3. Genre Clash (~20%): Pit artists with no overlapping genres.
    // Tests preference across broad style boundaries to see which "types" win out.
    if (strategyRoll < 0.9) {
      const a = viableAll[Math.floor(Math.random() * viableAll.length)];
      const aGenres = new Set(a.genres || []);
      
      const clashCandidates = viableAll.filter(c => {
        if (c.id === a.id || this._hasPlayed(a.id, c.id, eloRatings)) return false;
        const cGenres = c.genres || [];
        return !cGenres.some(g => aGenres.has(g)); // No overlap
      });
      
      if (clashCandidates.length > 0) {
        const b = clashCandidates[Math.floor(Math.random() * clashCandidates.length)];
        const pair = Math.random() > 0.5 ? { A: a, B: b } : { A: b, B: a };
        return { ...pair, strategy: 'clash', insight: '🎸 Genre Clash: Testing your style boundaries.' };
      }
    }

    // 4. Fallback: Weighted random (~10% or if strategies fail)
    const a = this._pickWeightedArtist();
    const b = this._pickWeightedArtist(a?.id);
    return { A: a, B: b, strategy: 'random', insight: '🎲 Random Pairing: Exploring the outer edges.' };
  }

  async nextRound() {
    // Stop any playing audio
    document.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
    try { if (window.pauseTrack) await window.pauseTrack(); } catch(e) {}

    this.roundsPlayed++;

    const pair = this._selectStrategicPair();

    if (!pair || !pair.A || !pair.B) {
      this.renderError('Not enough distinct artists to continue. Try generating a playlist!');
      return;
    }

    this.isLoading = true;
    this.pair = pair;

    // Fetch top tracks for audio previews
    try {
      const [tracksA, tracksB] = await Promise.all([
        getArtistTopTracks(pair.A.id),
        getArtistTopTracks(pair.B.id)
      ]);
      pair.A.previewTrack = tracksA.find(t => t.preview_url) || tracksA[0];
      pair.B.previewTrack = tracksB.find(t => t.preview_url) || tracksB[0];
    } catch (err) {
      console.warn("Failed to load audio previews:", err);
    }

    this.isLoading = false;
    this.renderMatchup();
  }

  handleChoice(winnerId) {
    if (!this.pair || this.isLoading) return;
    this.isLoading = true;

    // Stop any playing audio immediately
    document.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
    try { if (window.pauseTrack) window.pauseTrack(); } catch(e) {}

    // Snapshot state for undo functionality
    const eloSnapshot = JSON.parse(JSON.stringify(DataStore.getEloRatings()));
    this.history.push({
      pair: this.pair,
      roundsPlayed: this.roundsPlayed,
      eloSnapshot
    });

    // Handle Beli-style Calibration result
    if (this.calibrationTask) {
      const { targetId, mid } = this.calibrationTask;
      
      // We need to resolve Elo before continuing the search
      this.profiler.processGameResult(this.pair.A.id, this.pair.B.id, winnerId, elo, this.pair.A, this.pair.B);
      
      if (winnerId === targetId) {
        // Target won! It's better than mid, so search upper half (index 0 is best)
        this.calibrationTask.high = mid - 1;
      } else {
        // Target lost! It's worse than mid, search lower half
        this.calibrationTask.low = mid + 1;
      }
      
      if (this.calibrationTask.low > this.calibrationTask.high) {
        // Binary search complete, settle them exactly into the Elo hierarchy
        const finalRatings = DataStore.getEloRatings();
        const knownRanked = this.knownArtists
          .filter(a => finalRatings[a.id] && a.id !== targetId)
          .sort((a, b) => finalRatings[b.id].rating - finalRatings[a.id].rating);
          
        const insertionIndex = this.calibrationTask.low;
        let newElo = 1500;
        
        if (knownRanked.length > 0) {
          if (insertionIndex === 0) {
             newElo = (finalRatings[knownRanked[0]?.id]?.rating || 1500) + 15;
          } else if (insertionIndex >= knownRanked.length) {
             newElo = (finalRatings[knownRanked[knownRanked.length - 1]?.id]?.rating || 1500) - 15;
          } else {
             const eloAbove = finalRatings[knownRanked[insertionIndex - 1]?.id]?.rating || 1500;
             const eloBelow = finalRatings[knownRanked[insertionIndex]?.id]?.rating || 1500;
             newElo = (eloAbove + eloBelow) / 2;
          }
        }
        
        if (finalRatings[targetId]) {
          finalRatings[targetId].rating = newElo;
        }
        DataStore.setEloRatings(finalRatings);
        this.calibrationTask = null;
      }
    } else {
      // Normal Elo Update
      this.profiler.processGameResult(this.pair.A.id, this.pair.B.id, winnerId, elo, this.pair.A, this.pair.B);
    }

    // Initialize Elo for related artists on first encounter
    const ratings = DataStore.getEloRatings();
    for (const artist of [this.pair.A, this.pair.B]) {
      if (!(artist.id in ratings)) {
        ratings[artist.id] = { 
          rating: DEFAULT_ELO, 
          name: artist.name, 
          imageUrl: artist.images?.[0]?.url || null, 
          genres: artist.genres || [],
          macroGenres: artist.macroGenres || [],
          wins: 0,
          losses: 0,
          ties: 0,
          comparison_count: 0,
          last_compared_at: null,
          source: 'game',
          matchups: {}
        };
      }
      if (!ratings[artist.id].matchups) ratings[artist.id].matchups = {};
    }
    
    // Record the exact matchup so we NEVER recycle this exact pair again
    ratings[this.pair.A.id].matchups[this.pair.B.id] = true;
    ratings[this.pair.B.id].matchups[this.pair.A.id] = true;
    
    DataStore.setEloRatings(ratings);

    // Flash winner card
    const winCard = document.getElementById(`card-${winnerId}`);
    if (winCard) {
      winCard.style.transform  = 'scale(1.04)';
      winCard.style.borderColor = 'var(--accent-primary)';
      winCard.style.boxShadow  = 'var(--shadow-glow-strong)';
    }

    // Dynamic Expansion: Every 3 rounds, use the *winner* of the current round
    // to fetch similar artists. This makes the game highly responsive to what you are 
    // actively enjoying in the moment, constantly surfacing new adjacent artists.
    if (this.roundsPlayed % 3 === 0) {
      const winnerArtist = [this.pair.A, this.pair.B].find(a => a.id === winnerId);
      if (winnerArtist) {
        // Expand in background without blocking UI
        this._expandPool([winnerArtist], []).then(() => this._mergePools());
      }
    }

    setTimeout(() => {
      this.isLoading = false;
      this.nextRound();
    }, 350);
  }

  handleSkip(artistIdToDrop = null) {
    if (this.isLoading) return;

    // Snapshot state for undoing a skip
    const eloSnapshot = JSON.parse(JSON.stringify(DataStore.getEloRatings()));
    this.history.push({
      pair: this.pair,
      roundsPlayed: this.roundsPlayed,
      eloSnapshot
    });

    // Track skips to naturally filter out unknown/unrated artists
    const ratings = DataStore.getEloRatings();
    
    if (artistIdToDrop) {
      if (!ratings[artistIdToDrop]) ratings[artistIdToDrop] = { rating: 1500, skips: 0 };
      ratings[artistIdToDrop].skips = (ratings[artistIdToDrop].skips || 0) + 5; // permanently filter them
      if (this.calibrationTask && this.calibrationTask.targetId === artistIdToDrop) {
        this.calibrationTask = null; // Drop the calibration task if target is unknown
      }
    } else {
      for (const artist of [this.pair.A, this.pair.B]) {
        if (ratings[artist.id]) {
          ratings[artist.id].skips = (ratings[artist.id].skips || 0) + 1;
        }
      }
    }
    
    DataStore.setEloRatings(ratings);
    this.nextRound();
  }

  undo() {
    if (this.isLoading || this.history.length === 0) return;
    this.isLoading = true;

    // Stop any playing audio
    document.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
    try { if (window.pauseTrack) window.pauseTrack(); } catch(e) {}

    const previousState = this.history.pop();
    this.roundsPlayed = previousState.roundsPlayed;
    this.pair = previousState.pair;
    DataStore.setEloRatings(previousState.eloSnapshot);
    
    // Make sure we refresh the profiler's view of Elo ratings
    // (since it holds a reference in some cases, though here it just uses the DataStore directly)
    this.isLoading = false;
    this.renderMatchup();
  }

  handleFinish() {
    // Stop any playing audio
    document.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
    try { if (window.pauseTrack) window.pauseTrack(); } catch(e) {}
    
    this.renderSummary();
  }

  // --- Rendering ---

  renderLoading(msg = 'Loading...') {
    this.container.innerHTML = `
      <div class="glass-card" style="padding: var(--space-8); text-align: center;">
        <div style="font-size: 2.5rem; margin-bottom: var(--space-4); animation: pulse 1s infinite;">🎵</div>
        <p style="color: var(--text-secondary);">${msg}</p>
        <p style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: var(--space-2);">This may take a moment…</p>
      </div>
    `;
  }

  renderError(msg) {
    this.container.innerHTML = `
      <div class="glass-card" style="padding: var(--space-8); text-align: center; border-color: var(--accent-pink);">
        <div style="font-size: 3rem; margin-bottom: var(--space-4);">❌</div>
        <p style="color: var(--text-primary);">${msg}</p>
        <button class="btn btn-primary" style="margin-top: var(--space-4);" onclick="location.hash='#/'">Return Home</button>
      </div>
    `;
  }

  renderMatchup() {
    const { A, B } = this.pair;
    const imgA = A.images?.[0]?.url || null;
    const imgB = B.images?.[0]?.url || null;

    // Determine pool labels
    const isKnownA = this.knownArtists.some(a => a.id === A.id);
    const isKnownB = this.knownArtists.some(a => a.id === B.id);

    const showFinish = this.roundsPlayed >= MIN_ROUNDS_TO_FINISH;
    const top3 = this.profiler.getTopRankedArtists(3);

    this.container.innerHTML = `


      <!-- Stats bar -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-6); padding: var(--space-3) var(--space-4); background: var(--bg-card); border-radius: var(--radius-md);">
        <div>
          <span style="color: var(--text-muted); font-size: var(--font-size-sm); text-transform: uppercase; letter-spacing: 0.05em;">Round </span>
          <span style="font-weight: var(--font-weight-bold); color: var(--text-primary); font-size: var(--font-size-lg);">${this.roundsPlayed}</span>
        </div>
        <div style="color: var(--text-muted); font-size: var(--font-size-sm);">
          ${this.allArtists.length} artists mapped
        </div>
      </div>

      <!-- Match cards -->
      <div style="display: flex; gap: var(--space-8); justify-content: center; flex-wrap: wrap; align-items: stretch; margin-bottom: var(--space-6);">
        ${this._renderCard(A, imgA, A.isConciergePick ? '⚔️ Contender' : null)}
        ${this._renderCard(B, imgB, B.isConciergePick ? '⚔️ Contender' : null)}
      </div>

      <!-- Controls -->
      <div style="display: flex; gap: var(--space-3); justify-content: center; align-items: center; margin-top: var(--space-6); flex-wrap: wrap;">
        ${this.history.length > 0 ? `<button class="btn btn-ghost" id="undo-btn" style="font-size: var(--font-size-sm);" aria-label="Undo previous choice">↩️ Undo</button>` : ''}
        <button class="btn btn-ghost" id="skip-btn" style="font-size: var(--font-size-sm);">Skip this pair</button>
        ${showFinish ? `<button class="btn btn-secondary" id="finish-btn">✅ Finish &amp; See Results</button>` : ''}
      </div>

      ${showFinish ? `
        <p style="text-align: center; color: var(--text-muted); font-size: var(--font-size-xs); margin-top: var(--space-2);">
          Or keep playing — the more you vote, the better your playlist!
        </p>
      ` : `
        <p style="text-align: center; color: var(--text-muted); font-size: var(--font-size-xs); margin-top: var(--space-2);">
          Play as many rounds as you like. "Finish" appears after ${MIN_ROUNDS_TO_FINISH} rounds.
        </p>
      `}

      <!-- Calibration Search -->
      <div style="margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; align-items: center;">
        <p style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--space-2);">Want to calibrate a specific artist?</p>
        <div style="position: relative; width: 100%; max-width: 300px;">
          <input type="text" id="calibrate-search" placeholder="Search artist..." style="width: 100%; padding: 8px 16px; border-radius: var(--radius-full); border: 1px solid var(--border-glass); background: var(--bg-card); color: var(--text-primary); outline: none;" autocomplete="off">
          <ul id="calibrate-dropdown" style="display: none; position: absolute; bottom: 100%; left: 0; right: 0; margin-bottom: 8px; background: var(--bg-secondary); border: 1px solid var(--border-glass); border-radius: var(--radius-md); max-height: 200px; overflow-y: auto; list-style: none; padding: 0; z-index: 100; box-shadow: var(--shadow-lg);"></ul>
        </div>
      </div>
    `;

    // Event listeners
    const setCardListeners = (artist) => {
      const card = document.getElementById(`card-${artist.id}`);
      if (!card) return;
      card.addEventListener('click', (e) => {
        // Don't trigger choice if clicking audio player
        if (e.target.tagName !== 'AUDIO' && e.target.tagName !== 'BUTTON') {
          this.handleChoice(artist.id);
        }
      });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') this.handleChoice(artist.id); });
      
      const skipBtn = document.getElementById(`skip-btn-${artist.id}`);
      if (skipBtn) {
        skipBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.handleSkip(artist.id);
        });
      }
    };
    setCardListeners(A);
    setCardListeners(B);

    document.getElementById('undo-btn')?.addEventListener('click', () => this.undo());
    document.getElementById('skip-btn')?.addEventListener('click', () => this.handleSkip());
    document.getElementById('finish-btn')?.addEventListener('click', () => this.handleFinish());
    
    const calibrateSearch = document.getElementById('calibrate-search');
    const calibrateDropdown = document.getElementById('calibrate-dropdown');
    let debounceTimer;

    calibrateSearch?.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(debounceTimer);
      if (!query) {
        calibrateDropdown.style.display = 'none';
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const results = await searchArtists(query);
          calibrateDropdown.innerHTML = '';
          if (results.length === 0) {
            calibrateDropdown.innerHTML = '<li style="padding: 8px 12px; color: var(--text-muted); font-size: 12px;">No results found</li>';
          } else {
            results.forEach(artist => {
              const li = document.createElement('li');
              li.style.cssText = 'padding: 8px 12px; display: flex; align-items: center; gap: 8px; cursor: pointer; border-bottom: 1px solid var(--border-subtle); transition: background 0.2s;';
              li.onmouseover = () => li.style.background = 'var(--bg-tertiary)';
              li.onmouseout = () => li.style.background = '';
              
              const imgUrl = artist.images?.[0]?.url || '';
              const imgHtml = imgUrl ? `<img src="${imgUrl}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">` : `<div style="width: 24px; height: 24px; border-radius: 50%; background: var(--bg-card); display: flex; align-items: center; justify-content: center; font-size: 10px;">🎵</div>`;
              
              li.innerHTML = `${imgHtml}<span style="font-size: 14px; color: var(--text-primary);">${artist.name}</span>`;
              
              li.addEventListener('click', async () => {
                calibrateDropdown.style.display = 'none';
                calibrateSearch.value = '';
                calibrateSearch.placeholder = 'Loading...';
                
                // Fetch full artist to get tags (our searchArtist function handles Last.fm tags)
                const fullArtist = await searchArtist(artist.name);
                if (fullArtist) {
                  if (!this.allArtists.some(a => a.id === fullArtist.id)) {
                    fullArtist.isConciergePick = true;
                    this.allArtists.push(fullArtist);
                  }
                  
                  const eloRatings = DataStore.getEloRatings();
                  const knownRanked = this.knownArtists
                    .filter(a => eloRatings[a.id])
                    .sort((a, b) => eloRatings[b.id].rating - eloRatings[a.id].rating);
                    
                  this.calibrationTask = { 
                    targetId: fullArtist.id, 
                    low: 0, 
                    high: Math.max(0, knownRanked.length - 1),
                    mid: -1
                  };
                  this.nextRound();
                } else {
                  calibrateSearch.placeholder = 'Error loading artist';
                }
              });
              
              calibrateDropdown.appendChild(li);
            });
          }
          calibrateDropdown.style.display = 'block';
        } catch (err) {
          console.error(err);
        }
      }, 300);
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (calibrateSearch && !calibrateSearch.contains(e.target) && !calibrateDropdown.contains(e.target)) {
        calibrateDropdown.style.display = 'none';
      }
    });
  }

  _renderCard(artist, imgUrl, badge = null) {
    // Determine audio preview HTML
    const track = artist.previewTrack;
    let audioHtml = '';
    
    if (track) {
      audioHtml = `
        <div style="width: 100%; margin-top: var(--space-4);" onclick="event.stopPropagation()">
          <audio id="audio-${artist.id}" src="${track.preview_url || ''}" preload="none" onended="document.getElementById('play-btn-${artist.id}').innerHTML = '▶ Play Track'; document.getElementById('play-btn-${artist.id}').dataset.playing = 'false'; document.getElementById('play-btn-${artist.id}').style.background = ''; document.getElementById('play-btn-${artist.id}').style.color = '';"></audio>
          <button id="play-btn-${artist.id}" class="btn btn-secondary play-btn-hybrid" style="width: 100%; font-size: 12px; transition: all 0.2s ease; border-color: var(--border-glass);"
                  onclick="window.playTrackHybrid('${track.uri}', '${track.preview_url || ''}', '${artist.id}')">
            ▶ Play Track
          </button>
          <button id="skip-btn-${artist.id}" class="btn btn-ghost"
            title="Remove this artist — they won't appear again"
            style="width: 100%; font-size: 11px; margin-top: 6px; padding: 5px 8px;
                   color: var(--text-muted); border: 1px dashed var(--border-subtle);
                   border-radius: 4px; display: flex; align-items: center;
                   justify-content: center; gap: 5px; transition: all 0.2s;"
            onmouseover="this.style.borderColor='var(--accent-pink)';this.style.color='var(--accent-pink)'"
            onmouseout="this.style.borderColor='var(--border-subtle)';this.style.color='var(--text-muted)'">
            <span style="font-size:13px;">🚫</span> Never heard of them
          </button>
        </div>
      `;
    }

    return `
      <div class="glass-card game-card" id="card-${artist.id}" tabindex="0"
           style="width: 300px; flex-shrink: 0; padding: var(--space-4); cursor: pointer;
                  display: flex; flex-direction: column; align-items: center; text-align: center;
                  transition: all 250ms cubic-bezier(0.34, 1.56, 0.64, 1); position: relative; border-color: transparent;"
           onmouseover="this.style.transform='scale(1.03) translateY(-4px)';this.style.borderColor='var(--accent-primary)';this.style.boxShadow='var(--shadow-glow)'"
           onmouseout="this.style.transform='none';this.style.borderColor='transparent';this.style.boxShadow='var(--shadow-md)'">
        
        ${badge ? `<div class="badge badge-accent" style="position: absolute; top: 12px; right: 12px; z-index: 10; font-size: 10px; padding: 2px 8px; backdrop-filter: blur(10px); background: rgba(139, 92, 246, 0.85); color: white; border: none; font-weight: bold; text-transform: uppercase;">${badge}</div>` : ''}
        
        <div style="width: 100%; aspect-ratio: 1; border-radius: var(--radius-xl); overflow: hidden; margin-bottom: var(--space-4); background: var(--bg-tertiary); box-shadow: var(--shadow-lg);">
          ${imgUrl 
            ? `<img src="${imgUrl}" alt="${artist.name}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:3rem;">🎵</div>`
          }
        </div>
        
        <h3 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-extrabold); letter-spacing: -0.02em; margin-bottom: 0; color: var(--text-primary);">${artist.name}</h3>
        
        <div onclick="event.stopPropagation()" style="width: 100%;">
          ${audioHtml}
        </div>
      </div>
    `;
  }

  renderSummary() {
    const topRanked = this.profiler.getTopRankedArtists(10);
    const knownIds  = new Set(this.knownArtists.map(a => a.id));

    const topHtml = topRanked.map((a, i) => {
      const isNew = !knownIds.has(a.id);
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-3);background:var(--bg-card);border-radius:var(--radius-md);margin-bottom:var(--space-2);">
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <span style="font-weight:bold;color:var(--text-muted);width:24px;text-align:center;">${i === 0 ? '👑' : `#${i+1}`}</span>
            ${a.imageUrl ? `<img src="${a.imageUrl}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">` : ''}
            <div>
              <span style="font-weight:var(--font-weight-medium);">${a.name}</span>
              ${isNew ? `<span class="badge" style="margin-left:6px;font-size:10px;background:var(--accent-secondary)22;color:var(--accent-secondary);">New discovery</span>` : ''}
            </div>
          </div>
          <span class="badge badge-accent" style="font-size:11px;">${a.rating} Elo</span>
        </div>
      `;
    }).join('');

    const discoveriesRanked = topRanked.filter(a => !knownIds.has(a.id));

    this.container.innerHTML = `
      <div class="glass-card" style="padding: var(--space-8); max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: var(--space-6);">
          <div style="font-size: 3rem; margin-bottom: var(--space-2);">🏆</div>
          <h2 style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold);">Session Complete!</h2>
          <p style="color: var(--text-secondary); margin-top: var(--space-1);">
            ${this.roundsPlayed} rounds played · ${this.allArtists.length} artists in pool
            ${discoveriesRanked.length ? ` · <span style="color:var(--accent-secondary);">${discoveriesRanked.length} new artists discovered</span>` : ''}
          </p>
        </div>

        <h3 style="font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-muted); margin-bottom: var(--space-3); text-transform: uppercase; letter-spacing: 0.06em;">Your Top Ranked</h3>
        ${topHtml}

        <div style="display: flex; gap: var(--space-4); justify-content: center; margin-top: var(--space-6); flex-wrap: wrap;">
          <button class="btn btn-secondary" id="play-again-btn">Keep Playing</button>
          <button class="btn btn-primary" onclick="location.hash='#/playlist'">✨ Generate Playlist</button>
        </div>
      </div>
    `;

    document.getElementById('play-again-btn')?.addEventListener('click', () => {
      this.roundsPlayed = 0;
      this.nextRound();
    });
  }
}
