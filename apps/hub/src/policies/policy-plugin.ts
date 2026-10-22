import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '@cs/kernel';
import { evaluateRouteAccess, maskRecordForRole } from '@cs/core';
import { findRoutePolicy } from './route-matrix.js';

export interface HubPolicyPluginOptions {
  /**
   * If true, enables strict default-deny enforcement on all routes.
   * Default: true.
   */
  strictDefaultDeny?: boolean;
  /**
   * If true, applies field-level masking before serialization.
   * Default: true.
   */
  enableFieldMasking?: boolean;
}

const hubPolicyPluginAsync: FastifyPluginAsync<HubPolicyPluginOptions> = async (
  fastify,
  options = {}
) => {
  const { strictDefaultDeny = true, enableFieldMasking = true } = options;

  // 1. Authorization Pre-Handler Hook (Enforcing Default Deny)
  fastify.addHook('preHandler', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Route matching
    const policy = findRoutePolicy(request.method, request.url);

    // If strictDefaultDeny is enabled and no policy is found: Default Deny (403)
    if (!policy && strictDefaultDeny) {
      throw new AppError(
        'FORBIDDEN',
        `Access denied: Route ${request.method} ${request.url} has no registered policy (default deny).`,
        403
      );
    }

    if (policy) {
      const userRoles = request.user?.roles;
      const evaluation = evaluateRouteAccess(policy, userRoles);

      if (!evaluation.allowed) {
        throw new AppError(
          evaluation.denyCode,
          evaluation.message,
          evaluation.statusCode
        );
      }
    }
  });

  // 2. Pre-Serialization Hook: apply field-level masking server-side before serialization
  if (enableFieldMasking) {
    fastify.addHook('preSerialization', async (request: FastifyRequest, _reply: FastifyReply, payload: unknown) => {
      if (payload && typeof payload === 'object') {
        const userRoles = request.user?.roles;
        return maskRecordForRole(payload, userRoles);
      }
      return payload;
    });
  }
};

export const hubPolicyPlugin = fp(hubPolicyPluginAsync, {
  name: 'hub-policy-plugin',
  fastify: '5.x',
});
