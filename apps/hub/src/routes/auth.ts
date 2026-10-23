import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { AppError } from "@cs/kernel";
import { AuditService, InMemoryAuditRepository, extractCorrelationId } from "@cs/core";
import { HubKeyStore, defaultKeyStore } from "../identity/key-store.js";
import { HubUserStore, defaultUserStore } from "../identity/user-store.js";
import { HubSessionManager } from "../identity/session-manager.js";
import { HubRole, Roles } from "../identity/types.js";

const LoginBodySchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required")
});

const ServiceTokenBodySchema = z.object({
  serviceName: z.string().min(1, "Service name is required"),
  role: z.enum([Roles.MIGRATION_RUNNER, Roles.ADMIN, Roles.ANALYST, Roles.EDITOR, Roles.VIEWER])
});

export interface HubAuthRouteOptions {
  keyStore?: HubKeyStore;
  userStore?: HubUserStore;
  sessionManager?: HubSessionManager;
  auditService?: AuditService;
}

export const hubAuthRoutes: FastifyPluginAsync<HubAuthRouteOptions> = async (
  fastify,
  options = {}
) => {
  const keyStore = options.keyStore ?? defaultKeyStore;
  const userStore = options.userStore ?? defaultUserStore;
  const sessionManager = options.sessionManager ?? new HubSessionManager(userStore);
  const auditService = options.auditService ?? new AuditService(new InMemoryAuditRepository());

  // Helper to register an endpoint on both /hub/... and /api/v1/hub/...
  const registerAuthEndpoint = (
    method: "get" | "post",
    subPath: string,
    handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  ) => {
    const paths = [`/hub${subPath}`, `/api/v1/hub${subPath}`];
    // Remove duplicates if fastify is already prefixed
    const uniquePaths = Array.from(new Set(paths));
    for (const p of uniquePaths) {
      fastify[method](p, handler);
    }
  };

  /**
   * GET /hub/.well-known/jwks.json
   * Public JWKS key discovery endpoint
   */
  registerAuthEndpoint("get", "/.well-known/jwks.json", async () => {
    return await keyStore.getPublicJWKS();
  });

  /**
   * POST /hub/auth/login
   * Authenticates user via Argon2id, issues access token + HttpOnly refresh cookie + CSRF token.
   * Audits login attempts without logging sensitive credentials.
   */
  registerAuthEndpoint("post", "/auth/login", async (request, reply) => {
    const correlationId = extractCorrelationId(request.headers);
    const forwarded = request.headers["x-forwarded-for"];
    const clientIp = (Array.isArray(forwarded) ? forwarded[0] : (forwarded as string)) || request.ip || "127.0.0.1";

    const parseResult = LoginBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      await auditService.logAuthFailure({
        username: "unknown",
        correlationId,
        reason: "validation_error",
        ipAddress: clientIp
      });
      throw new AppError("VALIDATION_ERROR", "Invalid login payload", 400);
    }

    const { username, password } = parseResult.data;

    // Verify credentials with Argon2id and anti-enumeration timing protection
    const verification = await userStore.verifyCredentials(username, password);

    if (!verification.success || !verification.user) {
      const failureReason = verification.reason ?? "invalid_credentials";

      // Security Audit Log: Record failed attempt WITHOUT sensitive credentials
      await auditService.logAuthFailure({
        username,
        correlationId,
        reason: failureReason,
        ipAddress: clientIp
      });

      if (failureReason === "account_disabled") {
        throw new AppError("UNAUTHORIZED", "User account is disabled or suspended", 401);
      }
      throw new AppError("UNAUTHORIZED", "Invalid username or password", 401);
    }

    const user = verification.user;

    // Audit successful authentication
    await auditService.log({
      actor: user.id,
      action: "auth.succeeded",
      targetEntity: "session",
      correlationId,
      result: "success",
      ipAddress: clientIp,
      metadata: {
        username: user.username,
        roles: user.roles
      }
    });

    // 1. Sign JWT access token with 15-minute TTL
    const accessToken = await keyStore.signAccessToken(user.id, user.roles, user.employeeRef);

    // 2. Create refresh session and CSRF token
    const { refreshToken, csrfToken } = await sessionManager.createSession(user.id);

    // 3. Store refresh token in secure, HttpOnly, SameSite browser cookie
    reply.header("Set-Cookie", HubSessionManager.formatRefreshCookie(refreshToken));

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 900,
      csrf_token: csrfToken,
      user: {
        id: user.id,
        username: user.username,
        roles: user.roles,
        employee_ref: user.employeeRef
      }
    };
  });

  /**
   * POST /hub/auth/refresh
   * Rotates refresh session and issues new access token.
   * Requires CSRF header validation for cookie-authenticated requests.
   */
  registerAuthEndpoint("post", "/auth/refresh", async (request, reply) => {
    const rawCookies = request.headers.cookie;
    const cookies = HubSessionManager.parseCookies(rawCookies);
    const refreshToken = cookies["cs_refresh_token"];

    if (!refreshToken) {
      throw new AppError("UNAUTHORIZED", "Missing refresh token cookie", 401);
    }

    const csrfHeader = (request.headers["x-csrf-token"] as string) || (request.headers["x-xsrf-token"] as string);

    // Enforce CSRF protection and single-use token rotation
    const rotation = await sessionManager.refreshSession(refreshToken, csrfHeader);

    // Fetch user and check account status
    const user = await userStore.findById(rotation.userId);
    if (!user || user.status !== "active") {
      throw new AppError("UNAUTHORIZED", "User account is disabled or suspended", 401);
    }

    // Sign new access token (15 minutes TTL)
    const newAccessToken = await keyStore.signAccessToken(user.id, user.roles, user.employeeRef);

    // Set rotated refresh token in HttpOnly cookie
    reply.header("Set-Cookie", HubSessionManager.formatRefreshCookie(rotation.newRefreshToken));

    return {
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: 900,
      csrf_token: rotation.newCsrfToken
    };
  });

  /**
   * POST /hub/auth/logout
   * Invalidates refresh session and clears HttpOnly refresh cookie.
   * Requires CSRF protection.
   */
  registerAuthEndpoint("post", "/auth/logout", async (request, reply) => {
    const csrfHeader = (request.headers["x-csrf-token"] as string) || (request.headers["x-xsrf-token"] as string);
    sessionManager.validateCsrf(csrfHeader);

    const rawCookies = request.headers.cookie;
    const cookies = HubSessionManager.parseCookies(rawCookies);
    const refreshToken = cookies["cs_refresh_token"];

    if (refreshToken) {
      await sessionManager.revokeSession(refreshToken);
    }

    // Clear refresh cookie
    reply.header("Set-Cookie", HubSessionManager.formatClearRefreshCookie());

    return {
      status: "logged_out"
    };
  });

  /**
   * POST /hub/service-tokens
   * Issues scoped machine-to-machine service tokens.
   */
  registerAuthEndpoint("post", "/service-tokens", async (request) => {
    const parseResult = ServiceTokenBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid service token payload", 400);
    }

    const { serviceName, role } = parseResult.data;
    const token = await keyStore.signAccessToken(`service-${serviceName}`, [role as HubRole]);

    return {
      service_name: serviceName,
      access_token: token,
      token_type: "Bearer",
      expires_in: 900
    };
  });
};
