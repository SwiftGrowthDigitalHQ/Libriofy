# Auth Migration Plan

This plan is intentionally phased to avoid breaking working flows while simplifying the system.

## Phase 1: Safe Cleanup

Goal:
Identify and isolate legacy auth paths without changing the working browser login flow.

Actions:

- mark `/api/auth/login-email` and `/auth/login-email` as deprecated in code comments and internal docs
- mark `loginWithEmail()` in `src/lib/authApi.ts` as deprecated
- document that current general email/password login already uses Supabase directly
- add coverage for:
  - `useAuth.signIn()`
  - `restoreSession()`
  - super-admin route gating
  - role-based redirects
- centralize redirect resolution so `AuthPage`, `AuthRoute`, and route guards use the same helper

Expected result:

- no user-visible auth change yet
- dead and live paths are clearly separated

Risk:

- low

## Phase 2: Flow Alignment

Goal:
Make general user auth fully Supabase-native and stop treating custom session restore as a fallback for normal users.

Actions:

- remove any remaining frontend dependence on `loginWithEmail()`
- change `AuthProvider.restoreSession()` to trust Supabase session state for general users
- stop using the mirrored local custom session as the primary access-token source for the main `supabase` data client
- keep super-admin step-up logic separate from general auth state
- move phone OTP to a clearly marked legacy path or feature flag while migration is incomplete

Expected result:

- email/password, recovery, and magic-link converge on one session source
- general auth behavior becomes deterministic

Risk:

- medium

Dependencies:

- tests for session restore and redirects should exist first

## Phase 3: Server Simplification

Goal:
Collapse backend authorization to one JWT authority and convert super-admin auth to step-up MFA.

Actions:

- add one shared server auth middleware that accepts only Supabase JWTs
- remove custom general JWT verification from `requestAuth.server.ts`
- redesign super-admin flow:
  - user signs in with Supabase first
  - server starts OTP challenge only after verifying the Supabase JWT
  - server verifies OTP and records short-lived elevated access
- remove server-side password verification for super-admin primary login
- keep role checks in middleware / route authorization, not in general login endpoints

Expected result:

- the server becomes a verifier/authorizer, not a login system
- super-admin MFA remains intact without duplicating primary auth

Risk:

- medium to high

Dependencies:

- step-up storage/cookie design finalized
- super-admin route tests added

## Phase 4: Final Cleanup

Goal:
Delete the legacy auth stack after the new path is proven stable.

Actions:

- delete `resolveEmailLoginRequest()`
- delete `/api/auth/login-email` and `/auth/login-email`
- remove `loginWithEmail()` and `LoginEmailResponse`
- remove custom general refresh endpoints if no longer used
- remove custom general client-session mirror if no longer required
- delete the custom JWT branch from request auth verification
- repurpose or remove `auth_trusted_devices` for general users
- update all docs and remove stale auth diagnosis content

Expected result:

- one clean primary auth system
- smaller attack surface
- easier operational debugging

Risk:

- high if done before phases 1-3 are validated

## Recommended Validation Gates

Before Phase 2:

- browser email/password login works
- signup works
- password reset works
- route redirects are deterministic

Before Phase 3:

- all protected API routes can authenticate with Supabase JWT only
- super-admin step-up prototype works end-to-end

Before Phase 4:

- no production traffic uses `/api/auth/login-email`
- no runtime path depends on custom general JWTs
- no runtime path depends on custom general refresh cookies

## Decision That Must Be Made Explicitly

Mobile OTP login is the main strategic fork.

Pick one:

1. Deprecate it and remove it from the primary auth surface.
2. Rebuild it on Supabase phone auth.

Do not keep it as a hidden third primary auth system while simplifying the rest.
