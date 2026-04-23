# Controlled Auth Changes

These are the exact file-by-file changes recommended after the audit.

No runtime code was changed while preparing this list.

---

File:
`src/hooks/useAuth.tsx`

Change:
Split general auth from legacy/custom session handling. Keep `signIn()`, `signUp()`, `requestPasswordReset()`, `updatePassword()`, `signOut()`, and normal restore fully Supabase-native. Remove `refreshAuthSession()` as a general restore fallback. Keep any temporary super-admin step-up state separate from the main auth provider.

Reason:
`useAuth` is currently reconciling two auth providers and two session lifecycles in one hook.

Risk:
Medium. Session restore and logout behavior will change, so route-guard and reload testing is required.

---

File:
`src/integrations/supabase/client.ts`

Change:
Stop using `getStoredAccessToken()` from `src/lib/authSession.ts` as the primary access-token source for the main `supabase` data client. Make the application rely on the native Supabase session managed by `supabaseAuth`, or centralize token retrieval through the real Supabase auth client.

Reason:
The data client is coupled to a mirrored local auth cache instead of the native Supabase session state.

Risk:
Medium. Any code path currently depending on custom JWTs for DB access will surface immediately.

---

File:
`src/lib/authSession.ts`

Change:
Shrink this file from "general auth session store" to either:
1. a temporary super-admin step-up cache only, or
2. complete removal if no custom auth state remains.

Reason:
The app should not maintain a second general-purpose auth authority in local storage.

Risk:
Medium. Existing logout, reload, and route-guard code currently assumes this mirror exists.

---

File:
`src/lib/authApi.ts`

Change:
Remove `loginWithEmail()` and its `LoginEmailResponse` dependency after migration. Keep only APIs that still belong on the server side:
- phone OTP if still intentionally supported
- super-admin step-up challenge start/verify

Reason:
The browser no longer uses `/api/auth/login-email`, and keeping it advertised invites drift.

Risk:
Low to medium. Safe once telemetry confirms no callers remain.

---

File:
`src/pages/AuthPage.tsx`

Change:
Keep email/password and password reset fully Supabase-native. Move redirect resolution to a shared helper used by `AuthPage`, `AuthRoute`, and other auth entry points. If mobile OTP remains during migration, visually label it as legacy or move it behind a feature flag/path.

Reason:
The page currently mixes stable Supabase flows with a second primary auth option and duplicates redirect logic.

Risk:
Medium. User-facing auth UI will change; OTP discoverability may change.

---

File:
`src/components/auth/ProtectedRoute.tsx`

Change:
Keep role authorization here, but make it depend on:
- Supabase-authenticated user state
- `useUserRole()`
- explicit super-admin step-up state
Do not depend on a general custom session provider.

Reason:
Protected routes should authorize, not compensate for multiple auth backends.

Risk:
Low to medium. Mostly routing behavior risk.

---

File:
`src/components/auth/AuthRoute.tsx`

Change:
Use the same shared destination resolver as the rest of the app. Preserve the special case for super-admin step-up, but only as an elevated-access gate on top of a normal Supabase session.

Reason:
Current redirect logic is duplicated and can drift by role.

Risk:
Low.

---

File:
`src/hooks/useUserRole.ts`

Change:
Keep this as the canonical post-auth role lookup hook. Add a shared role-to-home-route helper that is imported everywhere routing decisions are made. Do not let login endpoints define business-role allowlists.

Reason:
Roles belong in authorization and routing, not in primary credential verification.

Risk:
Low.

---

File:
`server/index.ts`

Change:
Remove `/auth/login-email` and `/api/auth/login-email` after migration. Keep only:
- OTP endpoints if deliberately retained
- super-admin step-up endpoints
- non-auth operational endpoints

Reason:
General email/password login must not exist on the server in the final design.

Risk:
Medium. Must confirm there are no external consumers before removal.

---

File:
`api/_handler.ts`

Change:
Remove the serverless `/api/auth/login-email` branch in lockstep with `server/index.ts`. Keep the serverless auth surface aligned with the Express surface.

Reason:
There should not be a legacy login route in one transport path after it is removed from another.

Risk:
Medium. Requires coordinated rollout with the main server.

---

File:
`server/vercelHandler.ts`

Change:
Remove the legacy login-email route handling here as part of the same deprecation. Keep auth transport parity across deployments.

Reason:
Auth route duplication across deployment targets is a drift source.

Risk:
Medium.

---

File:
`src/lib/otpAuth.server.ts`

Change:
Delete `resolveEmailLoginRequest()` once migration is complete. Keep or refactor only the flows that are truly still server-owned:
- OTP challenge flows if product-approved
- super-admin OTP step-up
Refactor super-admin login so the server no longer verifies password. Instead:
1. browser signs in with Supabase
2. browser calls super-admin challenge start with Supabase JWT
3. server verifies role from JWT/user lookup
4. server sends and verifies OTP
5. server records short-lived elevated access

Reason:
This file currently acts as a second auth platform. The final architecture needs it to act only as a step-up/MFA service.

Risk:
High. This is the most security-sensitive part of the migration.

---

File:
`src/lib/requestAuth.server.ts`

Change:
Remove support for locally minted custom general JWTs after migration. Accept only Supabase JWTs for normal authenticated API requests. If super-admin step-up needs additional proof, treat it as a second server-side verification layer, not a second primary JWT issuer.

Reason:
One server trust boundary requires one primary JWT authority.

Risk:
High if any API still depends on custom tokens when this change lands.

---

File:
`supabase/migrations/20260404130000_mobile_first_auth_trusted_devices.sql`

Change:
Do not delete immediately. First decide whether `auth_trusted_devices` will be:
1. repurposed for super-admin step-up/session binding only, or
2. removed after all custom general auth is gone.

Reason:
The table is useful security infrastructure, but it should not continue to back a duplicate general auth platform by accident.

Risk:
Medium.

---

File:
`supabase/migrations/20260407121500_super_admin_auth_hardening.sql`

Change:
Deprecate `public.super_admin_verify_password(...)` after the new step-up flow is in place. Keep `login_logs` and super-admin auditability.

Reason:
Server-side password verification is no longer needed once Supabase owns primary auth.

Risk:
Medium to high. Must only happen after the new super-admin path is live.

---

File:
`src/test/*` and new auth-focused tests

Change:
Add tests for:
- general email/password login success path
- general login redirect by role
- session restore from Supabase only
- super-admin step-up gating
- logout behavior
- no password trimming before auth

Reason:
Current auth coverage is far too small for a migration of this size.

Risk:
Low. This reduces risk rather than adding it.
