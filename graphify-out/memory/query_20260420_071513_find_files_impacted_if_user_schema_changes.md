---
type: "query"
date: "2026-04-20T07:15:13.956344+00:00"
question: "Find files impacted if user schema changes."
contributor: "graphify"
source_nodes: ["requestAuth.server.ts", "useUserRole()", "useAuth()", "resolveSuperAdminLoginRequest()"]
---

# Q: Find files impacted if user schema changes.

## Answer

User schema changes primarily impact src/lib/requestAuth.server.ts, src/hooks/useUserRole.ts, src/hooks/useAuth.tsx, src/lib/otpAuth.server.ts, and the route layers in server/index.ts and server/vercelHandler.ts. The highest-risk tables are profiles, user_roles, affiliates, and libraries because they drive token hydration, role routing, partner detection, and library ownership.

## Source Nodes

- requestAuth.server.ts
- useUserRole()
- useAuth()
- resolveSuperAdminLoginRequest()