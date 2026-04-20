---
type: "query"
date: "2026-04-20T06:54:15.221339+00:00"
question: "Find files impacted if user schema changes."
contributor: "graphify"
source_nodes: ["requestAuth.server.ts", "otpAuth.server.ts", "useUserRole()", "useAuth()", "students.ts", "check-supabase-schema-sync.mjs"]
---

# Q: Find files impacted if user schema changes.

## Answer

The most impacted files are src/lib/requestAuth.server.ts and src/lib/otpAuth.server.ts because they load auth users from profiles and user_roles. Client role and redirect behavior depends on src/hooks/useUserRole.ts, src/hooks/useAuth.tsx, src/components/auth/AuthRoute.tsx, and src/components/auth/ProtectedRoute.tsx. Schema-sensitive student-facing fallbacks also appear in src/api/students.ts, and schema drift detection is enforced by scripts/check-supabase-schema-sync.mjs plus src/integrations/supabase/types.ts.

## Source Nodes

- requestAuth.server.ts
- otpAuth.server.ts
- useUserRole()
- useAuth()
- students.ts
- check-supabase-schema-sync.mjs