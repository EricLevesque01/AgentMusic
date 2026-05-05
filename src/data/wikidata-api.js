/**
 * Agent Music — Wikidata API Wrapper
 * Queries the Wikidata SPARQL endpoint for artist influence relationships (P737).
 * Used by SuggestedArtistsAgent and the enhanced Scout for non-trivial discovery.
 *
 * CORS-friendly, no auth required. Free to use.
 * Docs: https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service
 */

import { DataStore } from './data-store.js';

const WDQS_ENDPOINT = 'https://query.wikidata.org/sparql';

/**
 * Execute a SPARQL query against Wikidata.
 * Uses POST to avoid URL length limits.
 * @param {string} sparql
 * @returns {Array} — results bindings
 */
async function wdFetch(sparql) {
  const response = await fetch(WDQS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Accept': 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Agent Music/1.0 (ericlevesque22@gmail.com)',
    },
    body: 'query=' + encodeURIComponent(sparql),
  });

  if (!response.ok) {
    throw new Error(`Wikidata SPARQL error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.results?.bindings || [];
}

/**
 * Get influence relationships for an artist.
 * Returns both who influenced them and who they influenced.
 * Uses Wikidata property P737 (influenced by).
 *
 * @param {string} artistName — exact artist name to search for
 * @returns {{ influencedBy: string[], influenced: string[] }}
 */
export async function getArtistInfluences(artistName) {
  if (!artistName) return { influencedBy: [], influenced: [] };

  const cacheKey = `wd_influences_${artistName.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = DataStore.getCachedResponse(cacheKey);
  if (cached) return cached;

  try {
    // Step 1: Find the Wikidata Q-ID for this artist
    const searchQuery = `
      SELECT ?artist WHERE {
        ?artist rdfs:label "${artistName}"@en .
        ?artist wdt:P31/wdt:P279* wd:Q5 .
      } LIMIT 1
    `;

    // Try person first, then fall back to musical group
    let bindings = await wdFetch(searchQuery);
    if (bindings.length === 0) {
      const groupQuery = `
        SELECT ?artist WHERE {
          ?artist rdfs:label "${artistName}"@en .
          { ?artist wdt:P31 wd:Q215380 . } UNION { ?artist wdt:P31 wd:Q5741069 . }
        } LIMIT 1
      `;
      bindings = await wdFetch(groupQuery);
    }

    if (bindings.length === 0) {
      const result = { influencedBy: [], influenced: [] };
      DataStore.cacheResponse(cacheKey, result);
      return result;
    }

    const artistQid = bindings[0].artist.value.split('/').pop();

    // Step 2: Get who influenced this artist (P737 outgoing)
    const influencedByQuery = `
      SELECT ?influenceLabel WHERE {
        wd:${artistQid} wdt:P737 ?influence .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } LIMIT 20
    `;

    // Step 3: Get who this artist influenced (P737 incoming)
    const influencedQuery = `
      SELECT ?artistLabel WHERE {
        ?artist wdt:P737 wd:${artistQid} .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } LIMIT 20
    `;

    const [byResults, ofResults] = await Promise.all([
      wdFetch(influencedByQuery).catch(() => []),
      wdFetch(influencedQuery).catch(() => []),
    ]);

    const result = {
      influencedBy: byResults
        .map(b => b.influenceLabel?.value)
        .filter(Boolean),
      influenced: ofResults
        .map(b => b.artistLabel?.value)
        .filter(Boolean),
    };

    DataStore.cacheResponse(cacheKey, result);
    return result;
  } catch (err) {
    console.warn(`Wikidata: getArtistInfluences failed for "${artistName}":`, err.message);
    return { influencedBy: [], influenced: [] };
  }
}
