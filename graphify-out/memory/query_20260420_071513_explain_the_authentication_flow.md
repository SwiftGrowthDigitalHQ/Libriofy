---
type: "query"
date: "2026-04-20T07:15:13.929453+00:00"
question: "Explain the authentication flow."
contributor: "graphify"
source_nodes: ["otpAuth.server.ts", "resolveRefreshSessionRequest()", "useAuth()", "useUserRole()"]
---

# Q: Explain the authentication flow.

## Answer

Client auth actions go through src/lib/authApi.ts into /api/auth routes. src/hooks/useAuth.tsx restores cached, Supabase, or refreshed custom sessions and route guards combine useAuth() with useUserRole(). Server auth endpoints in server/index.ts and server/vercelHandler.ts forward into src/lib/otpAuth.server.ts, which handles OTP, rate limits, Redis-backed challenge state, JWT minting, refresh-token rotation, and trusted-device sessions. Incoming bearer tokens are resolved in src/lib/requestAuth.server.ts by trying Supabase auth.getUser(token) first and local JWT verification second, then hydrating profiles and user_roles.

## Source Nodes

- otpAuth.server.ts
- resolveRefreshSessionRequest()
- useAuth()
- useUserRole()