const mockAdd = jest.fn();
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
const mockQueueClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerCtor = jest.fn().mockImplementation(() => ({ close: mockWorkerClose, on: jest.fn() }));
const mockQueueCtor = jest.fn().mockImplementation(() => ({ add: mockAdd, close: mockQueueClose }));

jest.mock('bullmq', () => {
  class UnrecoverableError extends Error {}
  return {
    Worker: mockWorkerCtor,
    Queue: mockQueueCtor,
    UnrecoverableError,
  };
});

const mockDisconnect = jest.fn();
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({ disconnect: mockDisconnect })),
);

const mockRoute = jest.fn();
jest.mock('../src/router', () => ({
  Router: jest.fn().mockImplementation(() => ({ route: mockRoute })),
}));

jest.mock('../src/config', () => ({
  ConfigService: { instance: {} },
}));

import { UnrecoverableError } from 'bullmq';
import { BusConnector } from '../src/bus';
import { TOPICS, type ClusterReport, type RoutedJob } from '@brand-os/contracts';

function makeReport(): ClusterReport {
  return {
    id: 'r1',
    cluster_label: 'c',
    category: 'tech',
    signal_ids: ['s1'],
    key_insights: [],
    hooks: { pain_point: 'p', agitate: 'a', solution: 's', hot_take: 'h' },
    data_points: [],
    platform_flags: { instagram: false, linkedin: true, youtube: false, x: false, tiktok: false, douyin: false, rednote: false },
    speculative_edges: [],
    graph_svg_url: null,
    generated_at: '2026-07-11T00:00:00.000Z',
  };
}

describe('BusConnector', () => {
  beforeEach(() => {
    mockAdd.mockReset();
    mockRoute.mockReset();
    mockWorkerCtor.mockClear();
    mockQueueCtor.mockClear();
  });

  it('creates the output queue on the canonical jobs.routed topic', () => {
    new BusConnector('redis://mock:6379');
    expect(mockQueueCtor).toHaveBeenCalledWith(TOPICS.JOBS_ROUTED, expect.any(Object));
  });

  it('start() spins a worker on the canonical clusters.reports topic', () => {
    const bus = new BusConnector('redis://mock:6379');
    bus.start();
    expect(mockWorkerCtor).toHaveBeenCalledWith(
      TOPICS.CLUSTERS_REPORTS,
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('process() routes a valid report and enqueues each routed job', async () => {
    const report = makeReport();
    const routed: RoutedJob[] = [
      {
        id: 'r1:linkedin',
        cluster_report: report,
        target_platform: 'linkedin',
        content_format: 'carousel',
        priority: 5,
        ab_variant: null,
        created_at: '2026-07-11T00:00:00.000Z',
      },
    ];
    mockRoute.mockResolvedValue(routed);
    const bus = new BusConnector('redis://mock:6379');
    const n = await bus.process({ data: report } as never);
    expect(n).toBe(1);
    expect(mockRoute).toHaveBeenCalledWith(report);
    expect(mockAdd).toHaveBeenCalledWith(
      'routed_job',
      routed[0],
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('process() throws UnrecoverableError on invalid payload and enqueues nothing', async () => {
    const bus = new BusConnector('redis://mock:6379');
    await expect(bus.process({ data: { garbage: true } } as never)).rejects.toThrow(UnrecoverableError);
    expect(mockRoute).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('shutdown() closes worker, queue, and redis connection', async () => {
    const bus = new BusConnector('redis://mock:6379');
    bus.start();
    await bus.shutdown();
    expect(mockWorkerClose).toHaveBeenCalled();
    expect(mockQueueClose).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('shutdown() before start() still closes queue and connection', async () => {
    const bus = new BusConnector('redis://mock:6379');
    await bus.shutdown();
    expect(mockQueueClose).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
