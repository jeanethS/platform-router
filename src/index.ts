import { BusConnector } from './bus';
import { createServer } from './server';
import { ConfigService } from './config';
import { initTracer, shutdownTracer } from './tracer';

const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);

async function main(): Promise<void> {
  // Load config (watches for hot-reload)
  new ConfigService();

  // Init OpenTelemetry tracing
  initTracer();

  // Start BullMQ worker
  const bus = new BusConnector();
  bus.start();
  console.log('[main] BullMQ connector started');

  // Start HTTP server
  const app = await createServer();
  await app.listen({ port: HTTP_PORT, host: '0.0.0.0' });
  console.log(`[main] HTTP server listening on :${HTTP_PORT}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[main] Received ${signal}, shutting down...`);
    await bus.shutdown();
    await app.close();
    await shutdownTracer();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[main] Fatal error:', err);
  process.exit(1);
});
