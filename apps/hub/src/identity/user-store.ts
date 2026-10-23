import * as crypto from "node:crypto";
import { hashPassword, verifyPassword } from "./crypto.js";
import { HubCredential, HubRole, HubUser, Roles } from "./types.js";

export interface VerifyCredentialsResult {
  success: boolean;
  user?: HubUser;
  reason?: "invalid_credentials" | "account_disabled";
}

export class HubUserStore {
  private users: Map<string, HubUser> = new Map();
  private usersByUsername: Map<string, HubUser> = new Map();
  private credentials: Map<string, HubCredential[]> = new Map(); // userId -> credentials
  private dummyHash: string = "";
  private initialized: boolean = false;

  /**
   * Initializes synthetic user seed with Argon2id hashed credentials.
   * Fake data only, safe for testing and development.
   */
  async seedSyntheticUsers(): Promise<void> {
    if (this.initialized) return;

    // Precompute a dummy Argon2id hash for constant-time anti-enumeration checks
    this.dummyHash = await hashPassword("DummyAntiEnumerationSalt2026!");

    const syntheticSeed = [
      {
        id: "user-admin-01",
        username: "admin",
        passwords: ["Admin#Pass2026!", "admin123"],
        roles: [Roles.ADMIN] as HubRole[],
        status: "active" as const,
        employeeRef: "emp-admin-01"
      },
      {
        id: "user-runner-01",
        username: "runner",
        passwords: ["Runner#Pass2026!", "runner123"],
        roles: [Roles.MIGRATION_RUNNER] as HubRole[],
        status: "active" as const,
        employeeRef: "emp-runner-01"
      },
      {
        id: "user-analyst-01",
        username: "analyst",
        passwords: ["Analyst#Pass2026!"],
        roles: [Roles.ANALYST] as HubRole[],
        status: "active" as const,
        employeeRef: "emp-analyst-01"
      },
      {
        id: "user-editor-01",
        username: "editor",
        passwords: ["Editor#Pass2026!"],
        roles: [Roles.EDITOR] as HubRole[],
        status: "active" as const,
        employeeRef: "emp-editor-01"
      },
      {
        id: "user-viewer-01",
        username: "viewer",
        passwords: ["Viewer#Pass2026!"],
        roles: [Roles.VIEWER] as HubRole[],
        status: "active" as const,
        employeeRef: "emp-viewer-01"
      },
      {
        id: "user-disabled-01",
        username: "disabled_user",
        passwords: ["Disabled#Pass2026!"],
        roles: [Roles.VIEWER] as HubRole[],
        status: "disabled" as const,
        employeeRef: "emp-disabled-01"
      }
    ];

    for (const item of syntheticSeed) {
      const user: HubUser = {
        id: item.id,
        username: item.username,
        roles: item.roles,
        employeeRef: item.employeeRef,
        status: item.status,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.users.set(user.id, user);
      this.usersByUsername.set(user.username.toLowerCase(), user);

      const credList: HubCredential[] = [];
      for (const pwd of item.passwords) {
        const hash = await hashPassword(pwd);
        credList.push({
          id: crypto.randomUUID(),
          userId: user.id,
          argon2Hash: hash,
          createdAt: new Date()
        });
      }
      this.credentials.set(user.id, credList);
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

  /**
   * Verifies user credentials using Argon2id with anti-enumeration protection.
   * If user doesn't exist, runs a dummy verify to prevent timing attacks.
   */
  async verifyCredentials(username: string, plainPassword: string): Promise<VerifyCredentialsResult> {
    await this.seedSyntheticUsers();

    const user = this.usersByUsername.get(username.toLowerCase());
    if (!user) {
      // Run dummy verify to balance execution time
      await verifyPassword(this.dummyHash, plainPassword);
      return { success: false, reason: "invalid_credentials" };
    }

    const userCreds = this.credentials.get(user.id) || [];
    let matched = false;

    for (const cred of userCreds) {
      if (await verifyPassword(cred.argon2Hash, plainPassword)) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      return { success: false, reason: "invalid_credentials" };
    }

    // Check account status: disabled accounts must be rejected
    if (user.status !== "active") {
      return { success: false, user, reason: "account_disabled" };
    }

    return { success: true, user };
  }

  /**
   * Registers a new user for test scenarios.
   */
  async registerUser(params: {
    username: string;
    password: string;
    roles: HubRole[];
    status?: "active" | "disabled";
    employeeRef?: string;
  }): Promise<HubUser> {
    await this.seedSyntheticUsers();

    const id = `user-${crypto.randomUUID()}`;
    const user: HubUser = {
      id,
      username: params.username,
      roles: params.roles,
      status: params.status ?? "active",
      employeeRef: params.employeeRef,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.users.set(user.id, user);
    this.usersByUsername.set(user.username.toLowerCase(), user);

    const hash = await hashPassword(params.password);
    this.credentials.set(user.id, [
      {
        id: crypto.randomUUID(),
        userId: user.id,
        argon2Hash: hash,
        createdAt: new Date()
      }
    ]);

    return user;
  }

  /**
   * Updates an existing user's status (for testing disablement).
   */
  async setUserStatus(id: string, status: "active" | "disabled"): Promise<boolean> {
    const user = await this.findById(id);
    if (!user) return false;
    user.status = status;
    user.updatedAt = new Date();
    return true;
  }
}

export const defaultUserStore = new HubUserStore();
