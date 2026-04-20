---
type: "query"
date: "2026-04-20T06:54:14.778594+00:00"
question: "Explain the authentication flow."
contributor: "graphify"
source_nodes: ["otpAuth.server.ts", "requestAuth.server.ts", "useAuth()", "useUserRole()", "AuthRoute()"]
---

# Q: Explain the authentication flow.

## Answer

Client auth actions originate in src/lib/authApi.ts and are coordinated by src/hooks/useAuth.tsx, which restores cached session state, syncs with Supabase auth, and refreshes custom sessions. Server auth requests are handled by src/lib/otpAuth.server.ts, which performs OTP, email login, refresh-token, and super-admin flows using Supabase service-role access plus Redis-backed OTP/session state. src/lib/requestAuth.server.ts resolves incoming bearer tokens to hydrated users via profiles and user_roles. Access control is then enforced by src/hooks/useUserRole.ts, src/components/auth/AuthRoute.tsx, and src/components/auth/ProtectedRoute.tsx.

## Source Nodes

- otpAuth.server.ts
- requestAuth.server.ts
- useAuth()
- useUserRole()
- AuthRoute()