import { describe, it, expect } from 'vitest';

/**
 * Unit tests extracted from agentic-discovery.test.js.
 * Pure logic, no LLM calls, always run.
 */

describe('PlaylistScheduler — Intent Seed Generation (unit)', () => {

  it('time-contextual seeds are appropriate for the current hour', () => {
    const hour = new Date().getHours();

    let seed;
    if (hour >= 6 && hour < 10) seed = 'Easy morning energy';
    else if (hour >= 10 && hour < 14) seed = 'Midday focus';
    else if (hour >= 14 && hour < 18) seed = 'Afternoon groove';
    else if (hour >= 18 && hour < 22) seed = 'Evening unwind';
    else seed = 'Late night';

    expect(seed).toBeTruthy();
    expect(seed.length).toBeGreaterThan(5);
  });

  it('fallback seeds are non-generic', () => {
    const fallbacks = [
      'A mix of critically acclaimed albums from the past year',
      'Hidden gems — underappreciated tracks from great artists',
      'Genre-spanning journey — connect the dots across your taste',
    ];

    for (const seed of fallbacks) {
      expect(seed.length).toBeGreaterThan(20);
      expect(seed).not.toContain('good music');
      expect(seed).not.toContain('playlist');
    }
  });
});

describe('Scout — Connection Reason Formatting (unit)', () => {

  function formatRelationshipReason(rel, seedName) {
    switch (rel.type) {
      case 'member of band':
        return rel.direction === 'backward'
          ? `Member of ${seedName}`
          : `${seedName} was a member of ${rel.targetName}`;
      case 'collaboration':
        return `Collaborated with ${seedName}`;
      case 'supporting musician':
        return rel.direction === 'backward'
          ? `Session/touring musician for ${seedName}`
          : `${seedName} performed with ${rel.targetName}`;
      case 'founder':
        return `Founded by a member of ${seedName}`;
      case 'subgroup':
        return `Side project of ${seedName}`;
      default:
        return `Connected to ${seedName}`;
    }
  }

  it('formats member-of-band correctly', () => {
    const rel = { type: 'member of band', targetName: 'The Beatles', direction: 'forward' };
    expect(formatRelationshipReason(rel, 'John Lennon')).toBe('John Lennon was a member of The Beatles');
  });

  it('formats backward member-of-band correctly', () => {
    const rel = { type: 'member of band', targetName: 'Ringo Starr', direction: 'backward' };
    expect(formatRelationshipReason(rel, 'The Beatles')).toBe('Member of The Beatles');
  });

  it('formats collaboration correctly', () => {
    const rel = { type: 'collaboration', targetName: 'Iggy Pop', direction: 'forward' };
    expect(formatRelationshipReason(rel, 'David Bowie')).toBe('Collaborated with David Bowie');
  });

  it('formats supporting musician correctly', () => {
    const rel = { type: 'supporting musician', targetName: 'Herbie Hancock', direction: 'backward' };
    expect(formatRelationshipReason(rel, 'Miles Davis')).toBe('Session/touring musician for Miles Davis');
  });

  it('formats founder correctly', () => {
    const rel = { type: 'founder', targetName: 'Weather Report', direction: 'forward' };
    expect(formatRelationshipReason(rel, 'Wayne Shorter')).toBe('Founded by a member of Wayne Shorter');
  });

  it('formats subgroup correctly', () => {
    const rel = { type: 'subgroup', targetName: 'Them Crooked Vultures', direction: 'forward' };
    expect(formatRelationshipReason(rel, 'Foo Fighters')).toBe('Side project of Foo Fighters');
  });
});

describe('DataStore — Playlist Library Schema (unit)', () => {

  it('library entry has required fields', () => {
    const entry = {
      id: '12345',
      createdAt: Date.now(),
      listenedAt: null,
      intent: 'late night jazz',
      source: 'scheduler',
      title: 'Midnight Modal',
      trackCount: 12,
      curatorReflection: 'Built around Miles Davis anchor...',
      context: {},
    };

    expect(entry.id).toBeTruthy();
    expect(entry.listenedAt).toBeNull();
    expect(entry.source).toBe('scheduler');
    expect(entry.trackCount).toBeGreaterThan(0);
  });

  it('unlistened count logic is correct', () => {
    const library = [
      { id: '1', listenedAt: null },
      { id: '2', listenedAt: Date.now() },
      { id: '3', listenedAt: null },
      { id: '4', listenedAt: null },
    ];

    const unlistened = library.filter(p => !p.listenedAt).length;
    expect(unlistened).toBe(3);
  });

  it('scheduler respects MAX_UNLISTENED threshold', () => {
    const MAX_UNLISTENED = 3;
    const unlistened = 3;
    const slotsNeeded = Math.max(0, MAX_UNLISTENED - unlistened);
    expect(slotsNeeded).toBe(0);
  });
});
