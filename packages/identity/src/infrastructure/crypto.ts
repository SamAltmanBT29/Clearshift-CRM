import * as jose from "jose";
import * as argon2 from "argon2";
import * as crypto from "node:crypto";
import { AppError } from "@cs/kernel";
import { HubTokenClaims, RoleType, HubUser, Roles } from "../domain/token-claims.js";

/**
 * Standard Argon2id configuration per ClearShift Security Baseline:
 * - memoryCost: 65536 (64 MB)
 * - timeCost: 3 iterations
 * - parallelism: 4 threads
 * - type: argon2id (resistant to GPU side-channel attacks)
 */
export const ARGON2_CONFIG: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_CONFIG);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateSecureToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export interface KeyRecord {
  id: string;
  kid: string;
  status: "active" | "retired" | "revoked";
  keyPair: jose.GenerateKeyPairResult;
  publicJwk: jose.JWK;
  createdAt: number;
  retiredAt?: number;
}

export class HubKeyStore {
  private keys: Map<string, KeyRecord> = new Map();
  private activeKid: string | null = null;
  private readonly overlapWindowMs: number;

  constructor(options: { overlapWindowMs?: number } = {}) {
    this.overlapWindowMs = options.overlapWindowMs ?? 24 * 60 * 60 * 1000;
  }

  async initialize(defaultKid: string = "cs-hub-key-v1"): Promise<KeyRecord> {
    if (this.activeKid && this.keys.has(this.activeKid)) {
      return this.keys.get(this.activeKid)!;
    }

    const keyPair = await jose.generateKeyPair("EdDSA", { crv: "Ed25519" });
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = defaultKid;
    publicJwk.alg = "EdDSA";
    publicJwk.use = "sig";

    const record: KeyRecord = {
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

  async getActiveKey(): Promise<KeyRecord> {
    if (!this.activeKid || !this.keys.has(this.activeKid)) {
      return await this.initialize();
    }
    return this.keys.get(this.activeKid)!;
  }

  async rotateKey(newKid?: string): Promise<{ newKey: KeyRecord; retiredKey: KeyRecord }> {
    const activeKey = await this.getActiveKey();
    activeKey.status = "retired";
    activeKey.retiredAt = Date.now();

    const generatedKid = newKid || `cs-hub-key-${Date.now()}`;
    const keyPair = await jose.generateKeyPair("EdDSA", { crv: "Ed25519" });
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = generatedKid;
    publicJwk.alg = "EdDSA";
    publicJwk.use = "sig";

    const newKey: KeyRecord = {
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

  revokeKey(kid: string): boolean {
    const key = this.keys.get(kid);
    if (!key) return false;
    key.status = "revoked";
    if (this.activeKid === kid) this.activeKid = null;
    return true;
  }

  async getVerificationKey(kid: string, currentTime: number = Date.now()): Promise<jose.KeyLike | null> {
    if (!kid || typeof kid !== "string" || kid.includes("/") || kid.includes("..") || kid.includes("\\")) {
      return null;
    }

    const key = this.keys.get(kid);
    if (!key) return null;
    if (key.status === "revoked") return null;

    if (key.status === "retired") {
      const retiredAt = key.retiredAt ?? key.createdAt;
      if (currentTime - retiredAt > this.overlapWindowMs) {
        return null;
      }
    }

    return key.keyPair.publicKey;
  }

  async getPublicJWKS(currentTime: number = Date.now()): Promise<{ keys: jose.JWK[] }> {
    await this.getActiveKey();
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

  async signAccessToken(
    userId: string,
    roles: RoleType[],
    employeeId?: string,
    options?: { overrideKid?: string; ttlSeconds?: number }
  ): Promise<string> {
    const activeKey = options?.overrideKid && this.keys.has(options.overrideKid)
      ? this.keys.get(options.overrideKid)!
      : await this.getActiveKey();

    const now = Math.floor(Date.now() / 1000);
    const ttl = options?.ttlSeconds ?? 900;

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

  async verifyAccessToken(token: string, currentTime: number = Date.now()): Promise<HubTokenClaims> {
    let header: jose.ProtectedHeaderParameters;
    try {
      header = jose.decodeProtectedHeader(token);
    } catch {
      throw new AppError("UNAUTHORIZED", "Malformed token header", 401);
    }

    if (header.alg !== "EdDSA") {
      throw new AppError("UNAUTHORIZED", `Unapproved signing algorithm: ${header.alg}. Only EdDSA is permitted.`, 401);
    }

    if (!header.kid) {
      throw new AppError("UNAUTHORIZED", "Missing key identifier (kid) in token header", 401);
    }

    const publicKey = await this.getVerificationKey(header.kid, currentTime);
    if (!publicKey) {
      throw new AppError("UNAUTHORIZED", `Unknown, expired, or revoked key identifier: ${header.kid}`, 401);
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
        roles: (payload["roles"] as RoleType[]) || [],
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

export const defaultKeyStore = new HubKeyStore();

export async function getSigningKeys(): Promise<jose.GenerateKeyPairResult> {
  const active = await defaultKeyStore.getActiveKey();
  return active.keyPair;
}

export async function getPublicJWKS(): Promise<{ keys: jose.JWK[] }> {
  return await defaultKeyStore.getPublicJWKS();
}

export async function signAccessToken(
  userId: string,
  roles: RoleType[],
  employeeId?: string
): Promise<string> {
  return await defaultKeyStore.signAccessToken(userId, roles, employeeId);
}

export async function verifyAccessToken(token: string): Promise<HubTokenClaims> {
  return await defaultKeyStore.verifyAccessToken(token);
}

// User Store Implementation
export class HubUserStore {
  private users: Map<string, HubUser> = new Map();
  private usersByUsername: Map<string, HubUser> = new Map();
  private credentials: Map<string, string[]> = new Map(); // userId -> argon2 hashes
  private dummyHash: string = "";
  private initialized: boolean = false;

  async seedSyntheticUsers(): Promise<void> {
    if (this.initialized) return;
    this.dummyHash = await hashPassword("DummyAntiEnumerationSalt2026!");

    const seed = [
      { id: "user-admin-01", username: "admin", passwords: ["Admin#Pass2026!", "admin123"], roles: [Roles.ADMIN], status: "active" as const },
      { id: "user-runner-01", username: "runner", passwords: ["Runner#Pass2026!", "runner123"], roles: [Roles.MIGRATION_RUNNER], status: "active" as const },
      { id: "user-analyst-01", username: "analyst", passwords: ["Analyst#Pass2026!"], roles: [Roles.ANALYST], status: "active" as const },
      { id: "user-editor-01", username: "editor", passwords: ["Editor#Pass2026!"], roles: [Roles.EDITOR], status: "active" as const },
      { id: "user-viewer-01", username: "viewer", passwords: ["Viewer#Pass2026!"], roles: [Roles.VIEWER], status: "active" as const },
      { id: "user-disabled-01", username: "disabled_user", passwords: ["Disabled#Pass2026!"], roles: [Roles.VIEWER], status: "disabled" as const }
    ];

    for (const item of seed) {
      const user: HubUser = {
        id: item.id,
        username: item.username,
        roles: item.roles,
        status: item.status,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.users.set(user.id, user);
      this.usersByUsername.set(user.username.toLowerCase(), user);

      const hashes: string[] = [];
      for (const p of item.passwords) {
        hashes.push(await hashPassword(p));
      }
      this.credentials.set(user.id, hashes);
    }

    this.initialized = true;
  }

  async findById(id: string): Promise<HubUser | null> {
    await this.seedSyntheticUsers();
    return this.users.get(id) || null;
  }

  async findByUsername(username: string): Promise<HubUser | null> {
    await this.seedSyntheticUsers();
    return this.usersByUsername.get(username.toLowerCase()) || null;
  }

  async verifyCredentials(username: string, plain: string): Promise<{ success: boolean; user?: HubUser; reason?: "invalid_credentials" | "account_disabled" }> {
    await this.seedSyntheticUsers();
    const user = this.usersByUsername.get(username.toLowerCase());
    if (!user) {
      await verifyPassword(this.dummyHash, plain);
      return { success: false, reason: "invalid_credentials" };
    }

    const hashes = this.credentials.get(user.id) || [];
    let matched = false;
    for (const h of hashes) {
      if (await verifyPassword(h, plain)) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      return { success: false, reason: "invalid_credentials" };
    }

    if (user.status !== "active") {
      return { success: false, user, reason: "account_disabled" };
    }

    return { success: true, user };
  }

  async setUserStatus(id: string, status: "active" | "disabled"): Promise<boolean> {
    const user = await this.findById(id);
    if (!user) return false;
    user.status = status;
    return true;
  }
}

export const defaultUserStore = new HubUserStore();
