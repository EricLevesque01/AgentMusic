import { describe, it, expect, vi } from 'vitest';
import { ConciergeAgent } from '../src/agents/concierge-agent.js';
import * as geminiApi from '../src/data/gemini-api.js';

const mockContext = {
  tasteState: {
    topGenres: ['rock', 'indie'],
    artists:   [{ id: 'a1', name: 'Radiohead' }],
  },
  sliders: { discovery: 0.5, energy: 0.5, popularity: 0.5, novelty: 0.5, focus: 0.5 },
  scoredPlaylist: [{
    track:      { id: 't1', name: 'Creep' },
    artistId:   'a1',
    artistName: 'Radiohead',
    hopDistance: 0,
    tags: [{ name: 'alternative rock' }],
  }],
  explanations: {
    playlistSummary: 'A great mix.',
    trackExplanations: new Map([['t1', 'Based on your top Radiohead ranking.']]),
  },
};

describe('ConciergeAgent', () => {
  describe('fallback keyword parser', () => {
    it('should parse "more jazz" → boost_genre action', async () => {
      // Force Gemini to fail so fallback is used
      vi.spyOn(geminiApi, 'callWithTools').mockRejectedValue(new Error('offline'));

      const agent = new ConciergeAgent();
      const { actions } = await agent.chat('more jazz please', mockContext);

      expect(actions.some(a => a.type === 'boost_genre' && a.genre.toLowerCase() === 'jazz')).toBe(true);
    });

    it('should parse "less pop" → penalize_genre action', async () => {
      vi.spyOn(geminiApi, 'callWithTools').mockRejectedValue(new Error('offline'));
      const agent = new ConciergeAgent();
      const { actions } = await agent.chat('less pop', mockContext);
      expect(actions.some(a => a.type === 'penalize_genre' && a.genre.toLowerCase() === 'pop')).toBe(true);
    });

    it('should parse "make it more chill" → adjust_sliders with low energy', async () => {
      vi.spyOn(geminiApi, 'callWithTools').mockRejectedValue(new Error('offline'));
      const agent = new ConciergeAgent();
      const { actions } = await agent.chat('make it more chill', mockContext);
      const sliderAction = actions.find(a => a.type === 'adjust_sliders');
      expect(sliderAction).toBeTruthy();
      expect(sliderAction.sliders.energy).toBeLessThan(0.5);
    });

    it('should parse "discover something new" → adjust_sliders with high discovery', async () => {
      vi.spyOn(geminiApi, 'callWithTools').mockRejectedValue(new Error('offline'));
      const agent = new ConciergeAgent();
      const { actions } = await agent.chat('discover something new', mockContext);
      const sliderAction = actions.find(a => a.type === 'adjust_sliders');
      // discovery should be boosted
      expect(sliderAction?.sliders?.discovery).toBeGreaterThan(0.5);
    });
  });

  describe('Gemini function-call routing', () => {
    it('should parse Gemini boost_genre function call', async () => {
      vi.spyOn(geminiApi, 'callWithTools').mockResolvedValue({
        functionCalls: [{ name: 'boost_genre', args: { genre: 'jazz' } }],
        textReply: '',
      });

      const agent = new ConciergeAgent();
      const { actions } = await agent.chat('more jazz', mockContext);
      expect(actions[0]).toMatchObject({ type: 'boost_genre', genre: 'jazz' });
    });

    it('should parse Gemini adjust_sliders function call', async () => {
      vi.spyOn(geminiApi, 'callWithTools').mockResolvedValue({
        functionCalls: [{ name: 'adjust_sliders', args: { energy: 0.2 } }],
        textReply: '',
      });

      const agent = new ConciergeAgent();
      const { actions } = await agent.chat('make it chill', mockContext);
      expect(actions[0]).toMatchObject({ type: 'adjust_sliders', sliders: { energy: 0.2 } });
    });
  });

  describe('explainTrack()', () => {
    it('should return the stored explanation for a known track', () => {
      const agent = new ConciergeAgent();
      const reply = agent.explainTrack('Creep', mockContext);
      expect(reply).toContain('Radiohead');
    });

    it('should return not-found message for unknown track', () => {
      const agent = new ConciergeAgent();
      const reply = agent.explainTrack('Unknown Song', mockContext);
      expect(reply).toContain('couldn\'t find');
    });
  });

  describe('chat history', () => {
    it('should accumulate chat history entries', async () => {
      vi.spyOn(geminiApi, 'callWithTools').mockResolvedValue({ functionCalls: [], textReply: 'Hi!' });
      const agent = new ConciergeAgent();
      await agent.chat('Hello', mockContext);
      expect(agent.chatHistory.length).toBe(2); // user + model
    });

    it('should clear history on clearHistory()', () => {
      const agent = new ConciergeAgent();
      agent.chatHistory.push({ role: 'user', parts: [{ text: 'hi' }] });
      agent.clearHistory();
      expect(agent.chatHistory).toEqual([]);
    });
  });
});
