/**
 * TasteGraph — Test Setup (imported by vitest.config or individual test files)
 *
 * Provides:
 *   1. localStorage polyfill for Node.js (silences DataStore warnings)
 *   2. Env-flag validation
 */

// ═══════════════════════════════════════════════════════════════
// localStorage polyfill for headless Node.js test runs
// ═══════════════════════════════════════════════════════════════
if (typeof globalThis.localStorage === 'undefined') {
  const _store = {};
  globalThis.localStorage = {
    getItem: (key) => _store[key] ?? null,
    setItem: (key, val) => { _store[key] = String(val); },
    removeItem: (key) => { delete _store[key]; },
    clear: () => { for (const k in _store) delete _store[k]; },
    get length() { return Object.keys(_store).length; },
    key: (i) => Object.keys(_store)[i] ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════
// Env-flag helpers
// ═══════════════════════════════════════════════════════════════

export const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY;

/** True when the user opted in to running LLM judge suites. */
export const JUDGE_ENABLED = !!(GEMINI_API_KEY && process.env.RUN_JUDGE);

/** True when using the legacy per-file flags (backwards compat). */
export const LEGACY_JUDGE_ENABLED = !!(
  GEMINI_API_KEY &&
  (process.env.RUN_PIPELINE_JUDGE || process.env.RUN_LLM_JUDGE || process.env.RUN_GEMINI_JUDGE)
);

/** Skip flag for describe.skipIf — skips when no judge is available. */
export const SKIP_JUDGE = !(JUDGE_ENABLED || LEGACY_JUDGE_ENABLED);
