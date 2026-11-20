import { startServer } from './server';

const port = Number(process.env.PORT ?? 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const server = await startServer({
  port,
  allowedOrigins,
  ...(process.env.GHOST_FILE ? { ghostFile: process.env.GHOST_FILE } : {}),
  queueWaitMs: Number(process.env.QUEUE_WAIT_MS ?? 8000),
  countdownMs: Number(process.env.COUNTDOWN_MS ?? 3000),
});
console.log(`freeze server listening on :${server.port}`);

const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
