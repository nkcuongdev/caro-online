import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (memory-hard, built into Node: no native deps).
 *
 * Parameters follow OWASP's scrypt guidance (N=2^15, r=8, p=3 ≈ 32 MiB each):
 * as strong as its N=2^17 option with a quarter of the memory, which matters
 * on small instances. `crypto.scrypt` runs on the libuv thread pool, so a
 * login never stalls the event loop that drives the game clocks.
 *
 * Stored as `scrypt$<log2 N>$<r>$<p>$<salt b64url>$<hash b64url>`, so the
 * parameters can be raised later and old hashes upgraded on the next login.
 */

const LOG_N = 15;
const R = 8;
const P = 3;
const KEY_LEN = 32;
const SALT_LEN = 16;
const MAX_MEM = 96 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 8;
/** Bounds the work an attacker can make us do per request. */
export const PASSWORD_MAX_LENGTH = 128;

function derive(password: string, salt: Buffer, logN: number, r: number, p: number, keyLen: number): Promise<Buffer> {
  const options: ScryptOptions = { N: 2 ** logN, r, p, maxmem: MAX_MEM };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, keyLen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, LOG_N, R, P, KEY_LEN);
  return ['scrypt', LOG_N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [logN, r, p] = parts.slice(1, 4).map(Number);
  if (![logN, r, p].every(Number.isInteger) || logN < 10 || logN > 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (!salt.length || !expected.length) return false;
  const actual = await derive(password, salt, logN, r, p, expected.length);
  return timingSafeEqual(actual, expected);
}

/** True when a hash was made with weaker parameters than today's. */
export function needsRehash(stored: string): boolean {
  const [scheme, logN, r, p] = stored.split('$');
  return scheme !== 'scrypt' || Number(logN) !== LOG_N || Number(r) !== R || Number(p) !== P;
}

/**
 * Runs a full hash for an unknown email, so "no such account" takes as long
 * as "wrong password" and response times don't reveal which emails exist.
 */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('caro-online-timing-equalizer');
  await verifyPassword(password, await dummyHash);
}
