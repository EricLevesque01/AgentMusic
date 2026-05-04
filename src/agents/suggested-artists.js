/**
 * TasteGraph — Suggested Artists Agent
 * Uses all three knowledge layers to surface non-obvious discovery candidates:
 *   Layer 1: Structured APIs (Last.fm similar, MusicBrainz relationships, Wikidata influences)
 *   Layer 2: LLM world knowledge (shared producers, scenes, sonic DNA)
 *   Layer 3: Live web search (reviews, forums, trending connections)
 *
 * Each suggestion includes a human-readable reason and category.
 */

import { getSimilarArtists } from '../data/lastfm-api.js';
import { searchArtist as searchMbArtist, getArtistRelationships } from '../data/musicbrainz-api.js';
import { getArtistInfluences } from '../data/wikidata-api.js';
import { searchArtists as searchSpotifyArtists } from '../data/spotify-api.js';
import { callWithTools } from '../data/gemini-api.js';
import { buildSoulPrefix } from './soul.js';
import { DataStore } from '../data/data-store.js';
import { UserModel } from './user-model.js';

export class SuggestedArtistsAgent {

  /**
   * Generate a list of suggested artists using all three knowledge layers.
   * @param {Array} topArtists — user's top-rated artists [{ name, id, genres }]
   * @param {object} eloRatings — full Elo map for filtering out known artists
   * @returns {Array<{ name, imageUrl, reason, category, spotifyId }>}
   */
  async generate(topArtists, eloRatings = {}, { force = false } = {}) {
    // Check cache first (skip on forced refresh)
    // Also evict stale/thin caches so a fresh run replaces bad old results
    const cached = DataStore.getSuggestedArtistsCache();
    if (!force && cached && cached.length >= 6) {
      // Evict stale cache if too many reasons are generic API boilerplate
      const genericPatterns = ['fans also listen', 'similar to', 'influenced ', 'member of', 'performed with', 'connected to', 'collaborated with'];
      const genericCount = cached.filter(a =>
        !a.reason || a.reason.length < 15 ||
        genericPatterns.some(p => a.reason.toLowerCase().startsWith(p))
      ).length;
      if (genericCount <= Math.floor(cached.length * 0.4)) {
        return cached; // Cache quality is acceptable
      }
      // Otherwise, fall through and regenerate
      console.log('SuggestedArtists: Cache has too many generic blurbs — regenerating.');
    }

    const knownNames = new Set(
      Object.values(eloRatings)
        .map(a => a.name?.toLowerCase())
        .filter(Boolean)
    );

    // DIVERSITY FIX: Build a diversified seed pool instead of just top-5.
    // Use up to 8 seeds, sampling from different tiers to avoid
    // the "every suggestion is based on The Strokes" problem.
    const allRanked = Object.values(eloRatings)
      .filter(a => a.name && a.name !== 'undefined' && a.rating > 1400)
      .sort((a, b) => b.rating - a.rating);

    // Take top-3, mid-2, and tail-3 to ensure diverse seeding
    const topSlice = allRanked.slice(0, 3);
    const midSlice = allRanked.slice(
      Math.floor(allRanked.length * 0.3),
      Math.floor(allRanked.length * 0.3) + 2
    );
    const tailSlice = allRanked.slice(-3);

    // Merge and deduplicate
    const seedMap = new Map();
    [...topSlice, ...midSlice, ...tailSlice, ...topArtists.slice(0, 3)].forEach(a => {
      const key = (a.name || '').toLowerCase();
      if (key && !seedMap.has(key)) seedMap.set(key, a);
    });
    const seeds = [...seedMap.values()].slice(0, 8);
    const seedNames = seeds.map(a => a.name);

    if (seedNames.length === 0) return [];

    const suggestions = new Map(); // name → suggestion object (dedup by name)
    // Track how many suggestions each seed artist has contributed
    // to prevent any single seed from dominating the results.
    const seedContributions = new Map(); // seedName → count
    const MAX_PER_SEED = 2; // Allow 2 suggestions per seed artist for richer results

    // === Layer 1: Structured APIs (fast, free) ===
    // Run MusicBrainz FIRST because it has highly accurate "member of band" relationships,
    // and we want it to claim the seed slots before Last.fm fills them with generic similarity.
    // Give MusicBrainz a higher cap (3) so it can find multiple band members (e.g. Lucy AND Julien).
    await this._addMusicBrainzSuggestions(seedNames, knownNames, suggestions, seedContributions, 3);
    await this._addLastfmSuggestions(seedNames, knownNames, suggestions, seedContributions, MAX_PER_SEED);
    await this._addWikidataSuggestions(seedNames, knownNames, suggestions, seedContributions, 3);

    // === Layer 2+3: LLM + Web Search (1 grounded call) ===
    await this._addWebGroundedSuggestions(seedNames, seeds, knownNames, suggestions);

    // === Reason Enrichment: Use LLM world knowledge to rewrite generic reasons ===
    // Structured APIs find the artists; the LLM explains why they matter.
    // This naturally handles cases like Tim Buckley → "Jeff Buckley's father"
    // instead of the generic "Similar to Jeff Buckley" from Last.fm.
    await this._enrichReasons(suggestions, seedNames);

    // EMERGENCY FALLBACK: If the LLM failed (e.g. Gemini high demand error), 
    // we might only have ~4 artists. Do a secondary Last.fm pass to fill the row.
    if (suggestions.size < 8) {
      console.warn(`SuggestedArtists: LLM failed to fill row (size=${suggestions.size}). Running emergency Last.fm fallback pass.`);
      await this._addLastfmSuggestions(seedNames, knownNames, suggestions, seedContributions, 3);
    }

    // Resolve to Spotify — with strict name matching to prevent wrong images
    const results = await this._resolveSpotifyMetadata([...suggestions.values()]);

    // Sort: web/LLM discoveries first, then graph, limit to 12
    results.sort((a, b) => {
      const priority = { genre_gateway: 0, taste_tribe: 1, critics_pick: 2, shared_production: 3, same_scene: 4, influenced_by: 5, influenced: 6, collaboration: 7, band_connection: 8, lastfm_similar: 9 };
      return (priority[a.category] ?? 10) - (priority[b.category] ?? 10);
    });

    const final = results.slice(0, 12);
    DataStore.setSuggestedArtistsCache(final);
    return final;
  }

  // --- Layer 1A: Last.fm Similar Artists ---
  async _addLastfmSuggestions(seedNames, knownNames, map, seedContributions, maxPerSeed) {
    try {
      for (const name of seedNames.slice(0, 4)) {
        const count = seedContributions.get(name) || 0;
        if (count >= maxPerSeed) continue;

        const similar = await getSimilarArtists(name, 5);
        let added = 0;
        for (const a of similar) {
          if (added + count >= maxPerSeed) break;
          if (!knownNames.has(a.name.toLowerCase()) && !map.has(a.name)) {
            map.set(a.name, {
              name: a.name,
              reason: `Fans also listen to ${name}`,
              category: 'lastfm_similar',
            });
            added++;
          }
        }
        seedContributions.set(name, count + added);
      }
    } catch (e) {
      console.warn('SuggestedArtists: Last.fm layer failed:', e.message);
    }
  }

  // --- Layer 1B: MusicBrainz Relationships ---
  async _addMusicBrainzSuggestions(seedNames, knownNames, map, seedContributions, maxPerSeed) {
    try {
      for (const name of seedNames.slice(0, 3)) {
        const count = seedContributions.get(name) || 0;
        if (count >= maxPerSeed) continue;

        const mbid = await searchMbArtist(name);
        if (!mbid) continue;

        const rels = await getArtistRelationships(mbid);
        let added = 0;
        for (const rel of rels.slice(0, 4)) {
          if (added + count >= maxPerSeed) break;
          if (rel.targetName && !knownNames.has(rel.targetName.toLowerCase()) && !map.has(rel.targetName)) {
            const category = rel.type.includes('member') ? 'band_connection' : 'collaboration';
            map.set(rel.targetName, {
              name: rel.targetName,
              reason: this._formatRelReason(rel, name),
              category,
            });
            added++;
          }
        }
        seedContributions.set(name, count + added);
      }
    } catch (e) {
      console.warn('SuggestedArtists: MusicBrainz layer failed:', e.message);
    }
  }

  // --- Layer 1C: Wikidata Influence Graph ---
  async _addWikidataSuggestions(seedNames, knownNames, map, seedContributions, maxPerSeed) {
    try {
      for (const name of seedNames.slice(0, 3)) {
        const count = seedContributions.get(name) || 0;
        if (count >= maxPerSeed) continue;

        const influences = await getArtistInfluences(name);
        let added = 0;

        for (const inf of (influences.influencedBy || []).slice(0, 3)) {
          if (added + count >= maxPerSeed) break;
          if (!knownNames.has(inf.toLowerCase()) && !map.has(inf)) {
            map.set(inf, {
              name: inf,
              reason: `Influenced ${name}`,
              category: 'influenced_by',
            });
            added++;
          }
        }

        for (const inf of (influences.influenced || []).slice(0, 3)) {
          if (added + count >= maxPerSeed) break;
          if (!knownNames.has(inf.toLowerCase()) && !map.has(inf)) {
            map.set(inf, {
              name: inf,
              reason: `Influenced by ${name}`,
              category: 'influenced',
            });
            added++;
          }
        }
        seedContributions.set(name, count + added);
      }
    } catch (e) {
      console.warn('SuggestedArtists: Wikidata layer failed:', e.message);
    }
  }

  // --- Layer 2+3: LLM World Knowledge (genre-strategic discovery) ---
  async _addWebGroundedSuggestions(seedNames, topArtists, knownNames, map) {
    const topGenres = [...new Set(topArtists.flatMap(a => a.genres || []))].slice(0, 5);
    const alreadySuggested = [...map.keys()].join(', ');

    // Pull the user's psychometric taste profile for genre-strategic thinking
    let tasteContext = '';
    try {
      const tier1 = UserModel.loadTier1();
      const dims = tier1?.tasteProfile?.musicDimensions;
      const genreDist = tier1?.tasteProfile?.genreDistribution;
      const discovery = tier1?.discoveryProfile;
      const driftTrends = DataStore.load('drift_trends');

      if (dims && dims._confidence > 0) {
        const sorted = Object.entries(dims)
          .filter(([k]) => k !== '_confidence')
          .sort((a, b) => b[1] - a[1]);
        const top2 = sorted.slice(0, 2).map(([k, v]) => `${k} (${(v * 100).toFixed(0)}%)`).join(', ');
        const low2 = sorted.slice(-2).map(([k, v]) => `${k} (${(v * 100).toFixed(0)}%)`).join(', ');
        tasteContext += `\nMUSIC personality: strongest in ${top2}; weakest in ${low2}.`;
      }

      if (genreDist) {
        const topG = Object.entries(genreDist)
          .filter(([k]) => k !== '_confidence')
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([k, v]) => `${k} (${(v * 100).toFixed(0)}%)`).join(', ');
        if (topG) tasteContext += `\nGenre distribution: ${topG}.`;
      }

      if (discovery) {
        const traits = [];
        if (discovery.mainstreaminess != null) traits.push(`mainstream: ${(discovery.mainstreaminess * 100).toFixed(0)}%`);
        if (discovery.diversityScore != null) traits.push(`diversity: ${(discovery.diversityScore * 100).toFixed(0)}%`);
        if (traits.length) tasteContext += `\nDiscovery profile: ${traits.join(', ')}.`;
      }

      if (driftTrends?.genreMomentum?.length) {
        tasteContext += `\nRecently exploring: ${driftTrends.genreMomentum.join(', ')}.`;
      }

      const prefs = DataStore.getExplicitPreferences();
      if (prefs?.agent_memories?.length) {
        tasteContext += `\nPERMANENT USER NOTES (from other agents):\n${prefs.agent_memories.map(m => `- ${m}`).join('\n')}`;
      }
    } catch (e) {
      // UserModel not populated yet — that's fine
    }

    const prompt = `${buildSoulPrefix()}

You are a music discovery strategist. Think at the GENRE level, not just the artist level.

USER'S TASTE PROFILE:
Artists they love: ${seedNames.join(', ')}
Genres they listen to: ${topGenres.join(', ')}${tasteContext}
Already suggested (skip these): ${alreadySuggested || 'none yet'}

Your job: recommend artists that represent STRATEGIC discovery directions.
Think about what genres and scenes this person should explore next based on
their taste DNA. Consider:

1. GENRE GATEWAYS — genres adjacent to their current taste that they'd likely love
   but haven't explored. What's the natural "next genre" for this profile?
2. TASTE TRIBE — what are people with this exact taste profile typically into?
   Think collaborative filtering: "fans of X, Y, Z also tend to discover..."
3. SCENE CONNECTIONS — shared producers, labels, local scenes, cultural movements
4. CRITICAL PICKS — acclaimed artists that match their psychometric profile

IMPORTANT RULES:
- Only suggest artists with a real, verifiable music career — albums, reviews, critical acclaim, cultural footprint.
- DO NOT suggest ambient/lo-fi/study music channels, AI-generated artists, or content farms.
- Avoid extremely obscure underground acts that most music fans haven't heard of.
- If an artist is a member of a band the user loves (e.g. Julien Baker or Lucy Dacus and boygenius, Thom Yorke and Radiohead), you MUST explicitly acknowledge it (e.g. "Going solo from boygenius").
- KEEP REASONS EXTREMELY CONCISE. Just a tiny blurb of 3-6 words. No full sentences.

Submit 10-12 artists. Each must be a real, well-known artist on Spotify with genuine critical acclaim or cultural significance.
For the \`reason\`, DO NOT just say "Similar to X". Instead, explicitly state the INSIGHT or DIRECTION in a few words.
Example reasons:
- "Deepening your Jazz exploration"
- "Connecting [Artist A] and [Artist B]"
- "Gateway into modern Neo-Soul"
- "Expanding your production palette"
- "Going solo from boygenius"`;

    const toolDecls = [{
      name: 'submit_suggestions',
      description: 'Submit suggested artists with reasons.',
      parameters: {
        type: 'object',
        properties: {
          artists: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Exact artist name as it appears on Spotify' },
                reason: { type: 'string', description: 'The exploration direction and insightful reason' },
                category: {
                  type: 'string',
                  enum: ['genre_gateway', 'taste_tribe', 'critics_pick', 'shared_production', 'same_scene'],
                },
              },
              required: ['name', 'reason', 'category'],
            },
          },
        },
        required: ['artists'],
      },
    }];

    try {
      // NOTE: Gemini cannot combine google_search grounding with function calling
      // in the same request. We rely on the LLM's world knowledge here — the
      // structured APIs (Last.fm, MusicBrainz, Wikidata) already provide
      // grounded data. The LLM adds value through its training data knowledge
      // of music scenes, shared producers, and cultural connections.
      const result = await callWithTools(
        prompt,
        [{ role: 'user', parts: [{ text: 'Find artist suggestions based on the taste profile.' }] }],
        toolDecls,
        'fast',
        false, // No web search — incompatible with function calling in Gemini
        'suggested'
      );

      const call = result.functionCalls.find(fc => fc.name === 'submit_suggestions');
      if (!call?.args?.artists) return;

      for (const a of call.args.artists) {
        if (!knownNames.has(a.name.toLowerCase()) && !map.has(a.name)) {
          map.set(a.name, {
            name: a.name,
            reason: a.reason,
            category: a.category || 'web_trending',
          });
        }
      }
    } catch (e) {
      console.warn('SuggestedArtists: Web-grounded layer failed:', e.message);
    }
  }

  /**
   * Use one LLM call to rewrite generic API-sourced reasons into concise,
   * informed descriptions. The LLM knows things templates can't express:
   *   "Similar to Jeff Buckley" → "Jeff Buckley's father — pioneered the
   *    ethereal vocal style his son made iconic"
   *
   * Falls back to original reasons if the LLM call fails.
   */
  async _enrichReasons(suggestions, seedNames) {
    // Only enrich suggestions from structured APIs (LLM-sourced ones are already good)
    const apiCategories = new Set(['lastfm_similar', 'collaboration', 'band_connection', 'influenced_by', 'influenced']);
    const toEnrich = [...suggestions.entries()]
      .filter(([, s]) => apiCategories.has(s.category));

    if (toEnrich.length === 0) return;

    const artistList = toEnrich
      .map(([name, s]) => `- ${name} (source: ${s.category}, original: "${s.reason}")`)
      .join('\n');

    const prompt = `You are a music expert and concise copywriter. Rewrite each artist suggestion reason into a punchy, insight-driven blurb.

User's taste anchors: ${seedNames.join(', ')}

Suggestions to improve:
${artistList}

RULES:
- Each reason must be 6-12 words.
- State the SPECIFIC non-obvious connection (shared band, producer, family, scene, sonic DNA, genre bridge).
- NEVER say "Similar to X" or "Fans also listen to X" — that's what we're replacing.
- If someone is a family member, bandmate, or has a direct creative connection, SAY IT.
- If the connection is genre/scene-based, name the specific genre or scene.
- Examples of GOOD reasons:
  "Jeff Buckley's father — ethereal vocal pioneer"
  "Radiohead's lead guitarist going solo"
  "Post-punk meets krautrock — Berlin scene roots"
  "Shares a producer with Fontaines DC"
  "Gateway into modern neo-soul from R&B"

Respond as JSON: { "reasons": { "Artist Name": "improved reason", ... } }`;

    try {
      const result = await callWithTools(
        prompt,
        [{ role: 'user', parts: [{ text: 'Improve these suggestion reasons.' }] }],
        [],
        'fast',
        false
      );

      if (!result.textReply) return;

      // Parse the JSON response
      const jsonMatch = result.textReply.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const parsed = JSON.parse(jsonMatch[0]);
      const improved = parsed.reasons || parsed;

      // Apply improved reasons back to the suggestions map
      for (const [name, suggestion] of toEnrich) {
        const betterReason = improved[name] || improved[suggestion.name];
        if (betterReason && typeof betterReason === 'string' && betterReason.length > 3) {
          suggestion.reason = betterReason;
          suggestions.set(name, suggestion);
        }
      }
    } catch (e) {
      // Fall back silently — original reasons are acceptable
      console.debug('SuggestedArtists: Reason enrichment skipped:', e.message);
    }
  }

  // --- Resolve Spotify metadata (images, IDs) with strict name validation ---
  async _resolveSpotifyMetadata(suggestions) {
    const resolved = [];

    // Process in batches of 5
    for (let i = 0; i < suggestions.length; i += 5) {
      const batch = suggestions.slice(i, i + 5);
      const lookups = batch.map(async (s) => {
        try {
          const artists = await searchSpotifyArtists(s.name, 3); // Get top 3 results for matching
          if (!artists || artists.length === 0) return; // Not on Spotify → skip entirely

          // STRICT NAME VALIDATION: The Spotify result must closely match the requested name.
          // This prevents:
          //   - Wrong images (LLM says "Luna", Spotify returns "Luna Li" with wrong photo)
          //   - AI/fake artists (LLM hallucinates a name, Spotify returns the closest real match)
          const requestedNorm = s.name.toLowerCase().trim().replace(/^the\s+/, '');
          const bestMatch = artists.find(a => {
            const resultNorm = (a.name || '').toLowerCase().trim().replace(/^the\s+/, '');
            return resultNorm === requestedNorm;
          });

          if (!bestMatch) {
            console.debug(`SuggestedArtists: Rejected "${s.name}" — no Spotify match (top result: "${artists[0]?.name}")`);
            return; // No close match → probably hallucinated, skip it
          }

          // Minimum popularity filter: reject AI-generated or pure content farms
          // Threshold 10 = artist has at least some real fanbase; blocks spam without cutting indie acts
          if ((bestMatch.popularity || 0) < 10) {
            console.debug(`SuggestedArtists: Rejected "${bestMatch.name}" — popularity too low (${bestMatch.popularity})`);
            return;
          }

          resolved.push({
            ...s,
            name: bestMatch.name, // Use Spotify's canonical spelling
            spotifyId: bestMatch.id,
            imageUrl: bestMatch.images?.[0]?.url || bestMatch.images?.[1]?.url || null,
            popularity: bestMatch.popularity || 0,
          });
        } catch (e) {
          // Skip unresolvable artists
        }
      });
      await Promise.all(lookups);
    }

    return resolved;
  }

  _formatRelReason(rel, seedName) {
    switch (rel.type) {
      case 'member of band':
        return rel.direction === 'backward'
          ? `Member of ${seedName}`
          : `Includes ${seedName}`;
      case 'collaboration':
        return `Collaborated with ${seedName}`;
      case 'supporting musician':
      case 'vocal supporting musician':
      case 'instrumental supporting musician':
        return `Performed with ${seedName}`;
      case 'founder':
        return `Founded by member of ${seedName}`;
      default:
        return `Connected to ${seedName}`;
    }
  }
}
