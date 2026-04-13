# Libriofy System Blueprint

This folder is the handover-safe documentation hub for Libriofy.

Goal: make the product system-dependent, not developer-dependent. A new engineer should be able to understand the platform, run it locally, trace data flow, and extend it without reverse-engineering the codebase first.

## What Libriofy Is

Libriofy is a multi-role library operations platform for:

- library owner operations
- kiosk-based attendance scanning
- student onboarding, QR identity, and renewals
- subscription billing for the platform itself
- partner-led library acquisition
- super admin platform control and growth analytics

## Product Surfaces

| Surface | Primary users | Main routes |
| --- | --- | --- |
| Public marketing site | Visitors, prospects | `/`, `/about`, `/contact`, `/support`, `/ref/:code` |
| Public library website | Students, walk-ins | `/library/:slug`, custom domains |
| Auth and account access | Library team, partners, admins | `/auth`, `/login`, `/signup`, `/reset-password`, `/admin/login` |
| Library dashboard | Library owner, staff | `/dashboard/*` |
| Attendance kiosk / scanner PWA | Front desk device | `/setup-device`, `/scan` |
| Student renewal portal | Students | `/renew/:token` |
| Student ID profile | Students, staff | `/student/:qr` |
| Partner portal | Partners | `/partner/*` |
| Super admin console | Platform ops | `/admin/*` |

## Core Stack

- Frontend: React 18, Vite, TypeScript, TanStack Query, shadcn/ui
- API runtime: Vite dev middlewares plus Express server (`server/index.ts`)
- Backend platform: Supabase Postgres, RLS, Postgres RPCs, Edge Functions, Storage
- Payments: Razorpay
- Messaging and calling: Twilio / WhatsApp webhook integrations
- AI: OpenAI, Google Places/Maps, ElevenLabs / Google TTS for specific flows
- DevOps and ops: GitHub Actions, Vercel, Render, Sentry, backup and restore automation

## Read These Docs In Order

1. [Architecture Overview](./architecture-overview.md)
2. [Feature Flows](./feature-flows.md)
3. [Database Reference](./database-reference.md)
4. [API Reference](./api-reference.md)
5. [Setup And Operations](./setup-and-operations.md)
6. [Scan Technical Breakdown](./scan-technical-breakdown.md)
7. [DevOps And Infra](./devops-and-infra.md)
8. [Backup And Recovery](./backup-and-recovery.md)
9. [Go-Live Checklist](./go-live-checklist.md)
10. [Future-Safe System Guide](./future-safe-system.md)

## Source Of Truth Rules

- Product routes and UI flow: `src/App.tsx`, `src/pages/`, `src/components/`
- Shared frontend behavior: `src/hooks/`, `src/lib/`
- Custom REST API behavior: `server/index.ts`, `api/`, `vite.config.ts`
- Database truth: `supabase/migrations/`
- Database type snapshot: `src/integrations/supabase/types.ts`
- Edge Function logic: `supabase/functions/`
- Operational scripts: `scripts/`

If the generated Supabase types disagree with migrations, trust the migrations first and regenerate the types snapshot.

## Delivery Rules

- Every feature, behavior change, or architectural decision must update the relevant docs in `docs/system-blueprint/`.
- A task is not complete until the code diff and the doc diff both exist.
- If `supabase/migrations/` changes, `src/integrations/supabase/types.ts` must be updated in the same change.

## Module Map

| Module | Purpose | Main code areas |
| --- | --- | --- |
| Public acquisition | Brand site, contact entry, referral entry | `src/pages/Home.tsx`, `src/pages/Index.tsx`, `src/pages/ReferralLanding.tsx` |
| Auth and session | OTP, email login, super admin MFA, session refresh | `src/hooks/useAuth.tsx`, `src/lib/authApi.ts`, `src/lib/otpAuth.server.ts` |
| Library operations | Dashboard, students, seats, lockers, analytics | `src/pages/Dashboard.tsx`, `src/pages/StudentsPage.tsx`, `src/pages/SeatMapPage.tsx`, `src/pages/LockerMapPage.tsx` |
| Attendance | Device setup, kiosk scan, offline sync, device control | `src/pages/SetupDevicePage.tsx`, `src/pages/ScanPage.tsx`, `src/lib/attendanceSync.ts`, `src/components/dashboard/DeviceControlCenter.tsx` |
| Student identity | Signed QR issuance, ID cards, profile page | `src/pages/QRCodesPage.tsx`, `src/lib/studentQr.server.ts`, `src/pages/StudentIdProfilePage.tsx` |
| Finance and renewals | Payments, reminders, screenshots, recovery automation | `src/pages/PaymentsPage.tsx`, `src/pages/RenewalsPage.tsx`, `src/pages/StudentRenewalPage.tsx` |
| Website builder | Public library branding, gallery, CTA, domain routing | `src/pages/LibraryPublicPage.tsx`, `src/components/dashboard/WebsiteCustomizationTab.tsx`, `src/components/DomainRouter.tsx` |
| Partner program | Registration, leads CRM, payouts, AI sales helper | `src/pages/PartnerRegistrationPage.tsx`, `src/pages/PartnerDashboard.tsx`, `src/pages/PartnerLeadsPage.tsx` |
| Super admin ops | Libraries, subscriptions, payouts, growth analytics | `src/pages/SuperAdminDashboard.tsx`, `src/pages/SuperAdminSubscriptions.tsx`, `src/pages/SuperAdminLibraries.tsx` |
| Operations | Maintenance mode, deployments, monitoring, backups, schema migrations, automation | `src/lib/maintenance.server.ts`, `src/lib/observability/`, `scripts/ops-health.mjs`, `scripts/backup-db.ps1`, `scripts/restore-db.ps1`, `supabase/migrations/` |

## Recommended Onboarding Sequence For A New Developer

1. Read this folder in order.
2. Open `src/App.tsx` to understand route boundaries.
3. Open `server/index.ts` and `vite.config.ts` to see the API surface.
4. Open `src/hooks/useAuth.tsx` and `src/lib/otpAuth.server.ts` to understand session architecture.
5. Open `supabase/migrations/` to understand the actual backend contract.
6. Follow one critical journey end-to-end:
   `signup -> dashboard -> add student -> generate QR -> setup device -> scan attendance`.

## Existing Operational Docs

- [Detailed Backup And Recovery Runbook](../backup-and-recovery.md)
- [Detailed DevOps And Infra Runbook](../devops-and-infra.md)
- [Edge Function Source Snapshot](../edge-functions-source.md)
