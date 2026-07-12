jest.mock('../src/config', () => ({
  ConfigService: {
    instance: {
      getPriorityConfig: () => ({
        weights: { likes: 0.2, shares: 0.3, comments: 0.25, views: 0.15 },
        max_score: 100,
      }),
    },
  },
}));

import { PriorityScorer } from '../src/priority';
import type { ClusterEngagement } from '@brand-os/contracts';

function eng(overrides: Partial<ClusterEngagement>): ClusterEngagement {
  return { views: 0, likes: 0, shares: 0, comments: 0, signal_count: 1, ...overrides };
}

describe('PriorityScorer', () => {
  const scorer = new PriorityScorer();

  it('returns neutral 5 when engagement is undefined', () => {
    expect(scorer.score(undefined)).toBe(5);
  });

  it('returns neutral 5 when signal_count is 0', () => {
    expect(scorer.score(eng({ views: 999, signal_count: 0 }))).toBe(5);
  });

  it('clamps zero engagement to 1', () => {
    expect(scorer.score(eng({}))).toBe(1);
  });

  it('clamps very high engagement to 10', () => {
    expect(scorer.score(eng({ views: 10000, likes: 10000, shares: 10000, comments: 10000 }))).toBe(10);
  });

  it('computes weighted score for known input', () => {
    // raw = 10*0.2 + 5*0.3 + 4*0.25 + 100*0.15 = 2 + 1.5 + 1 + 15 = 19.5
    // scaled = round((19.5/100)*10) = round(1.95) = 2
    expect(scorer.score(eng({ likes: 10, shares: 5, comments: 4, views: 100 }))).toBe(2);
  });

  it('returns an integer', () => {
    expect(Number.isInteger(scorer.score(eng({ likes: 33, views: 77 })))).toBe(true);
  });

  it('guards against max_score = 0 by returning 1', () => {
    jest.resetModules();
    jest.doMock('../src/config', () => ({
      ConfigService: {
        instance: {
          getPriorityConfig: () => ({
            weights: { likes: 0.2, shares: 0.3, comments: 0.25, views: 0.15 },
            max_score: 0,
          }),
        },
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PriorityScorer: ZeroMaxScorer } = require('../src/priority');
    const zeroScorer = new ZeroMaxScorer();
    expect(zeroScorer.score(eng({ likes: 50, views: 200 }))).toBe(1);
  });
});
