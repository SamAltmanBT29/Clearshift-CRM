import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "@cs/kernel";
import {
  getPublicJWKS,
  signAccessToken,
  defaultUserStore,
  generateSecureToken,
  hashRefreshToken
} from "../infrastructure/crypto.js";
import { RoleType, Roles } from "../domain/token-claims.js";

const LoginBodySchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required")
});

const ServiceTokenBodySchema = z.object({
  serviceName: z.string().min(1, "Service name is required"),
  role: z.enum([Roles.MIGRATION_RUNNER, Roles.ADMIN, Roles.ANALYST, Roles.EDITOR, Roles.VIEWER])
});

// Simple in-memory session store for @cs/identity interface
const refreshTokens = new Map<string, { userId: string; expiresAt: number; revoked: boolean }>();

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const key = parts[0]?.trim();
    if (key) {
      cookies[key] = decodeURIComponent(parts.slice(1).join("=").trim());
    }
  });
  return cookies;
}

export const hubIdentityRoutes: FastifyPluginAsync = async (fastify) => {
  // Public JWKS discovery endpoint
  fastify.get("/hub/.well-known/jwks.json", async () => {
    return await getPublicJWKS();
  });

  // Hub Login endpoint with Argon2id anti-enumeration verification
  fastify.post("/hub/auth/login", async (request, reply) => {
    const parseResult = LoginBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid login payload", 400);
    }

    const { username, password } = parseResult.data;
    const verification = await defaultUserStore.verifyCredentials(username, password);

    if (!verification.success || !verification.user) {
      if (verification.reason === "account_disabled") {
        throw new AppError("UNAUTHORIZED", "User account is disabled or suspended", 401);
      }
      throw new AppError("UNAUTHORIZED", "Invalid username or password", 401);
    }

    const user = verification.user;
    const accessToken = await signAccessToken(user.id, user.roles, user.employeeRef);

    const refreshToken = `rt_${generateSecureToken(32)}`;
    const csrfToken = `csrf_${generateSecureToken(24)}`;
    const tokenHash = hashRefreshToken(refreshToken);

    refreshTokens.set(tokenHash, {
      userId: user.id,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      revoked: false
    });

    reply.header(
      "Set-Cookie",
      `cs_refresh_token=${encodeURIComponent(refreshToken)}; Path=/hub/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`
    );

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 900,
      csrf_token: csrfToken,
      user: {
        id: user.id,
        username: user.username,
        roles: user.roles
      }
    };
  });

  // Hub Refresh endpoint
  fastify.post("/hub/auth/refresh", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const refreshToken = cookies["cs_refresh_token"];
    if (!refreshToken) {
      throw new AppError("UNAUTHORIZED", "Missing refresh token cookie", 401);
    }

    const csrfHeader = (request.headers["x-csrf-token"] as string) || (request.headers["x-xsrf-token"] as string);
    if (!csrfHeader || !csrfHeader.startsWith("csrf_")) {
      throw new AppError("FORBIDDEN", "CSRF token missing or invalid", 403);
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const session = refreshTokens.get(tokenHash);

    if (!session || session.revoked || session.expiresAt < Date.now()) {
      if (session) session.revoked = true;
      throw new AppError("UNAUTHORIZED", "Invalid or expired refresh token", 401);
    }

    // Revoke old token (single-use rotation)
    session.revoked = true;

    const user = await defaultUserStore.findById(session.userId);
    if (!user || user.status !== "active") {
      throw new AppError("UNAUTHORIZED", "User account is disabled or suspended", 401);
    }

    const newAccessToken = await signAccessToken(user.id, user.roles, user.employeeRef);
    const newRefreshToken = `rt_${generateSecureToken(32)}`;
    const newCsrfToken = `csrf_${generateSecureToken(24)}`;
    const newTokenHash = hashRefreshToken(newRefreshToken);

    refreshTokens.set(newTokenHash, {
      userId: user.id,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      revoked: false
    });

    reply.header(
      "Set-Cookie",
      `cs_refresh_token=${encodeURIComponent(newRefreshToken)}; Path=/hub/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`
    );

    return {
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: 900,
      csrf_token: newCsrfToken
    };
  });

  // Hub Logout endpoint
  fastify.post("/hub/auth/logout", async (request, reply) => {
    const csrfHeader = (request.headers["x-csrf-token"] as string) || (request.headers["x-xsrf-token"] as string);
    if (!csrfHeader || !csrfHeader.startsWith("csrf_")) {
      throw new AppError("FORBIDDEN", "CSRF token missing or invalid", 403);
    }

    const cookies = parseCookies(request.headers.cookie);
    const refreshToken = cookies["cs_refresh_token"];
    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      const session = refreshTokens.get(tokenHash);
      if (session) session.revoked = true;
    }

    reply.header(
      "Set-Cookie",
      "cs_refresh_token=; Path=/hub/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    );

    return { status: "logged_out" };
  });

  // Issue scoped service token (Admin capability)
  fastify.post("/hub/service-tokens", async (request) => {
    const parseResult = ServiceTokenBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid service token payload", 400);
    }

    const { serviceName, role } = parseResult.data;
    const token = await signAccessToken(`service-${serviceName}`, [role as RoleType]);

    return {
      service_name: serviceName,
      access_token: token,
      token_type: "Bearer",
      expires_in: 900
    };
  });
};
