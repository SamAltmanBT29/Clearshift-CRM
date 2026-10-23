import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { AppError } from "@cs/kernel";
import { HubKeyStore, defaultKeyStore } from "../identity/key-store.js";
import { HubUserStore, defaultUserStore } from "../identity/user-store.js";
import { HubTokenClaims } from "../identity/types.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: HubTokenClaims;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

export interface HubJwtAuthPluginOptions {
  keyStore?: HubKeyStore;
  userStore?: HubUserStore;
}

const jwtAuthPluginAsync: FastifyPluginAsync<HubJwtAuthPluginOptions> = async (
  fastify,
  options = {}
) => {
  const keyStore = options.keyStore ?? defaultKeyStore;
  const userStore = options.userStore ?? defaultUserStore;

  fastify.decorateRequest("user", undefined);

  fastify.decorate("authenticate", async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new AppError("UNAUTHORIZED", "Missing Bearer token payload", 401);
    }

    // 1. Verify token cryptographic signature, alg, kid, and standard claims
    const claims = await keyStore.verifyAccessToken(token);

    // 2. Reject disabled accounts from accessing authenticated endpoints
    const user = await userStore.findById(claims.sub);
    if (user && user.status !== "active") {
      throw new AppError("UNAUTHORIZED", "User account is disabled or suspended", 401);
    }

    // 3. Attach verified claims to request
    request.user = claims;
  });
};

export const jwtAuthPlugin = fp(jwtAuthPluginAsync, {
  name: "hub-jwt-auth",
  fastify: "5.x"
});
