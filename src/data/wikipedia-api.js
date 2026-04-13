/**
 * TasteGraph — Wikipedia API
 * Fetches Wikipedia summaries to provide deep historical and biographical context 
 * to the Agents, serving as a dynamic RAG (Retrieval-Augmented Generation) Brain.
 */

import { DataStore } from './data-store.js';

/**
 * Fetch the introductory summary of an artist from Wikipedia.
 * Uses the MediaWiki Action API.
 * @param {string} artistName 
 * @returns {Promise<string|null>} The text extract, or null if not found.
 */
export async function getArtistWikiSummary(artistName) {
  if (!artistName) return null;

  const cacheKey = `wiki_summary_${artistName.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = DataStore.getCachedResponse(cacheKey);
  if (cached) return cached;

  try {
    // We try the exact name first. If it's a common word (like "Geese" or "Justice"), 
    // Wikipedia might return a disambiguation page or the wrong thing, but for 
    // seminal artists, it's usually highly accurate.
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      format: 'json',
      origin: '*',
      titles: artistName
    }).toString();

    // Wikipedia requires a User-Agent or it may reject/redirect the request
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'TasteGraph_Agentic_Curator/1.0 (test@example.com)'
      }
    });

    if (!response.ok) return null;
    
    const data = await response.json();
    const pages = data.query?.pages;
    if (!pages) return null;

    const pageId = Object.keys(pages)[0];
    if (pageId === '-1') return null; // Page missing

    let extract = pages[pageId].extract;
    if (!extract || extract.includes('may refer to:')) {
      // It hit a disambiguation page. We could recursively try `${artistName} (band)`
      // but for simplicity and speed, we just return null.
      return null;
    }

    // Truncate to save tokens for the LLM
    if (extract.length > 800) {
      extract = extract.substring(0, 800) + '...';
    }

    DataStore.cacheResponse(cacheKey, extract);
    return extract;

  } catch (err) {
    console.warn(`Wikipedia API failed for ${artistName}:`, err.message);
    return null;
  }
}
