# Auth System Audit

This audit traces the live auth/runtime code paths as they exist in the repository on April 23, 2026.

No application code was changed during this audit.

## Current Flows

### 1. Browser Email/Password Login

- `src/pages/AuthPage.tsx:415-424`
  `handleEmailLogin()` calls `signIn(email.trim().toLowerCase(), password)`.
- `src/hooks/useAuth.tsx:356-389`
  `signIn()` uses `supabaseAuth.auth.signInWithPassword({ email, password })` directly in the browser.
- `src/hooks/useAuth.tsx:372-385`
  After Supabase accepts the password, the client queries `public.user_roles` and blocks only `super_admin`.

Current behavior:

- primary password auth is already Supabase-native for the normal login page
- role filtering is applied after login, on the client
- this flow does not call the custom `/api/auth/login-email` route

### 2. Magic Link / Recovery / Supabase Session Restore

- `src/integrations/supabase/client.ts:19-28`
  `supabaseAuth` uses persistent browser storage with `detectSessionInUrl: true`.
- `src/hooks/useAuth.tsx:169-199`
  `restoreSession()` first reads cached local auth state, then tries `supabaseAuth.auth.getSession()`, then falls back to custom session refresh.
- `src/hooks/useAuth.tsx:219-225`
  `onAuthStateChange()` applies Supabase session changes into the shared auth state.
- `src/pages/AuthPage.tsx:300-334`
  reset-password recovery waits for a Supabase session to appear via `getSession()` / `onAuthStateChange()`.

Current behavior:

- magic link / recovery is Supabase-native
- session restore is not single-source; it mixes Supabase and a custom refresh-cookie flow

### 3. Mobile OTP Login

- `src/pages/AuthPage.tsx:200-264`
  phone OTP is requested and verified from the browser.
- `src/hooks/useAuth.tsx:401-409`
  `sendOtp()` and `verifyOtp()` call custom API helpers and then store a custom session.
- `src/lib/authApi.ts:89-97`
  browser sends `/api/auth/send-otp` and `/api/auth/verify-otp`.
- `src/lib/otpAuth.server.ts:1691-1863`
  the server issues OTP challenges, verifies them, mints a custom JWT, stores a hashed refresh token in `public.auth_trusted_devices`, and returns a custom client session.

Current behavior:

- OTP auth is not Supabase Auth
- OTP auth uses a parallel custom identity/session system

### 4. Legacy Custom Email/Password Login API

- `src/lib/authApi.ts:99-102`
  `loginWithEmail()` still posts to `/api/auth/login-email`.
- `server/index.ts:386-392`
  Express still exposes `/api/auth/login-email`.
- `api/_handler.ts:211-213`
  the serverless handler still exposes `/api/auth/login-email`.
- `src/lib/otpAuth.server.ts:1866-1938`
  the server handler trims the password, signs into Supabase using an anon client, then applies additional role restrictions and returns a custom session.

Current behavior:

- this route still exists
- current `useAuth.signIn()` does not use it
- same credentials can behave differently depending on which path is called

### 5. Super Admin Login

- `src/pages/SuperAdminLoginPage.tsx:70-109`
  the browser submits email/password, then submits OTP.
- `src/hooks/useAuth.tsx:411-419`
  `startSuperAdminLogin()` and `verifySuperAdminOtp()` call custom auth API routes and store a custom session.
- `src/lib/authApi.ts:104-112`
  browser posts to `/api/auth/super-admin/login` and `/api/auth/super-admin/verify-otp`.
- `src/lib/otpAuth.server.ts:1347-1501`
  the server verifies password with `public.super_admin_verify_password(...)`, generates OTP, and records the challenge in Redis.
- `src/lib/otpAuth.server.ts:1503-1688`
  OTP verification mints a custom JWT with `sessionScope: "super_admin"` and `authLevel: 2`.

Current behavior:

- super-admin login is a separate primary auth path
- it re-verifies password on the server instead of reusing an existing Supabase login session

### 6. Shared Session / Route Guard Behavior

- `src/hooks/useAuth.tsx:135-167`
  shared auth state can represent either `provider: "supabase"` or `provider: "custom"`.
- `src/lib/authSession.ts:56-79`
  custom/local auth state is mirrored into `localStorage`.
- `src/integrations/supabase/client.ts:30-32`
  the main `supabase` data client uses `getStoredAccessToken()` from the custom auth mirror as its access token source.
- `src/components/auth/ProtectedRoute.tsx:37-155`
  route guards depend on `useAuth()`, `useUserRole()`, subscription state, and special `super_admin` session checks.
- `src/components/auth/AuthRoute.tsx:19-30`
  auth-route redirects also depend on both shared session state and `useUserRole()`.

Current behavior:

- one hook serves two incompatible session models
- role checks happen in route guards instead of one server-side boundary

### 7. API Request Authentication

- `src/lib/requestAuth.server.ts:161-175`
  API auth accepts either a Supabase JWT or a custom JWT.
- `src/lib/requestAuth.server.ts:113-129`
  Supabase token verification calls `anonClient.auth.getUser(token)`.
- `src/lib/requestAuth.server.ts:132-158`
  custom JWT verification uses the local JWT secret and then loads roles from the database.

Current behavior:

- server trust boundary is split

## Problems

- Duplicate auth systems:
  Supabase Auth and custom JWT/refresh-cookie auth both exist as first-class systems.

- Duplicate email/password logic:
  browser login uses Supabase directly, while `/api/auth/login-email` still exists and behaves differently.

- Inconsistent role enforcement:
  roles are checked in `useAuth.signIn()`, `resolveEmailLoginRequest()`, `ProtectedRoute`, `AuthRoute`, and `useUserRole()`.

- Mixed session authorities:
  `useAuth.restoreSession()` can restore from local custom cache, Supabase session storage, or custom refresh cookie.

- Custom token coupling:
  the main `supabase` data client depends on the mirrored local auth session instead of the native Supabase session store.

- Duplicate HTTP surfaces:
  auth routes are wired in Express, Vercel/serverless handlers, and API wrappers, increasing drift risk.

- Stale internal docs:
  `PASSWORD_LOGIN_FAILURE_DIAGNOSIS.md:17-20` still documents a login path that is no longer used by `useAuth.signIn()`.

## Critical Bugs

### 1. Same Credentials Can Succeed or Fail Depending on Which Email Login Path Is Hit

- Browser path:
  `src/hooks/useAuth.tsx:356-389`
- Legacy API path:
  `src/lib/otpAuth.server.ts:1894-1927`

Problem:

- browser password login allows any non-`super_admin` user with valid Supabase credentials
- legacy `/api/auth/login-email` rejects every user who is not `library_owner`, `staff`, or `super_admin` fallback-eligible

Why this is a bug:

- auth outcome depends on entrypoint, not identity
- identical credentials do not have one canonical result

### 2. The Legacy Server Password Login Mutates the Password Before Authentication

- `src/lib/otpAuth.server.ts:163`
  `trimText()` trims string values
- `src/lib/otpAuth.server.ts:1894-1895`
  email and password are both trimmed before `signInWithPassword(...)`

Problem:

- leading/trailing whitespace is preserved at signup/update in the live browser flow
- the legacy API route removes that whitespace before verification

Why this is a bug:

- the custom email login route can reject a password that Supabase itself considers valid

### 3. Session Restore Is Not Single-Source

- `src/hooks/useAuth.tsx:169-199`
  restore order is cached local session -> `supabaseAuth.getSession()` -> `refreshAuthSession()`
- `src/lib/authApi.ts:114-123`
  `refresh`, `logout`, and `logout-all` are still custom API calls
- `src/lib/authSession.ts:56-79`
  custom session state is mirrored locally

Problem:

- the app can reconstruct auth state from both Supabase session storage and a custom refresh-cookie flow

Why this is a bug:

- auth behavior becomes provider-dependent and harder to reason about
- session bugs can appear only for one provider while the UI still looks "logged in"

### 4. The Main Supabase Data Client Depends on Mirrored Local Auth State

- `src/integrations/supabase/client.ts:30-32`
  the main `supabase` client uses `getStoredAccessToken()`
- `src/hooks/useAuth.tsx:135-166`
  shared auth state is manually mirrored into local storage for both providers

Problem:

- data access does not rely directly on the native Supabase auth client/session store
- it relies on a second client-side session mirror

Why this is a bug:

- token source and identity source are decoupled from the underlying Supabase auth state
- one stale mirror can poison all normal DB queries

### 5. Server APIs Trust Two Different JWT Issuers

- `src/lib/requestAuth.server.ts:161-175`
  server accepts Supabase JWT or custom JWT
- `src/lib/requestAuth.server.ts:132-158`
  custom JWTs are locally minted and locally verified

Problem:

- APIs do not have one token authority

Why this is a bug:

- any API authorization issue now requires debugging two token systems, two minting paths, and two claim shapes

## Architecture Issues

### 1. `useAuth` Has Become an Auth Aggregator, Not an Auth Boundary

- `src/hooks/useAuth.tsx:135-199`
  manages custom session application, Supabase session application, restore sequencing, refresh timers, and idle timers

Why unstable:

- one hook is responsible for reconciling two auth providers with different lifecycle rules

### 2. Role Enforcement Is Duplicated Across Client and Server

- `src/hooks/useAuth.tsx:372-385`
- `src/lib/otpAuth.server.ts:1909-1919`
- `src/components/auth/ProtectedRoute.tsx:112-147`
- `src/hooks/useUserRole.ts:28-65`

Why unstable:

- business rules are spread across login, routing, and API layers
- changing allowed roles in one place does not update the others

### 3. Super Admin MFA Is Modeled as a Separate Primary Login System

- `src/pages/SuperAdminLoginPage.tsx:70-109`
- `src/lib/otpAuth.server.ts:1347-1688`

Why unstable:

- the server re-checks password itself instead of treating MFA as a step-up on top of a normal authenticated Supabase session

### 4. Redirect Logic Is Duplicated

- `src/pages/AuthPage.tsx:82-102`
- `src/hooks/useUserRole.ts:93-98`
- `src/components/auth/AuthRoute.tsx:26-30`

Why unstable:

- redirect destinations are derived in more than one place
- partner/super-admin routing can drift silently

### 5. Auth HTTP Routing Is Duplicated

- `server/index.ts:285-449`
- `api/_handler.ts:203-220`
- `server/vercelHandler.ts:174-195`

Why unstable:

- deprecating or changing an auth route requires editing multiple transport layers

## Bottom Line

The project does not currently have one auth system.

It has:

1. Supabase-native browser auth for normal email/password and magic-link/recovery.
2. A custom OTP/custom-JWT/custom-refresh system for phone login.
3. A dead-or-legacy custom email/password API that still exists and still behaves differently.
4. A separate super-admin password + OTP system that acts like another primary login stack.

The clean target architecture is achievable, but it requires:

- making Supabase the only primary auth provider
- removing server-side password login
- collapsing API auth to one JWT authority
- converting super-admin from "separate login system" into "step-up MFA on top of Supabase login"
- explicitly deciding whether phone OTP is deprecated or migrated to Supabase phone auth
