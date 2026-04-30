import { describe, it, expect } from 'vitest';
import { SOUL, buildSoulPrefix } from '../src/agents/soul.js';

describe('Soul Module', () => {
  it('exports identity, curationPhilosophy, and constraints', () => {
    expect(SOUL.identity).toBeTruthy();
    expect(SOUL.curationPhilosophy).toBeTruthy();
    expect(SOUL.constraints).toBeTruthy();
  });

  it('identity establishes TasteGraph personality', () => {
    expect(SOUL.identity).toContain('TasteGraph');
    expect(SOUL.identity).toContain('opinionated');
  });

  it('buildSoulPrefix combines all three sections', () => {
    const prefix = buildSoulPrefix();
    expect(prefix).toContain(SOUL.identity);
    expect(prefix).toContain(SOUL.curationPhilosophy);
    expect(prefix).toContain(SOUL.constraints);
  });

  it('constraints ban generic language', () => {
    const lower = SOUL.constraints.toLowerCase();
    expect(lower).toContain('diverse');
    expect(lower).toContain('eclectic');
  });

  it('constraints ban breaking character', () => {
    const lower = SOUL.constraints.toLowerCase();
    expect(lower).toContain('break character');
  });

  it('curation philosophy values thesis-driven playlists', () => {
    expect(SOUL.curationPhilosophy).toContain('thesis');
  });
});
