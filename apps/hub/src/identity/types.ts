import * as jose from "jose";
import { Roles, RoleType, HubTokenClaims as BaseClaims, HubUser as BaseUser } from "@cs/identity";

export { Roles };
export type HubRole = RoleType;

export type HubUser = BaseUser;
export type HubTokenClaims = BaseClaims;

export interface HubCredential {
  id: string;
  userId: string;
  argon2Hash: string;
  createdAt: Date;
}

export interface HubRefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  expiresAt: Date;
  rotatedFrom?: string | undefined;
  revoked: boolean;
  createdAt: Date;
}

export type KeyStatus = "active" | "retired" | "revoked";

export interface HubKeyRecord {
  id: string;
  kid: string;
  status: KeyStatus;
  keyPair: jose.GenerateKeyPairResult;
  publicJwk: jose.JWK;
  createdAt: number;
  retiredAt?: number | undefined;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: number;
  user: {
    id: string;
    username: string;
    roles: HubRole[];
    employeeRef?: string | undefined;
  };
}
