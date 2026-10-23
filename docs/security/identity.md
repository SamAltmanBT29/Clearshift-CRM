# ClearShift V1 Hub Identity, JWT Verification and Session Safety

## Document Control
- **Issue Reference**: [PLT-05] Hub Identity JWT Verification and Session Safety (#60)
- **Status**: APPROVED
- **Enforcement Level**: Non-Negotiable Core Invariant
- **Architectural Reference**: Decision C3, ClearShift SDS §3.3 & §7.1, ClearShift Project Plan v3.0 §17

---

## 1. Executive Summary

ClearShift Hub Identity (`@cs/identity` and `apps/hub/src/identity`) provides the authentication, token issuance, token verification, session lifecycle, and key management foundation for the ClearShift CRM platform.

All inter-module and client-to-API requests verify identity using **asymmetric cryptographic tokens** (EdDSA / Ed25519). Passwords are never stored in plaintext and are hashed using **Argon2id**. Long-lived browser sessions use **HttpOnly, Secure, SameSite cookies** protected by **CSRF tokens** and **single-use refresh token rotation with reuse detection**.

---

## 2. Cryptographic Token Specification (JWT)

### 2.1 Approved Signing Algorithm
- **Algorithm**: `EdDSA` (Edwards-curve Digital Signature Algorithm over Curve25519 / Ed25519).
- **Prohibited Algorithms**: Any symmetric algorithm (e.g. `HS256`), algorithm `none`, or untrusted client headers. The verification plugin enforces an explicit algorithm whitelist.

### 2.2 Token Lifetime
- **Access Token TTL**: Exactly **15 minutes** (900 seconds) per SDS §3.3.
- **Client Storage Policy**: Access tokens are held strictly **in memory** by web clients and must **never** be stored in browser `localStorage` or `sessionStorage` (preventing persistent XSS exfiltration).

### 2.3 Required Claims Contract

| Claim | Type | Value / Format | Validation Rule |
|---|---|---|---|
| `iss` | `string` | `"clearshift-hub"` | Strict match. Reject any other issuer. |
| `aud` | `string` | `"clearshift"` | Strict match. Reject any other audience. |
| `sub` | `string` | UUID or identifier (e.g. `user-admin-01`) | Must be present; sub account must be in `active` status. |
| `roles`| `string[]`| Array of `viewer`, `editor`, `migration_runner`, `analyst`, `admin` | Required array of approved roles. |
| `iat` | `number` | Unix timestamp in seconds | Issued-at time. Must not be in future. |
| `exp` | `number` | Unix timestamp in seconds | Expiration time (`iat + 900`). Expired tokens rejected. |
| `jti` | `string` | `jti-<uuid>` | Unique token identifier for tracing and replay prevention. |
| `kid` | `string` | e.g. `cs-hub-key-v1` | Must match an active or valid overlap key in server key set. |
| `employee_id` | `string` | UUID / identifier (optional) | Optional correlation to HR/employee profile. |

---

## 3. Password Hashing Standard (Argon2id)

ClearShift strictly enforces **Argon2id** (memory-hard, resistant to GPU and side-channel cracking):

```typescript
export const ARGON2_CONFIG = {
  type: argon2.argon2id,
  memoryCost: 65536,  // 64 MB memory
  timeCost: 3,        // 3 iterations
  parallelism: 4      // 4 concurrent threads
};
```

### 3.1 Anti-Enumeration Protection
To prevent attackers from discovering valid usernames, authentication timing is balanced:
- If a user does not exist, the authentication handler runs a dummy Argon2id verification against a fixed salt so execution duration is identical.
- Generic response `401 Unauthorized` with message `"Invalid username or password"` is returned for both unknown users and incorrect passwords.

### 3.2 Account Status Check
If credentials match but the user record has `status !== 'active'` (e.g. `disabled` or `suspended`), authentication and refresh are immediately rejected with `401 Unauthorized`.

---

## 4. Key Management and Rotation Runbook

### 4.1 Server-Controlled Key ID (`kid`) Lookup
1. The verification key is selected by extracting `kid` from the JWT protected header.
2. The `kid` is strictly resolved against the server-controlled key set.
3. Path traversal (`../../`) or URL lookups in `kid` are rejected immediately.

### 4.2 Key Rotation Procedure & Overlap Window
Key rotation enables scheduled retirement of signing keys without invalidating in-flight user tokens:
1. **Active Key**: Signs all newly issued access tokens and service tokens.
2. **Retired Key**: When rotated, the old active key becomes `retired` and records `retiredAt = now()`.
3. **Overlap Window**: For a configurable window (default: **24 hours** in production), tokens signed by the retired key remain valid for verification.
4. **Retirement Expiry**: Once `now - retiredAt > overlapWindow`, tokens signed with the old key are rejected with `401 Unauthorized`.
5. **Key Revocation**: A key flagged as `revoked` is immediately rejected regardless of the overlap window.

### 4.3 Operator Instructions: Rotating a Key
To rotate the Hub signing key in production:
```bash
# Via operational administration endpoint or script:
node -e 'import("@cs/identity").then(m => m.defaultKeyStore.rotateKey("cs-hub-key-v2"))'
```
The public JWKS endpoint (`/hub/.well-known/jwks.json`) automatically publishes both the new active public key and any retired keys within their overlap window.

---

## 5. Refresh Session Safety & CSRF Protection

### 5.1 Cookie Configuration
Refresh tokens are issued exclusively via `Set-Cookie` HTTP headers:
```http
Set-Cookie: cs_refresh_token=<token>; Path=/hub/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
```
- `HttpOnly`: Inaccessible to browser JavaScript (protects against XSS token theft).
- `Secure`: Transmitted only over HTTPS.
- `SameSite=Lax`: Defends against cross-site requests.
- `Path=/hub/auth`: Restricted to auth endpoints.

### 5.2 Single-Use Refresh Token Rotation & Reuse Detection
1. Refresh tokens are stored in the database as SHA-256 hashes (`token_hash`).
2. When a refresh token is used, it is rotated: the old token is marked revoked and a new refresh token is issued.
3. **Reuse Attack Detection**: If a client submits an already-rotated or revoked token (indicating possible token interception), the session manager:
   - Immediately revokes all active sessions for that user account.
   - Returns `401 Unauthorized`.

### 5.3 CSRF Protection
Because browsers automatically attach cookies, state-changing requests (`POST /hub/auth/refresh` and `POST /hub/auth/logout`) require a valid `x-csrf-token` header matching the token issued at login. Requests lacking this header are rejected with `403 Forbidden`.

---

## 6. Security Audit Logging

Per `docs/security/audit-policy.md`:
- Failed login attempts emit an audit record:
  - `action`: `"auth.failed"`
  - `actor`: username
  - `targetEntity`: `"session"`
  - `result`: `"failure"`
  - `reason`: `"invalid_credentials"` or `"account_disabled"`
  - `ipAddress`: Client IP
  - `correlationId`: Request correlation ID
- **Zero Credential Exposure**: Plaintext passwords, password hashes, access tokens, refresh tokens, and signing secrets are strictly excluded and redacted from all logs and audit rows.

---

## 7. Synthetic User Seed (Fake Data Only)

| User ID | Username | Role | Status | Test Password |
|---|---|---|---|---|
| `user-admin-01` | `admin` | `admin` | `active` | `Admin#Pass2026!` |
| `user-runner-01` | `runner` | `migration_runner` | `active` | `Runner#Pass2026!` |
| `user-analyst-01` | `analyst` | `analyst` | `active` | `Analyst#Pass2026!` |
| `user-editor-01` | `editor` | `editor` | `active` | `Editor#Pass2026!` |
| `user-viewer-01` | `viewer` | `viewer` | `active` | `Viewer#Pass2026!` |
| `user-disabled-01` | `disabled_user`| `viewer` | `disabled` | `Disabled#Pass2026!` |

---

## 8. Verification and Test Execution

Run the complete Hub identity security test suite:
```bash
npx vitest run apps/hub/tests/identity.test.ts
```
All tests verify positive and negative security invariants:
- Signature and algorithm verification (`EdDSA` vs `none` / `HS256`)
- Expiry and claim validation (`iss`, `aud`, `sub`, `exp`, `jti`, `kid`)
- Disabled account blocking
- Argon2id password hashing and anti-enumeration
- Key rotation and old-key overlap window expiry
- CSRF validation and refresh token reuse detection
- Audit logging without password/token leakage
