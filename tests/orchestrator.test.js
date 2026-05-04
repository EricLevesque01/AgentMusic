import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../src/agents/orchestrator.js';
import { ProfilerAgent } from '../src/agents/profiler-agent.js';
import { ScoutAgent } from '../src/agents/scout-agent.js';
import { CuratorAgent } from '../src/agents/curator-agent.js';

const mockTasteState = {
  eloRatings: { a1: { rating: 1500 } },
  topGenres: ['rock'],
  audioProfile: {},
  artists: [{ id: 'a1', name: 'Test Artist' }],
  tracks: [],
};

const mockCandidate = [{
  track: { id: 't1', popularity: 70 },
  artistId: 'a1',
  artistName: 'Test Artist',
  hopDistance: 0,
  source: 'elo_top',
  tags: [],
  dominantFactor: 'Selected for the session.',
}];

// Mock the curator output to include the new fields (playlistSummary, playlistName)
const mockCuratorOutput = Object.assign([...mockCandidate], {
  curatorReflection: 'Test reflection',
  playlistName: 'Test Playlist',
  playlistSummary: 'Test summary',
});

describe('Orchestrator', () => {
  it('should run the pipeline and report status', async () => {
    const statusCallback = vi.fn();
    const orchestrator = new Orchestrator(statusCallback);

    vi.spyOn(ProfilerAgent.prototype, 'buildTasteState').mockResolvedValue(mockTasteState);
    vi.spyOn(ScoutAgent.prototype, 'findCandidates').mockResolvedValue(mockCandidate);
    vi.spyOn(CuratorAgent.prototype, 'rankAndSelect').mockReturnValue(mockCuratorOutput);

    const context = await orchestrator.generatePlaylist('user1', 'a rock mix');

    // Profiler, Scout, Curator should be called — no Narrator
    expect(statusCallback).toHaveBeenCalledWith('profiler', false);
    expect(statusCallback).toHaveBeenCalledWith('scout', false);
    expect(statusCallback).toHaveBeenCalledWith('curator', false);

    expect(context.userId).toBe('user1');
    expect(context.sessionIntent).toBe('a rock mix');
    expect(context.tasteState.topGenres).toContain('rock');
    expect(context.scoredPlaylist.length).toBe(1);
  });

  it('should throw if pipeline fails', async () => {
    const orchestrator = new Orchestrator();
    vi.spyOn(ProfilerAgent.prototype, 'buildTasteState').mockRejectedValue(new Error('Spotify fail'));

    await expect(orchestrator.generatePlaylist('user1', {})).rejects.toThrow('Spotify fail');
  });
});
