/**
 * TasteGraph — Local Embedding Store
 *
 * Uses @xenova/transformers (Transformers.js) to run the all-MiniLM-L6-v2
 * embedding model entirely in-browser via ONNX Runtime (WebAssembly).
 *
 * Architecture (from deep research):
 *   Model:   Xenova/all-MiniLM-L6-v2
 *   Size:    ~23MB (quantized ONNX) — downloaded once, cached by browser
 *   Vectors: 384 dimensions × float32
 *   Storage: IndexedDB (via a compact key→vector map, ~7.7MB for 5,000 artists)
 *
 * What it enables:
 *   - Artist similarity via cosine distance — no Last.fm API needed in Ollama path
 *   - "More like this" artist discovery from textual descriptions
 *   - Semantic search over the user's known artist pool
 *
 * Runs in a Web Worker to avoid blocking the UI thread.
 * Falls back gracefully when model is not yet loaded or IndexedDB is unavailable.
 *
 * Usage:
 *   import { EmbeddingStore } from './embedding-store.js';
 *
 *   // Index artists (called once per profiler run)
 *   await EmbeddingStore.indexArtists(artists);
 *
 *   // Find similar artists by text description
 *   const similar = await EmbeddingStore.findSimilar('shoegaze dream pop reverb', 8);
 *
 *   // Get similarity score between two artists
 *   const score = await EmbeddingStore.similarity('artist_id_a', 'artist_id_b');
 */

// ─── Configuration ─────────────────────────────────────────────
const MODEL_NAME    = 'Xenova/all-MiniLM-L6-v2';
const DB_NAME       = 'tg_embeddings';
const DB_VERSION    = 1;
const STORE_NAME    = 'vectors';
const DIM           = 384;

// ─── Module state ──────────────────────────────────────────────
let _pipeline     = null;   // Transformers.js feature-extraction pipeline
let _db           = null;   // IndexedDB connection
let _ready        = false;
let _initPromise  = null;

// ─── Public API ────────────────────────────────────────────────

export const EmbeddingStore = {
  /**
   * Initialize the model and IndexedDB.
   * Safe to call multiple times — returns the same promise.
   */
  async init() {
    if (_initPromise) return _initPromise;
    _initPromise = _initialize();
    return _initPromise;
  },

  /**
   * Returns true if the embedding store is ready (model loaded + DB open).
   */
  get isReady() {
    return _ready;
  },

  /**
   * Index an array of artists into the embedding store.
   * Each artist is embedded using their name + genres as the text input.
   *
   * Call this after profiling completes. Only processes artists that aren't
   * yet indexed (incremental — won't re-embed already-known artists).
   *
   * @param {Array} artists — [{ id, name, genres: string[], macroGenres: string[] }]
   * @param {Function} onProgress — optional callback(done, total)
   */
  async indexArtists(artists, onProgress = null) {
    await this.init();
    if (!_ready) return;

    const existing = await _getAllIds();
    const toIndex  = artists.filter(a => a?.id && a?.name && !existing.has(a.id));

    if (toIndex.length === 0) return;

    console.log(`EmbeddingStore: Indexing ${toIndex.length} new artists...`);

    for (let i = 0; i < toIndex.length; i++) {
      const artist = toIndex[i];
      try {
        const text   = _artistToText(artist);
        const vector = await _embed(text);
        await _saveVector(artist.id, { id: artist.id, name: artist.name, vector });
        if (onProgress) onProgress(i + 1, toIndex.length);
      } catch (err) {
        console.warn(`EmbeddingStore: Failed to index "${artist.name}":`, err.message);
      }
    }

    console.log(`EmbeddingStore: Indexed ${toIndex.length} artists.`);
  },

  /**
   * Find the top-K most semantically similar artists to a query string.
   * Useful for: "dark ambient electronica", "jazz-influenced hip-hop", etc.
   *
   * @param {string}   query  — free-form text description
   * @param {number}   topK   — number of results (default 8)
   * @param {string[]} excludeIds — artist IDs to exclude from results
   * @returns {Promise<Array<{ id, name, score }>>} sorted by descending similarity
   */
  async findSimilar(query, topK = 8, excludeIds = []) {
    await this.init();
    if (!_ready) return [];

    const queryVec  = await _embed(query);
    const all       = await _getAllVectors();
    const excludeSet = new Set(excludeIds);

    const scored = all
      .filter(entry => !excludeSet.has(entry.id))
      .map(entry => ({
        id:    entry.id,
        name:  entry.name,
        score: _cosine(queryVec, entry.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  },

  /**
   * Find artists similar to a given artist (by their stored embedding).
   *
   * @param {string}   artistId    — source artist ID
   * @param {number}   topK        — results to return (default 8)
   * @param {string[]} excludeIds  — IDs to exclude (usually includes artistId itself)
   * @returns {Promise<Array<{ id, name, score }>>}
   */
  async findSimilarToArtist(artistId, topK = 8, excludeIds = []) {
    await this.init();
    if (!_ready) return [];

    const source = await _getVector(artistId);
    if (!source) return [];

    const all        = await _getAllVectors();
    const excludeSet = new Set([artistId, ...excludeIds]);

    const scored = all
      .filter(entry => !excludeSet.has(entry.id))
      .map(entry => ({
        id:    entry.id,
        name:  entry.name,
        score: _cosine(source.vector, entry.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  },

  /**
   * Cosine similarity score between two indexed artists. Returns 0 if either
   * artist is not yet indexed.
   *
   * @param {string} idA
   * @param {string} idB
   * @returns {Promise<number>} 0–1 similarity score
   */
  async similarity(idA, idB) {
    await this.init();
    if (!_ready) return 0;

    const [a, b] = await Promise.all([_getVector(idA), _getVector(idB)]);
    if (!a || !b) return 0;
    return _cosine(a.vector, b.vector);
  },

  /**
   * Clear all indexed vectors (useful for a full re-index or reset).
   */
  async clear() {
    await this.init();
    if (!_db) return;
    const tx = _db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await _txDone(tx);
    console.log('EmbeddingStore: Cleared all vectors.');
  },

  /**
   * Return the count of indexed artists.
   */
  async count() {
    await this.init();
    if (!_db) return 0;
    return new Promise((resolve, reject) => {
      const tx  = _db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },
};

// ─── Private: Initialization ───────────────────────────────────

async function _initialize() {
  try {
    // Open IndexedDB
    _db = await _openDB();

    // Load Transformers.js pipeline (lazy — downloads model on first call)
    // The model is cached by the browser after the first download.
    const { pipeline } = await import('@xenova/transformers');
    console.log('EmbeddingStore: Loading all-MiniLM-L6-v2 (~23MB, first time only)...');
    _pipeline = await pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,   // Use quantized ONNX for smaller size + faster inference
      progress_callback: (info) => {
        if (info.status === 'progress') {
          const pct = (info.loaded / info.total * 100).toFixed(0);
          console.log(`EmbeddingStore: Downloading model... ${pct}%`);
        }
      },
    });

    _ready = true;
    console.log('EmbeddingStore: Ready. Model loaded, IndexedDB open.');
  } catch (err) {
    console.warn('EmbeddingStore: Initialization failed (embedding features disabled):', err.message);
    _ready = false;
  }
}

// ─── Private: Embedding ────────────────────────────────────────

/**
 * Embed a single text string and return a normalized Float32Array.
 */
async function _embed(text) {
  if (!_pipeline) throw new Error('EmbeddingStore: Pipeline not initialized');

  const output = await _pipeline(text, {
    pooling: 'mean',
    normalize: true,   // L2-normalize so cosine similarity = dot product
  });

  // output.data is a Float32Array of shape [DIM]
  return Array.from(output.data);
}

/**
 * Convert an artist object to a text description for embedding.
 * Combines name + genre tags for a richer semantic representation.
 */
function _artistToText(artist) {
  const genres = [
    ...(artist.macroGenres || []),
    ...(artist.genres || []),
  ].slice(0, 8).join(', ');

  return genres
    ? `${artist.name}: ${genres}`
    : artist.name;
}

// ─── Private: Cosine similarity ────────────────────────────────

function _cosine(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot   += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ─── Private: IndexedDB helpers ────────────────────────────────

function _openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available (SSR or test environment)'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    req.onsuccess  = (e) => resolve(e.target.result);
    req.onerror    = (e) => reject(e.target.error);
    req.onblocked  = ()  => reject(new Error('IndexedDB blocked'));
  });
}

function _saveVector(id, entry) {
  return new Promise((resolve, reject) => {
    const tx  = _db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(entry);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function _getVector(id) {
  return new Promise((resolve, reject) => {
    const tx  = _db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => reject(req.error);
  });
}

function _getAllVectors() {
  return new Promise((resolve, reject) => {
    const tx  = _db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

function _getAllIds() {
  return new Promise((resolve, reject) => {
    const tx  = _db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(new Set(req.result));
    req.onerror   = () => reject(req.error);
  });
}

function _txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  });
}
