import * as argon2 from "argon2";
import * as crypto from "node:crypto";

/**
 * Standard Argon2id configuration per ClearShift Security Baseline:
 * - memoryCost: 65536 (64 MB)
 * - timeCost: 3 iterations
 * - parallelism: 4 threads
 * - type: argon2id (memory-hard, resistant to GPU/ASIC side-channel attacks)
 */
export const ARGON2_CONFIG: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4
};

/**
 * Hashes a plaintext password using Argon2id.
 * Never stores or returns the plaintext password.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_CONFIG);
}

/**
 * Verifies a plaintext password against an Argon2id hash.
 * Returns boolean safely without throwing.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Computes a SHA-256 hash of a refresh token for storage.
 * Refresh tokens are never stored in plaintext in the database.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a cryptographically secure random hex string.
 */
export function generateSecureToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}
