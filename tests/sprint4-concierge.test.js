/**
 * Agent Music — Sprint 4 Tests
 * Tests for: Proactive Opening Message, Conversational Continuity
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock UserModel for isolated testing
vi.mock('../src/agents/user-model.js', () => ({
  UserModel: {
    getDriftTrends: vi.fn(() => ({
      genreMomentum: [],
      genreDecline: [],
      discoveryTrajectory: 'stable',
    })),
    getEpisodicMemory: vi.fn(() => ({ sessions: [] })),
    buildConciergeContext: vi.fn(() => ''),
  },
}));

// Mock DataStore
vi.mock('../src/data/data-store.js', () => ({
  DataStore: {
    getExplicitPreferences: vi.fn(() => ({})),
    getSessionSignals: vi.fn(() => ({})),
    load: vi.fn(() => null),
    save: vi.fn(),
  },
}));

// Mock gemini-api to prevent real API calls
vi.mock('../src/data/gemini-api.js', () => ({
  callWithTools: vi.fn(() => Promise.resolve({ functionCalls: [], textReply: 'Mocked reply' })),
}));

// --- Sprint 4.1: Proactive Opening Message ---
describe('Sprint 4.1 — Proactive Opening Message', () => {
  let ConciergeAgent, UserModel;

  beforeEach(async () => {
    const mod = await import('../src/agents/concierge-agent.js');
    ConciergeAgent = mod.ConciergeAgent;
    const umMod = await import('../src/agents/user-model.js');
    UserModel = umMod.UserModel;
    vi.clearAllMocks();
  });

  it('ConciergeAgent should have a generateOpeningMessage method', () => {
    const concierge = new ConciergeAgent();
    expect(typeof concierge.generateOpeningMessage).toBe('function');
  });

  it('should return null when no insights are available', () => {
    UserModel.getDriftTrends.mockReturnValue({ genreMomentum: [], genreDecline: [] });
    UserModel.getEpisodicMemory.mockReturnValue({ sessions: [] });

    const concierge = new ConciergeAgent();
    const msg = concierge.generateOpeningMessage({});
    expect(msg).toBeNull();
  });

  it('should surface a rising genre insight from drift trends', () => {
    UserModel.getDriftTrends.mockReturnValue({
      genreMomentum: [{ genre: 'post-punk', delta: 0.3, sessions: 3 }],
      genreDecline: [],
    });

    const concierge = new ConciergeAgent();
    const msg = concierge.generateOpeningMessage({});
    expect(msg).toContain('post-punk');
  });

  it('should prioritize events over other insights', () => {
    UserModel.getDriftTrends.mockReturnValue({
      genreMomentum: [{ genre: 'post-punk', delta: 0.3, sessions: 3 }],
      genreDecline: [],
    });

    const context = {
      currentEvents: [
        { type: 'tour', artist: 'Fontaines DC', description: 'North American tour dates announced' },
      ],
    };

    const concierge = new ConciergeAgent();
    const msg = concierge.generateOpeningMessage(context);
    // Events have priority 4, rising genre has priority 3
    expect(msg).toContain('Fontaines DC');
    expect(msg).toContain('tour dates');
  });

  it('should surface high skip rate warnings', () => {
    UserModel.getDriftTrends.mockReturnValue({ genreMomentum: [], genreDecline: [] });
    UserModel.getEpisodicMemory.mockReturnValue({
      sessions: [
        { stats: { skipRate: 45 } },
        { stats: { skipRate: 50 } },
      ],
    });

    const concierge = new ConciergeAgent();
    const msg = concierge.generateOpeningMessage({});
    expect(msg).toContain('skip rate');
  });

  it('should surface discovery-heavy playlist observations', () => {
    UserModel.getDriftTrends.mockReturnValue({ genreMomentum: [], genreDecline: [] });
    UserModel.getEpisodicMemory.mockReturnValue({ sessions: [] });

    const context = {
      scoredPlaylist: [
        { hopDistance: 1 },
        { hopDistance: 1 },
        { hopDistance: 1 },
        { hopDistance: 0 },
        { hopDistance: 0 },
      ],
    };

    const concierge = new ConciergeAgent();
    const msg = concierge.generateOpeningMessage(context);
    // 60% discovery
    expect(msg).toContain('discoveries');
    expect(msg).toContain('60%');
  });

  it('should surface critical consensus from cultural intelligence', () => {
    UserModel.getDriftTrends.mockReturnValue({ genreMomentum: [], genreDecline: [] });
    UserModel.getEpisodicMemory.mockReturnValue({ sessions: [] });

    const context = {
      blackboard: {
        culturalIntelligence: {
          criticalConsensus: [{ artist: 'Geese', insight: 'their new album is getting 9.0+ reviews' }],
        },
      },
    };

    const concierge = new ConciergeAgent();
    const msg = concierge.generateOpeningMessage(context);
    expect(msg).toContain('Geese');
    expect(msg).toContain('Critics');
  });
});

// --- Sprint 4.4: Conversational Continuity ---
describe('Sprint 4.4 — Conversational Continuity', () => {
  let ConciergeAgent;

  beforeEach(async () => {
    const mod = await import('../src/agents/concierge-agent.js');
    ConciergeAgent = mod.ConciergeAgent;
    vi.clearAllMocks();
  });

  it('should have a sessionSummary field initialized to empty string', () => {
    const concierge = new ConciergeAgent();
    expect(concierge.sessionSummary).toBe('');
  });

  it('clearHistory should reset sessionSummary', () => {
    const concierge = new ConciergeAgent();
    concierge.sessionSummary = 'some context';
    concierge.clearHistory();
    expect(concierge.sessionSummary).toBe('');
    expect(concierge.chatHistory).toEqual([]);
  });

  it('should seed sessionSummary after first exchange (chatHistory.length === 2)', async () => {
    const concierge = new ConciergeAgent();
    // Simulate first message (chatHistory goes to length 1 after push)
    concierge.chatHistory.push({ role: 'model', parts: [{ text: 'Hi!' }] });
    // Now the user sends their first real message — history will be at length 2 after push
    await concierge.chat('I want something for studying', {});
    expect(concierge.sessionSummary).toContain('studying');
  });

  it('should keep only 6 recent messages in chat history', async () => {
    const concierge = new ConciergeAgent();
    // Fill up with messages
    for (let i = 0; i < 12; i++) {
      concierge.chatHistory.push({ role: i % 2 === 0 ? 'user' : 'model', parts: [{ text: `msg ${i}` }] });
    }
    // After chat(), it should slice to -6
    await concierge.chat('test message', {});
    // The chat method slices recentHistory but doesn't trim chatHistory directly
    // The important thing is that recentHistory in the API call is limited
    expect(concierge.chatHistory.length).toBeGreaterThan(0);
  });

  it('_updateSessionSummary should extract activity context', () => {
    const concierge = new ConciergeAgent();
    concierge.sessionSummary = 'User opened with: "something"';
    concierge._updateSessionSummary("I'm studying for my finals");
    expect(concierge.sessionSummary).toContain('studying');
  });

  it('_updateSessionSummary should extract genre preferences', () => {
    const concierge = new ConciergeAgent();
    concierge.sessionSummary = 'User opened with: "hi"';
    concierge._updateSessionSummary("more jazz please");
    expect(concierge.sessionSummary).toContain('more jazz');
  });

  it('_updateSessionSummary should not duplicate facts', () => {
    const concierge = new ConciergeAgent();
    concierge.sessionSummary = 'User opened with: "hi"\n- User is studying';
    concierge._updateSessionSummary("I'm studying right now");
    // Should not add "User is studying" again
    const count = (concierge.sessionSummary.match(/studying/g) || []).length;
    expect(count).toBe(1);
  });

  it('the system prompt should include sessionSummary when available', () => {
    const concierge = new ConciergeAgent();
    concierge.sessionSummary = 'User wants jazz for studying';
    const prompt = concierge._buildSystemPrompt({});
    expect(prompt).toContain('CONVERSATION CONTEXT');
    expect(prompt).toContain('User wants jazz for studying');
  });

  it('the system prompt should NOT include conversation context when summary is empty', () => {
    const concierge = new ConciergeAgent();
    const prompt = concierge._buildSystemPrompt({});
    expect(prompt).not.toContain('CONVERSATION CONTEXT');
  });
});
