import * as crypto from "node:crypto";
import { AppError } from "@cs/kernel";
import { generateSecureToken, hashRefreshToken } from "./crypto.js";
import { HubRefreshTokenRecord } from "./types.js";
import { HubUserStore } from "./user-store.js";

export interface SessionOptions {
  /**
   * Refresh token TTL in milliseconds. Default: 7 days.
   */
  refreshTokenTtlMs?: number;
}

export class HubSessionManager {
  // Map of tokenHash -> HubRefreshTokenRecord
  private tokens: Map<string, HubRefreshTokenRecord> = new Map();
  // Map of userId -> Set of tokenHashes (for rapid revocation upon reuse detection)
  private userSessions: Map<string, Set<string>> = new Map();
  private readonly ttlMs: number;

  constructor(
    private userStore: HubUserStore,
    options: SessionOptions = {}
  ) {
    this.ttlMs = options.refreshTokenTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  /**
   * Creates a new refresh session and issues a refresh token and CSRF token.
   */
  async createSession(userId: string): Promise<{ refreshToken: string; csrfToken: string }> {
    const refreshToken = `rt_${generateSecureToken(32)}`;
    const csrfToken = `csrf_${generateSecureToken(24)}`;
    const tokenHash = hashRefreshToken(refreshToken);

    const record: HubRefreshTokenRecord = {
      id: crypto.randomUUID(),
      userId,
      tokenHash,
      csrfToken,
      expiresAt: new Date(Date.now() + this.ttlMs),
      revoked: false,
      createdAt: new Date()
    };

    this.tokens.set(tokenHash, record);

    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId)!.add(tokenHash);

    return { refreshToken, csrfToken };
  }

  /**
   * Validates CSRF token header for cookie-authenticated state-changing requests.
   */
  validateCsrf(csrfTokenHeader?: string): void {
    if (!csrfTokenHeader || typeof csrfTokenHeader !== "string" || csrfTokenHeader.trim() === "") {
      throw new AppError("FORBIDDEN", "CSRF token missing or invalid", 403);
    }
    // Check format (must start with csrf_ and have minimum length)
    if (!csrfTokenHeader.startsWith("csrf_") || csrfTokenHeader.length < 16) {
      throw new AppError("FORBIDDEN", "Malformed CSRF token", 403);
    }
  }

  /**
   * Rotates a refresh token session:
   * Enforces single-use token rotation, detects reuse attacks, verifies user status,
   * and issues a new refresh token and CSRF token.
   */
  async refreshSession(
    refreshToken: string,
    csrfTokenHeader?: string
  ): Promise<{ newRefreshToken: string; newCsrfToken: string; userId: string }> {
    // 1. Enforce CSRF protection
    this.validateCsrf(csrfTokenHeader);

    if (!refreshToken) {
      throw new AppError("UNAUTHORIZED", "Missing refresh token", 401);
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const record = this.tokens.get(tokenHash);

    // If token not found
    if (!record) {
      throw new AppError("UNAUTHORIZED", "Invalid or unknown refresh token", 401);
    }

    // 2. Refresh Token Reuse Detection
    // If token is already marked revoked or has been rotated from
    if (record.revoked || record.rotatedFrom) {
      // Security Incident: Refresh Token Reuse Attack Detected!
      // Invalidate all active sessions for this user immediately
      await this.revokeAllUserSessions(record.userId);
      throw new AppError(
        "UNAUTHORIZED",
        "Refresh token reuse detected. All sessions for this account have been invalidated.",
        401
      );
    }

    // 3. Expiry Check
    if (record.expiresAt.getTime() < Date.now()) {
      record.revoked = true;
      throw new AppError("UNAUTHORIZED", "Refresh token has expired", 401);
    }

    // 4. Verify Account Status
    const user = await this.userStore.findById(record.userId);
    if (!user || user.status !== "active") {
      record.revoked = true;
      throw new AppError("UNAUTHORIZED", "User account is disabled or suspended", 401);
    }

    // 5. Rotate Token: Invalidate old token and issue new one
    record.revoked = true;

    const newRefreshToken = `rt_${generateSecureToken(32)}`;
    const newCsrfToken = `csrf_${generateSecureToken(24)}`;
    const newTokenHash = hashRefreshToken(newRefreshToken);

    const newRecord: HubRefreshTokenRecord = {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: newTokenHash,
      csrfToken: newCsrfToken,
      expiresAt: new Date(Date.now() + this.ttlMs),
      rotatedFrom: tokenHash,
      revoked: false,
      createdAt: new Date()
    };

    this.tokens.set(newTokenHash, newRecord);
    this.userSessions.get(user.id)?.add(newTokenHash);

    return {
      newRefreshToken,
      newCsrfToken,
      userId: user.id
    };
  }

  /**
   * Revokes a single session by refresh token (used on logout).
   */
  async revokeSession(refreshToken: string): Promise<boolean> {
    if (!refreshToken) return false;
    const tokenHash = hashRefreshToken(refreshToken);
    const record = this.tokens.get(tokenHash);
    if (!record) return false;

    record.revoked = true;
    this.userSessions.get(record.userId)?.delete(tokenHash);
    return true;
  }

  /**
   * Revokes all sessions for a user (used upon reuse detection or account suspension).
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    const userHashes = this.userSessions.get(userId);
    if (userHashes) {
      for (const hash of userHashes) {
        const record = this.tokens.get(hash);
        if (record) {
          record.revoked = true;
        }
      }
      userHashes.clear();
    }
  }

  /**
   * Helper to parse cookies from raw Cookie header.
   */
  static parseCookies(cookieHeader?: string): Record<string, string> {
    if (!cookieHeader) return {};
    const cookies: Record<string, string> = {};
    const items = cookieHeader.split(";");
    for (const item of items) {
      const parts = item.split("=");
      const key = parts[0]?.trim();
      if (key) {
        cookies[key] = decodeURIComponent(parts.slice(1).join("=").trim());
      }
    }
    return cookies;
  }

  /**
   * Helper to format Set-Cookie string with strict security attributes.
   */
  static formatRefreshCookie(token: string, maxAgeSeconds: number = 7 * 24 * 3600): string {
    return `cs_refresh_token=${encodeURIComponent(token)}; Path=/hub/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  }

  /**
   * Helper to format cleared Set-Cookie string for logout.
   */
  static formatClearRefreshCookie(): string {
    return `cs_refresh_token=; Path=/hub/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}
