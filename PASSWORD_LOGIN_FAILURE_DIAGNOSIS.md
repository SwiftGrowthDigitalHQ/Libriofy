# Password Login Failure Diagnosis

## Scope

This audit covers only the email + password login path.

No code was changed.

## Exact Password Login Path

Frontend:

1. `src/pages/AuthPage.tsx:415`
   `handleEmailLogin()` submits the email login form.
2. `src/pages/AuthPage.tsx:419`
   Calls `signIn(email.trim().toLowerCase(), password)`.
3. `src/hooks/useAuth.tsx:357`
   `signIn()` calls `loginWithEmail(email, password)`.
4. `src/lib/authApi.ts:99`
   `loginWithEmail()` sends `POST /api/auth/login-email`.

Server:

5. `server/index.ts:386`
   `/api/auth/login-email` routes to `resolveEmailLoginRequest(...)`.
6. `src/lib/otpAuth.server.ts:1866`
   `resolveEmailLoginRequest()` handles the password login.
7. `src/lib/otpAuth.server.ts:1901`
   Calls Supabase anon auth: `anonClient.auth.signInWithPassword({ email, password })`.
8. `src/lib/otpAuth.server.ts:1909-1919`
   After Supabase accepts the password, the server applies extra role checks before issuing the app session.

## What `signInWithPassword` Looks Like Here

There is no custom wrapper around Supabase password auth beyond this server handler. The local implementation is effectively:

- normalize email with `.trim().toLowerCase()`
- normalize password with `trimText(body.password)`
- call `anonClient.auth.signInWithPassword({ email, password })`
- if successful, fetch `profiles` + `user_roles`
- reject super admins from this route
- reject any user who is not `super_admin`, `library_owner`, or `staff`
- only then mint the app's custom session

Relevant lines:

- `src/lib/otpAuth.server.ts:163`
  `trimText()` uses `.trim()`
- `src/lib/otpAuth.server.ts:1895`
  `const password = trimText(body.password);`
- `src/lib/otpAuth.server.ts:1901`
  `signInWithPassword({ email, password })`
- `src/lib/auth.shared.ts:196`
  `isAdminFallbackRole = super_admin | library_owner | staff`

## Comparison With Magic-Link / Supabase-Native Session Flow

I did not find a repo-local "send magic link" function, so this part is an inference from how Supabase sessions are restored in the app.

Supabase-native email link sessions are accepted directly in the browser:

- `src/integrations/supabase/client.ts:24`
  `detectSessionInUrl: true`
- `src/hooks/useAuth.tsx:170-220`
  `restoreSession()` and `onAuthStateChange(...)` read a Supabase session directly from `supabaseAuth`
- `src/hooks/useAuth.tsx:149`
  `applySupabaseSession(...)` stores that session as provider `"supabase"`

That means the magic-link path does **not** go through:

- `/api/auth/login-email`
- `resolveEmailLoginRequest()`
- `trimText(body.password)`
- `signInWithPassword(...)`
- the admin-only gate in `resolveEmailLoginRequest()`

## Findings

### 1. Highest-confidence bug: the password login path trims the password before sending it to Supabase

Evidence:

- `src/lib/otpAuth.server.ts:163`
  `trimText()` is `value.trim()`
- `src/lib/otpAuth.server.ts:1895`
  `const password = trimText(body.password);`

Impact:

- If a user signed up with a password that begins or ends with whitespace, Supabase stored the exact password.
- Signup does not trim the password before `supabaseAuth.auth.signUp(...)`:
  `src/hooks/useAuth.tsx:413`
- Password update also does not trim before `supabaseAuth.auth.updateUser({ password })`:
  `src/hooks/useAuth.tsx:443`
- But password login does trim before `signInWithPassword(...)`.

Result:

- signup can succeed
- magic link can succeed
- password login can fail

This is the cleanest password-path-only failure I found.

### 2. Password login is not a plain Supabase login; it is an admin-only server route

Evidence:

- `src/lib/otpAuth.server.ts:1918-1919`
  Non-admin users are rejected with `EMAIL_LOGIN_FORBIDDEN`
- `src/lib/auth.shared.ts:196`
  Allowed roles are only `super_admin`, `library_owner`, `staff`
- `src/lib/otpAuth.server.ts:1910-1914`
  `super_admin` is also blocked here and redirected to the separate MFA flow

So even when Supabase accepts the email/password, this route can still fail afterward because of app-specific role policy.

This explains failures for:

- users with no `user_roles` row yet
- `partner` users
- `student` users
- any account expected to use a different flow
- `super_admin` users using the wrong login page

Important mismatch:

- `docs/system-blueprint/api-reference.md:212`
  says `/auth/login-email` is for "normal app users"
- actual code restricts it to admin fallback roles only

### 3. Magic-link success does not prove the password route is healthy

Magic-link/Supabase-native login and password login are architecturally different here.

Magic-link success proves:

- Supabase project URL/key are valid
- browser Supabase session restoration works

It does **not** prove:

- `/api/auth/login-email` works
- the server-side password normalization is correct
- post-password role lookup in `profiles` + `user_roles` succeeds
- the admin-only gate allows the account

## Why Password Login Can Fail While Signup and Magic Link Succeed

The codebase gives two concrete answers:

1. The password login route mutates the password with `.trim()` before calling `signInWithPassword(...)`, while signup/update do not.
2. The password login route has extra server-side gates after Supabase auth, and the magic-link/Supabase-native session path does not.

## Most Likely Root Cause Order

1. Password contains leading or trailing whitespace and is being altered only in `resolveEmailLoginRequest()`.
2. The account is valid in Supabase, but the app rejects it after password verification because it is not `library_owner` or `staff`, or because it is `super_admin` and must use the MFA flow.
3. The account exists in Supabase Auth, but its `profiles` / `user_roles` data is incomplete, causing the server-side post-auth checks to reject it even though Supabase itself would accept the user.

## Bottom Line

Supabase auth itself is not the weak point here.

The email/password path is a separate server-controlled flow with two password-only risks:

- it trims the password before `signInWithPassword(...)`
- it enforces extra role-based rejection after Supabase accepts the credentials

Those are the exact reasons password login can fail while signup and magic-link login still succeed.
