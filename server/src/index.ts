import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedTestAccount } from './accounts/testAccount.js';
import { createCaroServer } from './app.js';
import { loadConfig } from './config.js';

// Local secrets (e.g. CLOUDINARY_URL) from server/.env, which is gitignored. Resolved from
// this file so it works for both src/ (tsx) and dist/ (node). Variables already set in the
// environment, as on Railway/Render, win over the file.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const cfg = loadConfig();
const server = createCaroServer(cfg);
// Open (and migrate) the accounts database before listening, so a bad DATABASE_URL / DATABASE_PATH
// or token fails the deploy (the health check never passes) instead of the first login.
await server.accounts.open();

if (cfg.accounts.testAccount) {
  // Never blocks the boot: a failed seed only means the test login is stale until the next start.
  try {
    const { created, added } = await seedTestAccount(server.accounts, cfg.accounts.testAccount);
    console.log(`[caro] test account ${created ? 'created' : 'ready'}: ${JSON.stringify(added)} added`);
  } catch (err) {
    console.error('[caro] test account seed failed', err);
  }
}

server.httpServer.listen(cfg.port, () => {
  console.log(`[caro] server listening on :${cfg.port}`);
  console.log(`[caro] allowed origins: ${cfg.clientOrigins.join(', ')}`);
  console.log(`[caro] accounts database: ${server.accounts.location}${cfg.accounts.jwtSecret ? '' : ' (JWT key kept in the database)'}`);
  console.log(`[caro] avatar storage: ${cfg.avatars.cloudinary ? `cloudinary (${cfg.avatars.cloudinary.cloudName})` : `local disk (${cfg.avatars.localDir})`}`);
});

const shutdown = (signal: string) => {
  console.log(`[caro] ${signal} received, shutting down`);
  server.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
