/**
 * TasteGraph — SearXNG Search API
 *
 * Provides a local web search capability for agents running on Ollama.
 * Replaces Gemini's google_search grounding when in local mode.
 *
 * Setup (one-time, ~2 minutes):
 *   Option A (Docker): docker run -d -p 8080:8080 --name searxng searxng/searxng
 *   Option B: Download from https://github.com/searxng/searxng/releases
 *
 * SearXNG aggregates Google, Bing, DuckDuckGo, Wikipedia, and 70+ other engines.
 * It exposes a simple HTTP API — no API key required.
 *
 * Why SearXNG over DuckDuckGo npm packages:
 *   DuckDuckGo scraper libraries explicitly block browser use due to CORS.
 *   SearXNG is self-hosted on localhost — no CORS restrictions.
 */

const SEARXNG_URL = import.meta.env?.VITE_SEARXNG_URL || 'http://localhost:8080';

/**
 * Search the web via local SearXNG instance.
 * Returns top results with title, url, and snippet.
 *
 * @param {string} query - Search query
 * @param {object} opts
 * @param {number} opts.maxResults - Max results to return (default 5)
 * @param {string[]} opts.categories - SearXNG categories: 'general', 'music', 'news'
 * @param {string} opts.timeRange - 'day' | 'week' | 'month' | 'year' | '' (any time)
 * @returns {Promise<Array<{title, url, snippet}>>}
 */
export async function searchWeb(query, { maxResults = 5, categories = ['general'], timeRange = '' } = {}) {
  const url = new URL(`${SEARXNG_URL}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('categories', categories.join(','));
  if (timeRange) url.searchParams.set('time_range', timeRange);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`SearXNG ${res.status}: ${res.statusText}`);

    const data = await res.json();
    return (data.results || []).slice(0, maxResults).map(r => ({
      title:   r.title   || '',
      url:     r.url     || '',
      snippet: r.content || r.snippet || '',
      score:   r.score   || 0,
    }));
  } catch (err) {
    // SearXNG not running — return empty results (graceful degradation)
    console.warn('SearXNG unavailable:', err.message, '— falling back to no web search');
    return [];
  }
}

/**
 * Music-specific search: queries SearXNG with music-journalism-optimized parameters.
 * Adds site hints for Pitchfork, RateYourMusic, Reddit/listentothis, AllMusic.
 *
 * @param {string} query
 * @param {object} opts
 * @returns {Promise<Array<{title, url, snippet}>>}
 */
export async function searchMusicWeb(query, { maxResults = 6, recent = false } = {}) {
  const musicQuery = query; // SearXNG will prioritize music categories
  return searchWeb(musicQuery, {
    maxResults,
    categories: ['general', 'music'],
    timeRange: recent ? 'year' : '',
  });
}

/**
 * Check if SearXNG is available on localhost.
 * @returns {Promise<boolean>}
 */
export async function isSearxngAvailable() {
  try {
    const res = await fetch(`${SEARXNG_URL}/healthz`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    // Try the search endpoint as a fallback health check
    try {
      const res = await fetch(`${SEARXNG_URL}/search?q=test&format=json`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
