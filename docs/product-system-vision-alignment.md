# Product + System Vision Alignment

## Step 1: Missing Inputs and Practical Assumptions

Founder inputs were not explicitly provided, so this analysis uses practical assumptions based on the repo, route structure, docs, and feature set.

### Assumptions Used

- The product is for small to mid-sized study libraries in India that currently run operations on WhatsApp, paper, and spreadsheets.
- The primary paying user is the library owner. Staff are operational users. Students are secondary users. Partners are a growth channel, not the core user.
- The core value is operational control: seat occupancy, student lifecycle, payments, renewals, and attendance from one system.
- The long-term goal is to become a vertical SaaS operating system for libraries, not just an attendance app.
- The startup is still in the validation or early PMF stage, not at scale stage yet.

If any of these are wrong, the conclusions should be adjusted. But even with different wording, the structural feedback below still mostly holds.

---

## Founder Vision

**Problem:**
Library owners lose money and time because admissions, seat allocation, attendance, renewals, payment follow-ups, and communication are fragmented across manual tools.

**Target Users:**
Library owners and staff in India running physical study libraries.

**Core Value:**
Run the full library from one operational system with less leakage, less manual work, and better visibility.

**Long Term Goal:**
Become the default operating system for physical libraries and study centers, with SaaS monetization, automation, and a partner-led growth engine.

---

## Product Flow

1. A library owner signs up, creates or receives a default library workspace, and configures plans, seats, slots, branding, and staff access.
2. The library adds students, assigns plans and seats, generates QR identity, records payments, and manages renewals.
3. A scanner or kiosk verifies signed QR codes for attendance while the dashboard tracks operations, reminders, billing, and basic growth workflows.

---

## Current System / Code

**Tech Stack:**
React + Vite + TypeScript, Tailwind, TanStack Query, Supabase Postgres/Auth/Storage/Edge Functions, Express API, Vercel serverless handler, Render deployment, Sentry, Razorpay, Twilio, OpenAI, PWA scanner stack.

**Features Built:**
Library onboarding, custom auth with OTP and email login, super admin MFA, public library pages, waiting list, student management, seat and locker management, signed QR generation, kiosk attendance, payments, renewals, reminders, partner portal, super admin portal, observability, maintenance mode, backup and go-live docs.

**Limitations Observed:**
- Product surface is much broader than a normal MVP.
- Runtime is split across direct Supabase access, Express routes, Vercel serverless, and Edge Functions.
- Large parts of the UI and auth logic are concentrated in very large files.
- Test coverage is minimal relative to system size.
- Operational docs are stronger than executable package scripts in `package.json`.

---

## Analysis

### Vision vs Reality Gap

1. The product vision appears to be "library operating system," but the current product behaves more like "everything for everyone at once."
You already have library ops, student lifecycle, payments, renewals, public sites, partner CRM, super admin analytics, AI partner assistant, AI lead finder, and recovery-call automation. That is not a tight startup wedge. That is a platform ambition before core dominance.

2. The system is stronger on feature breadth than on proving one undeniable daily value loop.
The best core loop seems to be:
`student created -> QR issued -> attendance tracked -> renewal due -> payment collected`
That loop is valuable. But the codebase has many side systems competing for attention before this loop is clearly hardened and simplified.

3. The partner and platform layers are ahead of product maturity.
Partner dashboards, payouts, AI sales help, admin analytics, and platform coverage maps make sense later. Right now they risk distracting from the main question: do library owners love and depend on the daily ops workflow?

4. Student experience is still shallow for a company that calls itself a system.
Students mostly appear as records, token links, or QR identities, not full product users. If the long-term vision includes a stronger network or engagement layer, the current product does not yet reflect that.

5. "Automation" is only partially true today.
There is automation around reminders and scan processing, but many critical flows still depend on configuration discipline, manual scheduling, screenshots, and multi-layer runtime assumptions. This is operational software, but not yet a truly self-running system.

6. The repo reads like an ambitious agency-delivered platform, not a sharply validated startup wedge.
That is the biggest product risk. You may be building the company you want in year three before proving what must win in month three.

### Architecture Weakness

1. Frontend complexity is already too high for the current stage.
Some page files are extremely large:
- `src/pages/ScanPage.tsx`: about 4100 lines
- `src/pages/PaymentsPage.tsx`: about 3360 lines
- `src/pages/Dashboard.tsx`: about 2370 lines
- `src/pages/SettingsPage.tsx`: about 1050 lines

This will slow every future change, make onboarding hard, and increase regression risk.

2. Auth and security-sensitive logic are concentrated in oversized modules.
`src/lib/otpAuth.server.ts` is about 1900 lines. For an auth core, that is dangerous. Authentication should become more boring over time, not more sprawling.

3. The backend surface exists in too many places.
The same product contract is spread across:
- direct Supabase reads and RPC calls
- Express in `server/index.ts`
- Vite dev middleware in `vite.config.ts`
- Vercel serverless bridge in `server/vercelHandler.ts`
- Supabase Edge Functions

This is workable for a strong team with discipline, but fragile for a startup moving fast. Route parity drift is very likely.

4. Secret boundaries are conceptually blurred.
Several server helpers allow fallback reads like `SUPABASE_SERVICE_ROLE_KEY` or `VITE_SUPABASE_SERVICE_ROLE_KEY`, and maintenance status can fall back to an anon key path. Even if this is not currently leaking secrets, it creates dangerous ambiguity. Security-sensitive boundaries should be enforced by design, not by naming conventions and discipline.

5. Your core operational product depends on browser-heavy code and large bundles.
`npm run build` succeeds, but Vite reports chunks above the recommended size, including roughly:
- `vendor-bhQjUukz.js`: about 1.07 MB
- `vendor-heavy-CUVpzRO3.js`: about 639 kB

For an India-first physical-library product, low-end Android devices and kiosk hardware matter. Performance is a business issue here, not just a frontend issue.

6. Compatibility and fallback paths are accumulating.
The docs themselves mention compatibility logic for lockers, photos, leads, and attendance fallback RPCs. Compatibility helps temporarily, but too much of it turns the system into archaeology.

7. Operational truth is documented better than it is packaged.
The repo contains scripts for backups, go-live checks, restore drills, and ops health, but `package.json` currently exposes only `dev`, `build`, and `preview`. That means the operational story is partly real and partly undocumented in executable developer workflow. This is a trust gap.

8. Test coverage is far below the system's risk level.
`npx vitest run` passes, but only 11 tests across 4 files ran. That is nowhere near enough for a system that touches auth, attendance, payments, device setup, and renewals.

### Missing Systems

1. A hard product-core boundary is missing.
There is no clear "this is the one workflow we refuse to complicate" boundary. Without that, every new idea becomes part of the system.

2. Product analytics and usage instrumentation are still weak relative to ambition.
Google Analytics was just added to `index.html`, but founder-grade product instrumentation should go much deeper:
- activation funnel
- time-to-first-student
- time-to-first-scan
- renewal conversion
- payment recovery effectiveness
- owner weekly retained usage

3. A proper domain service layer is missing on the frontend.
Many large pages appear to own both UI and business workflow logic. You need domain modules for admissions, attendance, billing, and device operations instead of page-level orchestration.

4. A workflow engine or real async job discipline is missing for system-critical automations.
You do have Edge Functions and some BullMQ usage in auth fallback, but the broader automation model is still fragmented. If reminders, recovery, waitlist, no-show detection, and partner automation keep growing, you need a coherent job architecture.

5. A stronger permissions and policy model is missing at the product layer.
The role model exists, but the product still feels owner/staff/admin heavy. Granular operational roles, audit clarity, and feature entitlement boundaries will matter as libraries grow beyond one owner.

6. A migration and compatibility retirement process is missing.
You are adding resilience by keeping old paths alive, but I do not see a clear retirement rhythm. Without that, the codebase will keep carrying dead business assumptions.

7. A clearer deployment topology is missing.
Today the app feels like one giant system serving marketing site, owner dashboard, kiosk, partner portal, and super admin. That is convenient now, but eventually you will need explicit boundaries for reliability, performance, and team velocity.

### Over / Under Engineering

#### Overengineering

1. Partner growth systems are ahead of proof.
AI sales assistant, lead finder, commission system, payouts, growth analytics, and coverage intelligence are too much unless partner acquisition is already a proven growth channel.

2. Platform governance may be too early.
Super admin breadth is large for a company that still appears to be validating the primary customer workflow.

3. Operational ceremony is heavy relative to current code maturity.
Backup drills, go-live checklists, release truth, and infra docs are good instincts. But when tests are still tiny and core flows are still bundled into giant files, parts of the ops layer feel more mature than the application layer beneath them.

4. Multiple backend access styles are over-optimized for flexibility.
You have intentionally avoided one API layer. That can be smart, but right now it also increases cognitive load, debugging cost, and security reasoning burden.

#### Underengineering

1. Core module boundaries are underbuilt.
The product needs domain modules more than new features.

2. Test depth is underbuilt.
Critical flows need integration tests, contract tests, and at least a few end-to-end business flow tests.

3. Performance discipline is underbuilt.
Bundle size, route-level performance budgets, and kiosk/device constraints need stricter ownership.

4. Product instrumentation is underbuilt.
You need founder dashboards, not just admin dashboards.

5. Core UX simplification is underbuilt.
The repo proves engineering ambition. It does not yet prove that a first-time library owner can get live in one hour without confusion.

---

## Improved System Vision

Libriofy should be the daily operating system for small and medium physical libraries in India.

The system should do one thing exceptionally well:
help a library owner go from manual chaos to controlled operations in a few hours, then make daily execution effortless.

### Clear Use Case

A library owner should be able to:
- set up their library
- define seats, slots, and plans
- add students quickly
- generate trusted QR identity
- mark attendance reliably from a kiosk
- track dues and renewals
- recover missed payments with lightweight automation

### Clear Product Flow

1. Onboard library in minutes.
Library info, plans, seats, slots, and staff setup should be fast and guided.

2. Start operations immediately.
Add students, assign seats, generate QR, and begin attendance without technical setup pain.

3. Stay in control daily.
The owner should see overdue payments, renewal risks, attendance exceptions, device health, and occupancy from one clean command center.

4. Automate the boring parts.
Reminders, renewal nudges, payment follow-ups, and no-show detection should work reliably in the background.

5. Expand only after the core loop is dominant.
Partner systems, AI tooling, advanced marketing pages, and ecosystem features should grow only after the owner workflow is sticky and retained.

### Clear System Behavior

- The owner workflow is the product core.
- Student records, attendance, renewals, and payments are first-class system domains.
- Every security-sensitive action goes through one trusted backend contract.
- Every automation has explicit ownership, retries, and observability.
- Every feature must prove it improves owner activation, retention, or revenue before it earns complexity budget.

---

## Action Plan

### Phase 1 (Fix Basics)

1. Declare the real product core.
Freeze non-core expansion and define the primary wedge as:
`student management + QR attendance + renewals + payment visibility`

2. Refactor the biggest operational pages.
Split `ScanPage`, `PaymentsPage`, `Dashboard`, and `SettingsPage` into domain components, hooks, and service modules.

3. Standardize backend contracts for critical flows.
For auth, attendance, payments, and QR:
pick one primary mutation path and document it as the only trusted write path.

4. Clean secret and runtime boundaries.
Remove `VITE_*` fallback names from server-only secret paths where possible. Make server-only config impossible to confuse with browser config.

5. Add founder-grade analytics.
Track:
- signup to first library setup
- first student created
- first QR generated
- first successful scan
- first renewal completed
- weekly active owners

### Phase 2 (Stability)

1. Build test coverage around critical business flows.
Minimum set:
- auth login and refresh
- student creation
- QR generation and verification
- attendance scan success and duplicate prevention
- renewal and payment state changes

2. Introduce domain modules.
Create explicit service boundaries for:
- admissions
- attendance
- billing and renewals
- devices
- partner growth

3. Reduce route/runtime duplication.
Unify behavior across Express, Vite middleware, and serverless exposure. If possible, move toward one authoritative API surface for sensitive workflows.

4. Establish compatibility retirement.
List all temporary compatibility paths and assign removal criteria with dates or migration milestones.

5. Set performance budgets.
Treat kiosk load time, scan latency, and owner dashboard responsiveness as product metrics.

### Phase 3 (Scale Ready)

1. Split the platform by business domain, not by page.
The likely long-term domains are:
- core library ops
- growth and partner systems
- platform admin and governance

2. Move automations into a coherent async architecture.
Scheduled jobs, retries, provider callbacks, and long-running workflows should share one operational model.

3. Add stronger tenant and role controls.
As larger libraries join, granular permissions, auditability, and policy enforcement will become mandatory.

4. Separate "startup proof" features from "platform expansion" features.
Only invest heavily in partner AI, public site builder sophistication, and advanced admin intelligence after core retention is strong.

---

## Final Decision

**Continue, but narrow aggressively.**

This is not a pivot and not a rebuild.
The product has a real core and a serious amount of useful infrastructure. The problem is not that the system is weak. The problem is that the system is trying to become a mature platform before the startup has clearly earned that complexity.

The correct move is:
- keep the core
- refactor for clarity
- cut distraction
- validate the owner daily workflow harder
- only then expand the platform layers

If you do not narrow now, the likely future failure mode is not "the app crashes."
It is "the team becomes slow, the product becomes confusing, and core PMF gets buried under platform ambition."

---

## Evidence Used

- Repo docs describe Libriofy as a full library operating system with student, attendance, payment, renewal, partner, and admin flows.
- `src/App.tsx` exposes a very broad route surface across public, owner, partner, kiosk, and super admin contexts.
- Several core files are already very large, especially `ScanPage`, `PaymentsPage`, `Dashboard`, and `otpAuth.server.ts`.
- `npm run build` succeeds but reports oversized production chunks.
- `npx vitest run` passes with only 11 tests, which is far too little for the system scope.
- `package.json` currently exposes only a minimal script surface despite richer operational docs and script files in the repo.
