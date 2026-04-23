# New Auth Architecture

This document defines the target authentication architecture for Libriofy.

## Single Source Of Truth

Supabase Auth is the only primary authentication system.

That means:

- all normal user sign-in uses Supabase directly in the browser
- all normal session restore uses Supabase session state only
- all normal API requests are authenticated with a Supabase JWT
- the server never performs primary email/password login
- the server never mints a second "general user" JWT

## Core Principles

1. One primary identity provider:
   Supabase Auth owns sign-in, sign-up, password reset, session refresh, and logout.

2. One browser session authority:
   the app reads auth state from `supabaseAuth`, not from a mirrored custom session cache.

3. Server verifies, server does not log in:
   backend code verifies the Supabase JWT, loads roles/profile, and authorizes requests.

4. Roles are post-auth authorization:
   roles do not decide whether a password is valid; they decide what an authenticated user may access.

5. Super admin MFA is step-up, not separate primary auth:
   a super admin first authenticates with Supabase, then completes a second factor for elevated routes.

## Target Components

### 1. Browser Auth Provider

Responsibilities:

- subscribe to `supabaseAuth.auth.onAuthStateChange(...)`
- read `supabaseAuth.auth.getSession()`
- expose `user`, `session`, `loading`, `signIn`, `signUp`, `signOut`, `requestPasswordReset`, `updatePassword`
- never call a server endpoint for normal email/password login
- never maintain a second general-purpose access-token cache

Non-responsibilities:

- no custom refresh-cookie restore
- no custom general JWT lifecycle
- no server-side password fallback

### 2. Role Resolver

Responsibilities:

- after auth succeeds, query `public.user_roles`
- derive app home route
- determine whether the current user is `super_admin`, `library_owner`, `staff`, `partner`, or `student`

Rules:

- role lookup does not block credential verification
- role lookup only influences routing and authorization

### 3. Server Auth Middleware

Responsibilities:

- read `Authorization: Bearer <supabase-access-token>`
- verify the Supabase JWT
- load `profiles` + `user_roles` for the authenticated user
- attach a normalized auth context to the request

Normalized request context:

- `userId`
- `email`
- `roles`
- `libraryIds`
- `isSuperAdmin`
- `isSuperAdminStepUpVerified`

Non-responsibilities:

- no password verification
- no general user session minting

### 4. Super Admin Step-Up Service

Responsibilities:

- start OTP challenge for an already authenticated Supabase user
- verify OTP
- record short-lived elevated-session state for the current user/device/session

Rules:

- step-up endpoints require a valid Supabase JWT first
- only users with `super_admin` role can start the flow
- password is not re-entered on the server

Suggested elevated-state shape:

- HttpOnly cookie or short-lived server-side session id
- TTL 15-30 minutes
- bound to `user_id`, device fingerprint, and current auth session

## Login Flow: Email/Password

1. User submits email + password on the client.
2. Client calls `supabaseAuth.auth.signInWithPassword({ email, password })`.
3. Supabase issues the session.
4. `AuthProvider` receives the session from `getSession()` / `onAuthStateChange()`.
5. `useUserRole()` loads roles from `public.user_roles`.
6. Routing decides the destination:
   - `super_admin` -> `/super-admin/login` for step-up
   - `partner` -> `/partner/dashboard`
   - `library_owner` / `staff` -> `/dashboard`
   - other roles -> role-specific destination or access-limited route

Important:

- password is never trimmed or mutated before authentication
- role rejection never changes the underlying auth result

## Magic Link Flow

1. User requests password reset or magic link through Supabase.
2. Supabase redirects back with session/recovery state.
3. `supabaseAuth` handles URL session detection.
4. `AuthProvider` restores the session from Supabase.
5. Role lookup and redirect logic run exactly the same as email/password login.

Important:

- magic link and password login converge immediately after Supabase session creation

## Session Handling

### General Users

- Supabase owns refresh/expiry
- browser uses native Supabase storage
- logout calls `supabaseAuth.auth.signOut(...)`
- no custom general refresh cookie
- no custom mirrored general access token store

### Super Admin Step-Up

- step-up state is separate from primary auth
- loss of step-up state does not log the user out of Supabase
- it only removes access to elevated super-admin routes

## API Request Flow With JWT

1. Browser gets current Supabase access token from `supabaseAuth`.
2. Browser sends it as `Authorization: Bearer <token>`.
3. Server middleware verifies the token and loads roles/profile.
4. Route handler authorizes based on request context.

Authorization examples:

- library routes:
  require `library_owner` or `staff`

- partner routes:
  require `partner`

- super admin routes:
  require `super_admin` + valid step-up verification

## Recommended Data / Security Boundaries

### Keep

- `public.user_roles`
- `public.profiles`
- `public.login_logs`
- super-admin OTP delivery and audit logging

### Remove From Primary Auth

- `/api/auth/login-email`
- general custom JWT minting
- general custom refresh-cookie restore
- dual-token request auth (`supabase` or `custom`)

### Convert Instead Of Delete Immediately

- `public.auth_trusted_devices`
  If device trust is still required, repurpose it for super-admin step-up tracking instead of general user sessions.

## Transitional Note On Mobile OTP

The current mobile OTP flow is not compatible with the final target architecture because it is a separate primary auth system.

There are only two clean end states:

1. Deprecate mobile OTP login as a primary sign-in method.
2. Rebuild it on top of Supabase phone auth.

Until that decision is made, mobile OTP should be treated as a legacy flow, not part of the final target architecture.

## Final Model

Primary auth:

- Supabase email/password
- Supabase magic link / recovery

Authorization:

- `user_roles` + server middleware

Elevated security:

- super-admin OTP step-up after Supabase login

Not part of the final model:

- server-side password login
- custom general JWTs
- custom general refresh cookies
- dual primary auth systems
