import * as jose from "jose";
import * as crypto from "node:crypto";
import { AppError } from "@cs/kernel";
import { HubKeyRecord, HubRole, HubTokenClaims, KeyStatus } from "./types.js";

export interface KeyStoreOptions {
  /**
   * Overlap window in milliseconds during which a retired key remains valid
   * for signature verification.
   * Default: 24 hours (86,400,000 ms).
   */
  overlapWindowMs?: number;
}

export class HubKeyStore {
  private keys: Map<string, HubKeyRecord> = new Map();
  private activeKid: string | null = null;
  private readonly overlapWindowMs: number;

  constructor(options: KeyStoreOptions = {}) {
    this.overlapWindowMs = options.overlapWindowMs ?? 24 * 60 * 60 * 1000;
  }

  /**
   * Initializes default active key if key store is empty.
   */
  async initialize(defaultKid: string = "cs-hub-key-v1"): Promise<HubKeyRecord> {
    if (this.activeKid && this.keys.has(this.activeKid)) {
      return this.keys.get(this.activeKid)!;
    }

    const keyPair = await jose.generateKeyPair("EdDSA", { crv: "Ed25519" });
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = defaultKid;
    publicJwk.alg = "EdDSA";
    publicJwk.use = "sig";

    const record: HubKeyRecord = {
      id: crypto.randomUUID(),
      kid: defaultKid,
      status: "active",
      keyPair,
      publicJwk,
      createdAt: Date.now()
    };

    this.keys.set(defaultKid, record);
    this.activeKid = defaultKid;
    return record;
  }

  /**
   * Returns current active signing key.
   */
  async getActiveKey(): Promise<HubKeyRecord> {
    if (!this.activeKid || !this.keys.has(this.activeKid)) {
      return await this.initialize();
    }
    return this.keys.get(this.activeKid)!;
  }

  /**
   * Rotates signing keys:
   * Retires the current active key (starting its overlap window countdown).
   * Generates and activates a new Ed25519 keypair.
   */
  async rotateKey(newKid?: string): Promise<{ newKey: HubKeyRecord; retiredKey: HubKeyRecord }> {
    const activeKey = await this.getActiveKey();

    // Retire old active key
    activeKey.status = "retired";
    activeKey.retiredAt = Date.now();

    // Create new active key
    const generatedKid = newKid || `cs-hub-key-${Date.now()}`;
    const keyPair = await jose.generateKeyPair("EdDSA", { crv: "Ed25519" });
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = generatedKid;
    publicJwk.alg = "EdDSA";
    publicJwk.use = "sig";

    const newKey: HubKeyRecord = {
      id: crypto.randomUUID(),
      kid: generatedKid,
      status: "active",
      keyPair,
      publicJwk,
      createdAt: Date.now()
    };

    this.keys.set(generatedKid, newKey);
    this.activeKid = generatedKid;

    return { newKey, retiredKey: activeKey };
  }

  /**
   * Immediately revokes a key by kid. Revoked keys are rejected unconditionally.
   */
  revokeKey(kid: string): boolean {
    const key = this.keys.get(kid);
    if (!key) return false;
    key.status = "revoked";
    if (this.activeKid === kid) {
      this.activeKid = null;
    }
    return true;
  }

  /**
   * Resolves a public verification key by kid, enforcing the rotation overlap window.
   * Returns null if key is unknown, revoked, or retired past the overlap window.
   */
  async getVerificationKey(kid: string, currentTime: number = Date.now()): Promise<jose.KeyLike | null> {
    // Prevent directory traversal or URL lookup attacks
    if (!kid || typeof kid !== "string" || kid.includes("/") || kid.includes("..") || kid.includes("\\")) {
      return null;
    }

    const key = this.keys.get(kid);
    if (!key) {
      return null;
    }

    if (key.status === "revoked") {
      return null;
    }

    if (key.status === "retired") {
      const retiredAt = key.retiredAt ?? key.createdAt;
      if (currentTime - retiredAt > this.overlapWindowMs) {
        // Overlap window expired
        return null;
      }
    }

    return key.keyPair.publicKey;
  }

  /**
   * Returns public JWKS discovery payload.
   * Includes active key and valid retired keys within overlap window.
   */
  async getPublicJWKS(currentTime: number = Date.now()): Promise<{ keys: jose.JWK[] }> {
    await this.getActiveKey(); // Ensure initialized
    const validJwks: jose.JWK[] = [];

    for (const record of this.keys.values()) {
      if (record.status === "active") {
        validJwks.push(record.publicJwk);
      } else if (record.status === "retired") {
        const retiredAt = record.retiredAt ?? record.createdAt;
        if (currentTime - retiredAt <= this.overlapWindowMs) {
          validJwks.push(record.publicJwk);
        }
      }
    }

    return { keys: validJwks };
  }

  /**
   * Signs a JWT access token with the active key.
   * Enforces algorithm: EdDSA, TTL: 15 minutes (900 seconds).
   */
  async signAccessToken(
    userId: string,
    roles: HubRole[],
    employeeId?: string,
    options?: { overrideKid?: string; ttlSeconds?: number }
  ): Promise<string> {
    const activeKey = options?.overrideKid && this.keys.has(options.overrideKid)
      ? this.keys.get(options.overrideKid)!
      : await this.getActiveKey();

    const now = Math.floor(Date.now() / 1000);
    const ttl = options?.ttlSeconds ?? 900; // 15 minutes per SDS §3.3

    const builder = new jose.SignJWT({
      roles,
      ...(employeeId ? { employee_id: employeeId } : {})
    })
      .setProtectedHeader({ alg: "EdDSA", kid: activeKey.kid })
      .setIssuer("clearshift-hub")
      .setAudience("clearshift")
      .setSubject(userId)
      .setJti(`jti-${crypto.randomUUID()}`)
      .setIssuedAt(now)
      .setExpirationTime(now + ttl);

    return await builder.sign(activeKey.keyPair.privateKey);
  }

  /**
   * Verifies an access token and returns its claims.
   * Strict validation:
   * 1. Extracts protected header without trusting claims.
   * 2. Enforces alg is strictly EdDSA.
   * 3. Validates kid against approved key set with overlap window check.
   * 4. Verifies cryptographic signature.
   * 5. Validates issuer, audience, and required claims.
   */
  async verifyAccessToken(token: string, currentTime: number = Date.now()): Promise<HubTokenClaims> {
    let header: jose.ProtectedHeaderParameters;
    try {
      header = jose.decodeProtectedHeader(token);
    } catch {
      throw new AppError("UNAUTHORIZED", "Malformed token header", 401);
    }

    // Explicitly allow ONLY approved signing algorithm
    if (header.alg !== "EdDSA") {
      throw new AppError(
        "UNAUTHORIZED",
        `Unapproved signing algorithm: ${header.alg}. Only EdDSA is permitted.`,
        401
      );
    }

    if (!header.kid) {
      throw new AppError("UNAUTHORIZED", "Missing key identifier (kid) in token header", 401);
    }

    const publicKey = await this.getVerificationKey(header.kid, currentTime);
    if (!publicKey) {
      throw new AppError(
        "UNAUTHORIZED",
        `Unknown, expired, or revoked key identifier: ${header.kid}`,
        401
      );
    }

    try {
      const { payload } = await jose.jwtVerify(token, publicKey, {
        issuer: "clearshift-hub",
        audience: "clearshift",
        algorithms: ["EdDSA"],
        currentDate: new Date(currentTime)
      });

      if (!payload.sub || typeof payload.sub !== "string") {
        throw new AppError("UNAUTHORIZED", "Missing or invalid sub claim in token", 401);
      }
      if (!payload.jti || typeof payload.jti !== "string") {
        throw new AppError("UNAUTHORIZED", "Missing or invalid jti claim in token", 401);
      }
      if (!payload.exp || typeof payload.exp !== "number") {
        throw new AppError("UNAUTHORIZED", "Missing or invalid exp claim in token", 401);
      }
      if (!payload.iat || typeof payload.iat !== "number") {
        throw new AppError("UNAUTHORIZED", "Missing or invalid iat claim in token", 401);
      }

      return {
        iss: payload.iss as string,
        aud: payload.aud as string,
        sub: payload.sub as string,
        roles: (payload["roles"] as HubRole[]) || [],
        employee_id: typeof payload["employee_id"] === "string" ? payload["employee_id"] : undefined,
        iat: payload.iat as number,
        exp: payload.exp as number,
        jti: payload.jti as string,
        kid: header.kid
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err?.code === "ERR_JWT_EXPIRED") {
        throw new AppError("UNAUTHORIZED", "Token has expired", 401);
      }
      if (err?.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
        throw new AppError("UNAUTHORIZED", "Invalid token signature", 401);
      }
      throw new AppError("UNAUTHORIZED", `Token verification failed: ${err.message}`, 401);
    }
  }
}

// Global default singleton key store instance
export const defaultKeyStore = new HubKeyStore();
