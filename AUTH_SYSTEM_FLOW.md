# AUTH_SYSTEM_FLOW

## Scope
This document audits how authentication and login currently work in the repo as of this session.

It covers:
- frontend login entrypoints
- custom auth API flow
- Vercel function flow
- Render/Express flow
- Supabase's role in the system
- session creation, storage, refresh, and logout
- endpoint-by-endpoint traces for `/auth`, `/api/auth/login-email`, `/api/auth/send-otp`, `/api/settings`, and `/api/health`
- likely production breakpoints

It does not change application code.

## Executive Summary
Libriofy uses a hybrid auth model:

- User signup, password reset, and password update use Supabase Auth directly.
- Day-to-day login does not primarily use a persistent Supabase Auth session.
- Mobile OTP login and normal email/password login both end by creating a custom session in server code.
- That custom session consists of:
  - a short-lived custom JWT access token returned in JSON
  - a long-lived `HttpOnly` refresh cookie named `libriofy_refresh`
  - a row in `public.auth_trusted_devices`
- The frontend stores the returned session object in browser `sessionStorage`.
- The frontend uses the custom access token when talking to Supabase data APIs by injecting it into the Supabase JS client.

The auth model is therefore not "Supabase Auth only." It is:

- Supabase Auth for credential verification in some places
- Supabase database tables and RPCs for identity/roles
- custom JWT minting for the main authenticated app session
- refresh-cookie rotation handled by app-owned auth endpoints

The biggest current production risk is request routing and deployment of the Vercel auth/settings/health functions. If those functions are missing or not built correctly, the login UI loads but `/api/auth/*`, `/api/settings`, and `/api/health*` fail.

## System Architecture

### Main Actors
- Frontend SPA:
  - route shell and forms
  - session restore and refresh timer
  - role-based redirects
- Auth API layer:
  - `/api/auth/*`
  - `/api/settings`
  - `/api/health*`
- Runtime hosts:
  - Vite dev server in local development
  - Express server on Render or similar Node host
  - Vercel serverless functions in production if deployed there
- Supabase:
  - Auth for signup/reset/update and email/password verification
  - Postgres tables for profiles, roles, trusted devices, login logs, platform settings
  - RPC for super-admin password verification
- Redis:
  - OTP records
  - cooldowns
  - rate limits
  - super-admin challenge state
  - WhatsApp fallback queue bookkeeping
- Twilio / Resend:
  - OTP delivery

### Session Model
There are two possible session providers in the frontend:

- `provider: "custom"`
  - produced by app auth endpoints
  - used for mobile OTP login
  - used for standard email/password admin login
  - used for super-admin after MFA
- `provider: "supabase"`
  - produced by Supabase Auth
  - used for signup follow-through, password reset, and password update
  - also used if `supabaseAuth.auth.getSession()` returns a session during restore

This is important: the frontend auth provider supports both session types at the same time.

### Database/Auth Data Model
Important tables and DB objects:

- `auth.users`
  - Supabase Auth user accounts
- `public.profiles`
  - app profile record keyed by `user_id`
- `public.user_roles`
  - role mapping like `super_admin`, `library_owner`, `staff`, `partner`
- `public.auth_trusted_devices`
  - refresh-session backing store for custom auth
- `public.login_logs`
  - super-admin login attempt logging
- `public.platform_settings`
  - maintenance mode flag for `/api/settings`
- `public.super_admin_verify_password(candidate_email, candidate_password)`
  - `SECURITY DEFINER` RPC used for super-admin password verification

### Auth Roles and Responsibility Split

#### Supabase role
Supabase has multiple roles in this system:

- Credential verification for standard email login:
  - app server calls `anonClient.auth.signInWithPassword`
- Account lifecycle:
  - signup
  - reset password email
  - update password
- Data source for:
  - `profiles`
  - `user_roles`
  - `platform_settings`
  - `auth_trusted_devices`
  - `login_logs`
- Token validation fallback in `requestAuth.server.ts`:
  - bearer token can be treated as either a Supabase token or a custom token

Supabase is not the main long-lived web session manager after app login. The app replaces that with its own refresh-cookie + custom JWT model.

#### Vercel API role
On Vercel, `/api/*` endpoints are serverless functions. They are responsible for:

- handling auth POSTs
- setting/clearing the refresh cookie
- minting custom access tokens
- refreshing sessions from `auth_trusted_devices`
- exposing `/api/settings`
- exposing `/api/health*`

If Vercel functions are not built or deployed correctly, auth can fail even when the frontend app loads.

## Full Login Architecture Flow

### 1. Email/Password Login Flow

#### Intended flow
1. User opens `/auth`.
2. Frontend email form calls `useAuth().signIn(email, password)`.
3. `useAuth` calls `loginWithEmail()` from `src/lib/authApi.ts`.
4. `authApi.ts` sends `POST /api/auth/login-email` with:
   - JSON body
   - `x-device-fingerprint`
   - `x-device-label`
   - `credentials: include`
5. Runtime resolves `/api/auth/login-email`:
   - Vite dev middleware in `vite.config.ts`
   - Express route in `server/index.ts`
   - Vercel function route in `api/auth/[...route].ts` or `server/vercelHandler.ts`
6. Server calls `resolveEmailLoginRequest()` in `src/lib/otpAuth.server.ts`.
7. Server uses Supabase anon client `auth.signInWithPassword()` to verify the email/password.
8. Server loads profile and roles from `profiles` and `user_roles`.
9. If the user is not super admin and has an allowed admin role, server creates:
   - custom JWT access token
   - `auth_trusted_devices` row
   - refresh cookie `libriofy_refresh`
10. Response returns `{ session }` JSON and sets `Set-Cookie`.
11. Frontend clears any local Supabase session, stores the custom session in browser storage, and uses it as the current app session.
12. Frontend redirects based on roles:
   - super admin -> super admin dashboard
   - partner -> partner dashboard
   - otherwise -> `/dashboard`

#### How it currently works
This flow is implemented and active.

Key nuance:
- email/password verification uses Supabase Auth
- the lasting session is still custom auth, not the Supabase session returned by `signInWithPassword`

#### Env vars used
- `SUPABASE_URL` or `VITE_SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` or `VITE_SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` or `JWT_SECRET` or `APP_JWT_SECRET`
- `PUBLIC_APP_URL` or `APP_URL` or `SITE_URL` or `VITE_PUBLIC_APP_URL` or `VITE_APP_URL`
- optional `REDIS_URL` for rate limiting only
- optional `VITE_AUTH_API_BASE` on frontend

#### Failures
- `/api/auth/login-email` route missing or not deployed
- `VITE_AUTH_API_BASE` points to wrong host
- Supabase anon credentials missing
- Supabase service role missing
- JWT secret missing
- user exists in `auth.users` but missing `profiles` or `user_roles`
- user has `super_admin` role and is blocked from normal email login on purpose
- user lacks one of the allowed "admin fallback" roles and is rejected

### 2. Mobile OTP Login Flow

#### Intended flow
1. User opens `/auth`.
2. Frontend phone form calls `useAuth().sendOtp(phone)`.
3. `authApi.ts` sends `POST /api/auth/send-otp`.
4. Server calls `resolveSendOtpRequest()`.
5. Server:
   - rate limits by IP in Redis
   - normalizes phone number
   - checks cooldown and temporary block in Redis
   - looks up user by phone in `profiles`
   - generates 6-digit OTP
   - stores hashed OTP in Redis
   - sends OTP via Twilio WhatsApp first, then SMS fallback
6. Frontend collects the OTP.
7. Frontend calls `useAuth().verifyOtp(phone, otp)`.
8. `authApi.ts` sends `POST /api/auth/verify-otp`.
9. Server calls `resolveVerifyOtpRequest()`.
10. Server:
    - rate limits by IP
    - validates Redis OTP record
    - compares hashed OTP
    - loads profile and roles from Supabase
    - creates custom access token + refresh cookie + trusted-device row
11. Frontend stores the custom session and redirects.

#### How it currently works
This is the primary "mobile-first" login path.

Important nuance:
- OTP login does not use Supabase Auth sign-in
- it uses app-controlled OTP state in Redis
- it still depends on Supabase for user lookup and roles

#### Env vars used
- `REDIS_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`
- `TWILIO_SMS_FROM`
- `AUTH_DEFAULT_COUNTRY_CODE`
- `SUPABASE_URL` or `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `VITE_SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` or `JWT_SECRET` or `APP_JWT_SECRET`
- `PUBLIC_APP_URL` or `APP_URL` or `SITE_URL` or `VITE_PUBLIC_APP_URL` or `VITE_APP_URL`
- optional `VITE_AUTH_API_BASE`

#### Failures
- `/api/auth/send-otp` or `/api/auth/verify-otp` missing
- Redis missing
- Twilio credentials missing
- no account exists for the phone number
- OTP expired
- OTP attempts exceeded
- device fingerprint mismatch on refresh
- service role or JWT secret missing

### 3. Supabase Role In Auth
Supabase participates in four different ways:

- `supabaseAuth` client:
  - signup
  - password reset email
  - password update
  - local session listener
- `supabase` client with injected `accessToken`:
  - role lookups
  - app data access after login
- server-side service-role client:
  - load profile and roles
  - trusted-device inserts/updates/revokes
  - login log inserts
  - super-admin password RPC
- server-side anon client:
  - verify standard email/password login

### 4. Vercel API Role
Vercel serverless functions own the production `/api/*` behavior when deployed on Vercel:

- `api/auth/[...route].ts`
- `api/health/[...route].ts`
- `api/[...route].ts`
- `api/attendance/[...route].ts`
- `api/ai/[...route].ts`
- shared handler: `server/vercelHandler.ts`

For the auth flow in this document, the most important Vercel responsibilities are:
- parse request body
- read cookies and device headers
- set `Set-Cookie`
- call `otpAuth.server.ts` resolvers
- expose settings and health endpoints

### 5. Frontend -> API -> Backend -> Session Flow
Common pattern for custom-auth login:

1. SPA form in `src/pages/AuthPage.tsx` or `src/pages/SuperAdminLoginPage.tsx`
2. `src/hooks/useAuth.tsx`
3. `src/lib/authApi.ts`
4. Fetch to `/api/auth/*`
5. Runtime-specific route:
   - Vite middleware
   - Express route
   - Vercel function
6. `src/lib/otpAuth.server.ts`
7. Supabase/Redis/Twilio/Resend
8. Response:
   - JSON session
   - `Set-Cookie: libriofy_refresh=...`
9. Frontend stores session in `sessionStorage`
10. Frontend app uses custom access token for Supabase queries
11. `useAuth` refresh timer later calls `/api/auth/refresh`

## File Map: Everything Involved In Auth

### Frontend files
- `src/App.tsx`
  - mounts `/auth`, `/login`, `/super-admin-login`
  - wraps routes in `AuthProvider`, `AuthRoute`, `ProtectedRoute`, `MaintenanceGate`
- `src/pages/AuthPage.tsx`
  - phone OTP login
  - email login
  - signup
  - password reset request
  - password update
- `src/pages/SuperAdminLoginPage.tsx`
  - password step
  - second-factor OTP step
- `src/hooks/useAuth.tsx`
  - central auth state
  - restore session
  - refresh timer
  - idle timeout
  - signIn/sendOtp/verifyOtp/signOut/logoutAll
- `src/hooks/useUserRole.ts`
  - loads `user_roles`
  - signs out on Supabase unauthorized errors
- `src/hooks/useCurrentLibraryId.ts`
  - derives active library after auth
- `src/components/auth/AuthRoute.tsx`
  - prevents signed-in users from seeing public auth pages
- `src/components/auth/ProtectedRoute.tsx`
  - protects authenticated routes
  - enforces role gates
  - enforces super-admin verified session
- `src/lib/authApi.ts`
  - fetch wrapper around `/api/auth/*`
- `src/lib/authSession.ts`
  - stores custom session in browser `sessionStorage`
- `src/lib/auth.shared.ts`
  - shared types and constants
- `src/lib/authErrors.ts`
  - user-facing auth error normalization
- `src/integrations/supabase/client.ts`
  - Supabase clients
  - injects custom access token into app data client
- `src/lib/deviceFingerprint.ts`
  - builds `x-device-fingerprint`
- `src/lib/browserStorage.ts`
  - safe local/session storage wrapper
- `src/components/maintenance/MaintenanceGate.tsx`
  - can block the app before login routes render normally
- `src/hooks/useMaintenanceMode.ts`
  - polls `/api/settings`
- `src/lib/maintenanceClient.ts`
  - `/api/settings` fetch logic
- `src/lib/superAdminPaths.ts`
  - super-admin route detection and redirect sanitization
- `public/service-worker.js`
  - precaches `/auth` shell

### API routes
- `api/auth/[...route].ts`
  - Vercel auth route
- `api/health/[...route].ts`
  - Vercel health route
- `api/[...route].ts`
  - Vercel `/api/settings`
- `api/_handler.ts`
  - older auth/settings/health handler variant still present

### Vercel handlers
- `server/vercelHandler.ts`
  - shared catch-all Vercel runtime handler for auth/settings/health plus other APIs

### Server files
- `server/index.ts`
  - Express server implementation of `/auth/*`, `/api/auth/*`, `/api/settings`, `/health*`
- `src/lib/otpAuth.server.ts`
  - main auth engine
- `src/lib/requestAuth.server.ts`
  - resolves bearer token as Supabase or custom token
- `src/lib/httpRequest.server.ts`
  - request parsing and header extraction
- `src/lib/maintenance.server.ts`
  - `/api/settings` backend logic

### Middleware
There is no standalone production middleware file like `middleware.ts`.

Equivalent behavior is spread across:
- frontend route guards:
  - `src/components/auth/AuthRoute.tsx`
  - `src/components/auth/ProtectedRoute.tsx`
- dev-only Vite middleware/plugins:
  - auth plugin in `vite.config.ts`
  - maintenance settings plugin in `vite.config.ts`
  - super-admin page guard plugin in `vite.config.ts`
- Express request middleware in `server/index.ts`
  - request IDs
  - JSON parsing
  - CORS
  - HTML super-admin page redirects

### Env vars

#### Frontend auth-relevant env vars
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_AUTH_API_BASE`
- `VITE_PUBLIC_APP_URL`
- `VITE_APP_URL`
- `VITE_USE_HASH_ROUTER`
- `VITE_BASE_PATH`
- `VITE_MAINTENANCE_MODE`

#### Backend auth-relevant env vars
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET`
- `JWT_SECRET`
- `APP_JWT_SECRET`
- `PUBLIC_APP_URL`
- `APP_URL`
- `SITE_URL`
- `APP_ENV`
- `RELEASE_SHA`
- `SENTRY_RELEASE`
- `AUTH_DEFAULT_COUNTRY_CODE`
- `REDIS_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_FROM`
- `TWILIO_WHATSAPP_FROM`
- `RESEND_API_KEY`
- `AUTH_EMAIL_FROM`
- `RESEND_FROM_EMAIL`
- `SUPER_ADMIN_ALLOWED_EMAILS`
- `SUPER_ADMIN_EMAIL_ALLOWLIST`
- `MAINTENANCE_MODE`

### Vercel rewrites
`vercel.json` rewrites friendly auth and health URLs to serverless `/api/*` routes:

- `/auth/send-otp` -> `/api/auth/send-otp`
- `/auth/verify-otp` -> `/api/auth/verify-otp`
- `/auth/login-email` -> `/api/auth/login-email`
- `/auth/super-admin/login` -> `/api/auth/super-admin/login`
- `/auth/super-admin/verify-otp` -> `/api/auth/super-admin/verify-otp`
- `/auth/refresh` -> `/api/auth/refresh`
- `/auth/logout` -> `/api/auth/logout`
- `/auth/logout-all` -> `/api/auth/logout-all`
- `/auth/twilio-status` -> `/api/auth/twilio-status`
- `/health` -> `/api/health`
- `/health/live` -> `/api/health/live`
- `/health/ready` -> `/api/health/ready`
- `/health/ops` -> `/api/health/ops`

### Shared imports and shared modules
These modules connect multiple runtimes:

- `src/lib/otpAuth.server.ts`
  - shared by Vite dev middleware, Express server, and Vercel functions
- `src/lib/maintenance.server.ts`
  - shared by Vite dev middleware, Express server, and Vercel functions
- `src/lib/httpRequest.server.ts`
  - shared request parsing helpers
- `src/lib/requestAuth.server.ts`
  - shared auth token resolver
- `src/lib/auth.shared.ts`
  - shared frontend/server auth types and constants

### Database / migration files directly affecting auth
- `supabase/migrations/20260404130000_mobile_first_auth_trusted_devices.sql`
- `supabase/migrations/20260407121500_super_admin_auth_hardening.sql`
- `supabase/migrations/20260401000000_maintenance_mode.sql`
- earlier profile/role migrations creating:
  - `public.profiles`
  - `public.user_roles`

## Step-by-Step Traces

## Endpoint Trace: `/auth`

### What `/auth` is
`/auth` is a frontend SPA route, not a backend auth endpoint.

### Request starts where
- Browser navigation to `/auth`
- route defined in `src/App.tsx`

### Which function/file handles it
1. `src/App.tsx`
   - route `/auth`
   - wraps page in `<AuthRoute>`
2. `src/components/auth/AuthRoute.tsx`
   - if user is already logged in, redirects away
   - if not logged in, renders child
3. `src/pages/AuthPage.tsx`
   - shows phone OTP or email login form

### What runs next
- if user chooses phone login:
  - `handleSendOtp()`
  - `useAuth().sendOtp()`
  - `src/lib/authApi.ts` -> `/api/auth/send-otp`
- if user chooses email login:
  - `handleEmailLogin()`
  - `useAuth().signIn()`
  - `src/lib/authApi.ts` -> `/api/auth/login-email`
- if user requests reset:
  - `useAuth().requestPasswordReset()`
  - Supabase Auth direct call

### Env vars depended on
- `VITE_USE_HASH_ROUTER`
- `VITE_BASE_PATH`
- `VITE_AUTH_API_BASE`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUBLIC_APP_URL` / `VITE_APP_URL`
- `VITE_MAINTENANCE_MODE`

### Failure points
- `MaintenanceGate` blocks app if maintenance mode resolves true
- `AuthRoute` immediately redirects if session exists
- frontend may load but backend auth endpoints may fail
- wrong `VITE_AUTH_API_BASE` sends requests to wrong origin
- Supabase client init throws if `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` missing

## Endpoint Trace: `/api/auth/login-email`

### Request starts where
- `src/pages/AuthPage.tsx` -> `handleEmailLogin()`
- `src/hooks/useAuth.tsx` -> `signIn()`
- `src/lib/authApi.ts` -> `loginWithEmail()`

### Handler chain
Possible runtime paths:

#### Dev
- `vite.config.ts` auth plugin
- `resolveEmailLoginRequest()`

#### Express / Render
- `server/index.ts` `app.post("/api/auth/login-email", ...)`
- `resolveEmailLoginRequest()`

#### Vercel
- `api/auth/[...route].ts`
- or `server/vercelHandler.ts`
- `resolveEmailLoginRequest()`

### Server logic
`resolveEmailLoginRequest()`:
- optional Redis IP rate limit
- validate body
- call Supabase anon `auth.signInWithPassword`
- load profile and roles with service role
- reject super admins from this path
- reject non-admin roles from this path
- create custom access token
- insert `auth_trusted_devices` row
- set refresh cookie

### Next file that runs
- response returns to `src/hooks/useAuth.tsx`
- `signIn()` clears local Supabase session and stores custom session
- `src/pages/AuthPage.tsx` calls `finishLogin()`
- `finishLogin()` queries roles again through the Supabase client and redirects

### Env vars depended on
- `SUPABASE_URL` or `VITE_SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` or `VITE_SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` or `JWT_SECRET` or `APP_JWT_SECRET`
- `PUBLIC_APP_URL` or similar
- optional `REDIS_URL`
- frontend `VITE_AUTH_API_BASE`

### Failure points
- endpoint missing
- Supabase anon sign-in fails
- service-role profile/role lookup fails
- user is super admin and must use super-admin page
- user has no allowed admin role
- refresh cookie not stored by browser
- custom JWT accepted by frontend but rejected later by Supabase data requests

## Endpoint Trace: `/api/auth/send-otp`

### Request starts where
- `src/pages/AuthPage.tsx` -> `handleSendOtp()`
- `src/hooks/useAuth.tsx` -> `sendOtp()`
- `src/lib/authApi.ts` -> `sendOtp()`

### Handler chain
Possible runtime paths:

#### Dev
- Vite auth plugin

#### Express / Render
- `server/index.ts`

#### Vercel
- `api/auth/[...route].ts`
- or `server/vercelHandler.ts`

All three call:
- `resolveSendOtpRequest()`

### Server logic
`resolveSendOtpRequest()`:
- starts OTP worker when not serverless
- rate limits by IP in Redis
- normalizes phone
- checks cooldown and temporary block in Redis
- looks up user by phone in `profiles`
- generates OTP
- hashes OTP
- sends via Twilio
  - WhatsApp first if configured
  - SMS fallback if needed
- stores OTP record in Redis

### Next file that runs
- response goes back to `AuthPage`
- page shows OTP input
- next call is `/api/auth/verify-otp`

### Env vars depended on
- `REDIS_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`
- `TWILIO_SMS_FROM`
- `AUTH_DEFAULT_COUNTRY_CODE`
- `PUBLIC_APP_URL` / `APP_URL` / `SITE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- frontend `VITE_AUTH_API_BASE`

### Failure points
- endpoint missing
- Redis missing
- Twilio missing
- invalid phone format
- phone not found in `profiles`
- cooldown active
- temporary phone block active
- callback URL points wrong host

## Endpoint Trace: `/api/settings`

### Request starts where
- app boot through `MaintenanceGate`
- `useMaintenanceMode()`
- `loadMaintenanceStatus()`
- `fetch("/api/settings")`

### Handler chain
Possible runtime paths:

#### Dev
- `vite.config.ts` maintenance settings plugin

#### Express / Render
- `server/index.ts` `app.get("/api/settings")`

#### Vercel
- `api/[...route].ts`
- or `server/vercelHandler.ts`

All resolve through:
- `src/lib/maintenance.server.ts`

### Server logic
`resolveMaintenanceStatus()`:
- if `MAINTENANCE_MODE` env is set, use it
- else query `platform_settings` from Supabase REST
- else fallback to `false`

### Next file that runs
- `src/lib/maintenanceClient.ts`
- `src/hooks/useMaintenanceMode.ts`
- `src/components/maintenance/MaintenanceGate.tsx`

### Env vars depended on
- `MAINTENANCE_MODE` or `VITE_MAINTENANCE_MODE`
- `SUPABASE_URL` or `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`

### Failure points
- endpoint missing
- bad response shape
- Vercel function missing
- Supabase URL/key missing
- frontend receives HTML instead of JSON in dev/proxy misrouting scenarios

### Why `/api/settings` matters for auth
It does not authenticate the user directly, but it can stop the app before login routing completes by forcing maintenance mode.

## Endpoint Trace: `/api/health`

### Request starts where
- ops probes
- load balancer / monitoring
- manual checks

### Handler chain
Possible runtime paths:

#### Express
- `server/index.ts` `/health`

#### Vercel
- `api/health/[...route].ts`
- or `server/vercelHandler.ts` `/api/health`

On Vercel, friendly `/health` is rewritten to `/api/health`.

### Server logic
- return status payload
- for readiness/ops variants include maintenance status

### Env vars depended on
- `APP_ENV`
- `NODE_ENV`
- `SENTRY_RELEASE`
- `RELEASE_SHA`
- maintenance-related vars for `/ready` and `/ops`

### Failure points
- function missing
- rewrite missing
- deployment succeeded for frontend only but not serverless functions

## Per-Step Operational Detail

### Email/password login
1. Request starts:
   - `src/pages/AuthPage.tsx`
2. Handler:
   - `handleEmailLogin()`
3. Next:
   - `useAuth.signIn()`
4. Next:
   - `authApi.loginWithEmail()`
5. Next:
   - `POST /api/auth/login-email`
6. Next:
   - runtime route
7. Next:
   - `resolveEmailLoginRequest()`
8. Next:
   - Supabase anon `signInWithPassword()`
9. Next:
   - service-role profile/role fetch
10. Next:
   - custom JWT + refresh cookie + trusted-device insert
11. Next:
   - browser stores custom session
12. Next:
   - role-based redirect

### Mobile OTP login
1. Request starts:
   - `src/pages/AuthPage.tsx`
2. Handler:
   - `handleSendOtp()`
3. Next:
   - `useAuth.sendOtp()`
4. Next:
   - `authApi.sendOtp()`
5. Next:
   - `POST /api/auth/send-otp`
6. Next:
   - `resolveSendOtpRequest()`
7. Next:
   - Redis + Supabase + Twilio
8. Next:
   - user enters OTP
9. Next:
   - `handleVerifyOtp()`
10. Next:
    - `useAuth.verifyOtp()`
11. Next:
    - `POST /api/auth/verify-otp`
12. Next:
    - `resolveVerifyOtpRequest()`
13. Next:
    - custom JWT + refresh cookie + trusted-device row
14. Next:
    - browser stores custom session
15. Next:
    - role-based redirect

### Session refresh
1. Request starts:
   - `useAuth.restoreSession()`
   - or refresh timer in `useAuth`
2. Handler:
   - `authApi.refreshAuthSession()`
3. Next:
   - `POST /api/auth/refresh`
4. Next:
   - `resolveRefreshSessionRequest()`
5. Next:
   - read refresh cookie
   - validate trusted-device row
   - rotate refresh token
   - mint new custom JWT
6. Next:
   - browser updates stored custom session

### Logout current device
1. Request starts:
   - `useAuth.signOut()`
2. Next:
   - `POST /api/auth/logout`
3. Next:
   - `resolveLogoutRequest()`
4. Next:
   - revoke refresh token row
   - clear cookie

### Logout all devices
1. Request starts:
   - `useAuth.logoutAllDevices()`
2. Next:
   - access token optionally attached
3. Next:
   - `POST /api/auth/logout-all`
4. Next:
   - `resolveLogoutAllRequest()`
5. Next:
   - bearer token resolved by `requestAuth.server.ts`
   - all `auth_trusted_devices` rows for user revoked
   - cookie cleared

## How Login Is Supposed To Work
- Public user opens `/auth`
- User chooses phone OTP or email/password
- API validates identity
- API creates a custom session
- Browser stores returned session metadata
- Browser keeps refresh token only in `HttpOnly` cookie
- Role lookup via Supabase determines dashboard redirect
- Background refresh renews access token before expiry
- Super admins must use the dedicated two-step login page

## How It Currently Works
- The above design is implemented
- But the system is hybrid, not purely custom and not purely Supabase:
  - signup/reset/update use Supabase Auth
  - standard login and OTP use custom session issuance
  - restore path prefers an existing Supabase session if one exists
  - otherwise it falls back to app refresh-cookie restoration
- `useAuth` explicitly signs out local Supabase auth after custom login success to avoid two active providers
- route protection depends on both:
  - current session existing
  - `user_roles` lookup succeeding

## Where Production May Be Breaking

### 1. Vercel auth functions may not exist at runtime
If Vercel deploys only the frontend assets and not `/api` functions, then:
- `/api/auth/login-email` fails
- `/api/auth/send-otp` fails
- `/api/settings` fails
- `/api/health` fails

This matches the deployment issue already validated in this repo:
- `npm run build` produces `dist/`
- `vercel deploy --prebuilt` expects `.vercel/output`
- without `.vercel/output`, serverless functions can be absent or broken

### 2. Vercel runtime env vars may be incomplete
Custom auth depends on more than frontend env vars. Missing any of these can partially break login:
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET`
- `REDIS_URL`
- Twilio vars
- Resend vars
- `PUBLIC_APP_URL` / `APP_URL`

Partial break pattern:
- frontend loads
- auth page renders
- login POST returns 500/401/503

### 3. `VITE_AUTH_API_BASE` may point at the wrong host
If frontend API base points to another domain:
- requests may go to a backend that sets cookies on a different host
- refresh cookie may not come back to the SPA origin
- login can appear to succeed once, then session restore fails

### 4. Redis availability is a hard dependency for OTP flows
OTP send/verify and super-admin challenge flow rely on Redis.

If Redis is missing or unreachable:
- OTP send breaks
- OTP verify breaks
- super-admin login breaks

Email/password login is more tolerant because it catches Redis rate-limit failure and continues.

### 5. Hybrid session precedence can create hard-to-debug state
`useAuth.restoreSession()`:
- first checks stored custom session
- then checks Supabase Auth session
- then tries custom `/refresh`

This can create confusing edge cases if:
- a stale Supabase session exists
- a custom session exists in storage
- refresh cookie is missing
- user roles query rejects the token

### 6. Custom JWT compatibility is critical after login
The main `supabase` client uses `getStoredAccessToken()` from the custom session.

That means:
- the custom JWT must be accepted by Supabase/PostgREST
- claims like `aud`, `role`, and `sub` must be valid
- `SUPABASE_JWT_SECRET` must match what Supabase expects

If not:
- login API may succeed
- but subsequent `user_roles` query fails with auth/jwt errors
- `useUserRole()` signs the user out

### 7. Role data inconsistencies can look like auth failure
A user may authenticate but still be unable to use the app if:
- `profiles` row missing
- `user_roles` row missing
- super-admin lost the `super_admin` role
- email login account has no allowed admin fallback role

## Potential Root Causes Ranked by Probability

### 1. Vercel deployment is shipping frontend assets without working `/api` functions
Why high probability:
- already validated in this repo's deployment pipeline
- directly affects every auth/settings/health endpoint discussed here
- produces exactly the class of "frontend loads, auth fails" symptom

### 2. Missing Vercel runtime env vars for custom auth
Why high probability:
- custom auth depends on more backend-only secrets than the frontend build
- Vercel needs service-role, JWT, Redis, and delivery envs at runtime
- email login, OTP, refresh, and logout can each fail differently

### 3. `VITE_AUTH_API_BASE` is pointing to a separate host and breaking cookie/session continuity
Why high probability:
- the repo explicitly supports same-origin and separate auth host modes
- refresh cookie behavior becomes domain-sensitive immediately
- can cause login to succeed once but not persist

### 4. Redis is not available from the production auth runtime
Why medium-high probability:
- OTP flow and super-admin login cannot function without Redis
- unlike email login, these paths do not gracefully continue without it

### 5. Supabase JWT secret mismatch or custom JWT incompatibility with data queries
Why medium probability:
- custom sessions rely on custom JWTs for later Supabase data access
- `useUserRole()` will sign out on auth/jwt failures

### 6. Supabase schema/data mismatch in `profiles`, `user_roles`, or auth-related migrations
Why medium probability:
- login may succeed but redirect/authorization fails
- especially visible in `ProtectedRoute` and `useUserRole`

### 7. Twilio or Resend misconfiguration
Why medium probability:
- affects OTP delivery, not route availability
- would break send-OTP and super-admin challenge delivery

### 8. Hybrid custom/Supabase session coexistence causing inconsistent restore behavior
Why medium-low probability:
- real complexity exists
- but the code explicitly tries to neutralize it by signing out local Supabase after custom login

### 9. Maintenance/settings path malfunction indirectly blocking the app
Why low-medium probability:
- affects boot flow and perceived availability
- but usually would not explain login endpoint failure by itself

## Important Observations

### Custom auth is the real primary app session
Even standard email/password login ends as custom auth, not a pure Supabase session.

### Super-admin login is intentionally separate
Super admins:
- cannot use normal email login
- must pass password verification first
- then OTP second factor
- receive a `super_admin` scoped custom session with `authLevel = 2`

### Only super-admin login attempts are explicitly logged
`login_logs` are written in the super-admin flow. Standard OTP and standard email login do not appear to use the same login-log mechanism.

### OTP fallback worker does not run in serverless
`ensureOtpAuthWorkerStarted()` exits early on Vercel/AWS Lambda style envs.

That means:
- delayed WhatsApp -> SMS fallback worker behavior is not active in serverless runtime
- initial send still works
- queued fallback behavior is mainly for non-serverless Node runtime

## Recommended Reading Order
If you want to inspect the code manually in the fastest order:

1. `src/pages/AuthPage.tsx`
2. `src/hooks/useAuth.tsx`
3. `src/lib/authApi.ts`
4. `src/lib/otpAuth.server.ts`
5. `src/integrations/supabase/client.ts`
6. `src/hooks/useUserRole.ts`
7. `server/vercelHandler.ts`
8. `server/index.ts`
9. `vercel.json`
10. the three auth-related Supabase migrations listed above

## Bottom Line
This auth system is not a simple Supabase Auth login flow.

It is a custom app-auth system layered on top of Supabase:
- Supabase verifies some credentials and stores app identity/roles
- app code owns session minting
- refresh state lives in `auth_trusted_devices`
- frontend uses the returned custom access token for later Supabase queries

Because of that design, production can break in three different places:
- routing to auth functions
- runtime secrets for custom auth
- token/session continuity after login

Right now, the single most suspicious break remains deployment of Vercel `/api` functions, followed by missing backend env vars and any cross-origin `VITE_AUTH_API_BASE` misconfiguration.
