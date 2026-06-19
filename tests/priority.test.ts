jest.mock('../src/config', () => ({
  ConfigService: {
    instance: {
      getPriorityConfig: () => ({
        weights: {
          likes: 0.2,
          shares: 0.3,
          comments: 0.25,
          views: 0.15,
          watch_time_seconds: 0.1,
        },
        max_score: 100,
      }),
    },
  },
}));

import { PriorityScorer } from '../src/priority';

describe('PriorityScorer', () => {
  it('returns 1 for zero engagement (no metrics)', () => {
    const scorer = new PriorityScorer();
    expect(scorer.score({ likes: 0, shares: 0, comments: 0, views: 0 })).toBe(1);
  });

  it('returns 10 for very high engagement (exceeds max_score)', () => {
    const scorer = new PriorityScorer();
    expect(scorer.score({ likes: 10000, shares: 10000, comments: 10000, views: 10000, watch_time_seconds: 10000 })).toBe(10);
  });

  it('handles missing watch_time_seconds (treats as 0)', () => {
    const scorer = new PriorityScorer();
    // With watch_time_seconds missing, treated as 0
    const result = scorer.score({ likes: 100, shares: 0, comments: 0, views: 0 });
    // raw = 100*0.2 + 0 + 0 + 0 + 0 = 20
    // scaled = round((20/100)*10) = round(2) = 2
    expect(result).toBe(2);
  });

  it('correct weighted calculation for known input', () => {
    const scorer = new PriorityScorer();
    // raw = 10*0.2 + 5*0.3 + 4*0.25 + 100*0.15 + 30*0.1
    // raw = 2 + 1.5 + 1 + 15 + 3 = 22.5
    // scaled = round((22.5/100)*10) = round(2.25) = 2
    const result = scorer.score({ likes: 10, shares: 5, comments: 4, views: 100, watch_time_seconds: 30 });
    expect(result).toBe(2);
  });

  it('returns integer (no floats)', () => {
    const scorer = new PriorityScorer();
    const result = scorer.score({ likes: 1, shares: 1, comments: 1, views: 1, watch_time_seconds: 1 });
    // raw = 0.2 + 0.3 + 0.25 + 0.15 + 0.1 = 1.0
    // scaled = round((1/100)*10) = round(0.1) = 0 -> clamped to 1
    expect(Number.isInteger(result)).toBe(true);
  });

  it('clamped between 1 and 10', () => {
    const scorer = new PriorityScorer();
    // Very low: raw = 0.1*0.2 + 0 + 0 + 0 + 0 = 0.02, scaled = round(0.002) = 0 -> clamped to 1
    const low = scorer.score({ likes: 0.1, shares: 0, comments: 0, views: 0, watch_time_seconds: 0 });
    expect(low).toBeGreaterThanOrEqual(1);
    expect(low).toBeLessThanOrEqual(10);

    // Very high: should clamp to 10
    const high = scorer.score({ likes: 100000, shares: 100000, comments: 100000, views: 100000, watch_time_seconds: 100000 });
    expect(high).toBeGreaterThanOrEqual(1);
    expect(high).toBeLessThanOrEqual(10);
  });

  it('guards against max_score = 0 → returns 1', () => {
    jest.resetModules();
    jest.mock('../src/config', () => ({
      ConfigService: {
        instance: {
          getPriorityConfig: () => ({
            weights: {
              likes: 0.2,
              shares: 0.3,
              comments: 0.25,
              views: 0.15,
              watch_time_seconds: 0.1,
            },
            max_score: 0,
          }),
        },
      },
    }));

    const { PriorityScorer: ScorerWithZeroMax } = require('../src/priority');
    const scorer = new ScorerWithZeroMax();
    expect(scorer.score({ likes: 50, shares: 20, comments: 10, views: 200, watch_time_seconds: 60 })).toBe(1);
  });

  it('returns correct value for mid-range engagement', () => {
    const scorer = new PriorityScorer();
    // raw = 500*0.2 + 300*0.3 + 200*0.25 + 1000*0.15 + 400*0.1
    // raw = 100 + 90 + 50 + 150 + 40 = 430
    // scaled = round((430/100)*10) = round(43) = 43 -> clamped to 10
    const result = scorer.score({ likes: 500, shares: 300, comments: 200, views: 1000, watch_time_seconds: 400 });
    expect(result).toBe(10);
  });
});
