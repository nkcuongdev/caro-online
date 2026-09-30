import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCaroServer } from './app.js';
import { loadConfig } from './config.js';

// Local secrets (e.g. CLOUDINARY_URL) from server/.env, which is gitignored. Resolved from
// this file so it works for both src/ (tsx) and dist/ (node). Variables already set in the
// environment, as on Railway/Render, win over the file.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const cfg = loadConfig();
const server = createCaroServer(cfg);
// Open (and migrate) the accounts database now, so a bad DATABASE_PATH fails the deploy instead of the first login.
server.accounts.open();

server.httpServer.listen(cfg.port, () => {
  console.log(`[caro] server listening on :${cfg.port}`);
  console.log(`[caro] allowed origins: ${cfg.clientOrigins.join(', ')}`);
  console.log(`[caro] accounts database: ${cfg.accounts.databasePath}${cfg.accounts.jwtSecret ? '' : ' (JWT key kept in the database)'}`);
  console.log(`[caro] avatar storage: ${cfg.avatars.cloudinary ? `cloudinary (${cfg.avatars.cloudinary.cloudName})` : `local disk (${cfg.avatars.localDir})`}`);
});

const shutdown = (signal: string) => {
  console.log(`[caro] ${signal} received, shutting down`);
  server.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
