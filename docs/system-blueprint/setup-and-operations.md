# Setup And Operations

## 1. Prerequisites

- Node.js and npm
- Supabase CLI
- a linked Supabase project
- Razorpay credentials for subscription billing
- Twilio / WhatsApp / webhook credentials if you want auth messaging or reminder delivery
- PostgreSQL client tools for restore execution and validation
- a dedicated `.env.ops` file for backup and restore automation
- Windows Task Scheduler access if you want one-command scheduler installation
- optional AWS CLI or `rclone` for offsite backups
- Vercel access for frontend hosting
- Render or equivalent server-hosting access for the API runtime
- GitHub Actions environment secrets for automated deployment and alerting

## 2. Local Development Quick Start

### Recommended Path

1. Install dependencies:

```bash
npm install
```

2. Create or update your local `.env` with the variables listed below.

If this machine will run automated backup, restore, or monitoring tasks, also copy `.env.ops.example` to `.env.ops` and fill the operations variables.

3. Link the local repo to the correct Supabase project:

```bash
npx supabase login
npx supabase link --project-ref xaoitjyuuxwksofmmydh
```

4. Apply migrations:

```bash
npx supabase db push
```

5. Make sure repo hooks are active:

```bash
npm run setup:hooks
```

6. Start the app:

```bash
npm run dev
```

7. Open:

- frontend and dev middlewares: `http://localhost:8080`

### Alternative Split Runtime

If you want the SPA and API to run as separate processes:

1. Start Vite:

```bash
npm run dev
```

2. Start the Express API in another terminal:

```bash
npm run dev:api
```

3. Point browser-side API calls at the separate API with environment values such as:

- `VITE_AUTH_API_BASE=http://localhost:3001`
- `VITE_SCAN_API_URL=http://localhost:3001/api/attendance/scan`
- `VITE_DEVICE_HEARTBEAT_API_URL=http://localhost:3001/api/device-heartbeat`
- `VITE_STUDENT_QR_API_URL=http://localhost:3001/api/student-qr`

## 3. Minimum Environment Set

These are the minimum secrets and config values for a useful local boot.

### Browser / Vite

| Variable | Why it exists |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | browser-safe Supabase key |
| `VITE_QR_PUBLIC_KEY` or `VITE_STUDENT_QR_PUBLIC_KEY` | scanner-side verification of signed student QR tokens |
| `VITE_RAZORPAY_KEY_ID` | browser checkout key for platform billing |

### Server / Same-Origin API Runtime

| Variable | Why it exists |
| --- | --- |
| `SUPABASE_URL` | server-side Supabase access |
| `SUPABASE_SERVICE_ROLE_KEY` | privileged DB access for auth, scanner, and QR signing |
| `STUDENT_QR_PRIVATE_KEY` | signs student QR tokens |
| `PUBLIC_APP_URL` or `APP_URL` | builds secure cookie rules and callback URLs |

### Strong Recommendation

Do not expose service-role credentials in `VITE_*` variables for production browser builds.

Some helper code currently supports fallback names such as `VITE_SUPABASE_SERVICE_ROLE_KEY`, but the intended deployment model is:

- anon key in the browser
- service role key only in server runtimes and Supabase Function secrets

## 4. Environment Matrix

### Frontend / Vite Variables

| Variable | Required | Used by |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Supabase browser client |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase browser client |
| `VITE_AUTH_API_BASE` | optional | separate auth API host |
| `VITE_API_BASE_URL` | optional | students API wrapper fallback |
| `VITE_SCAN_API_URL` | optional | scanner submit endpoint |
| `VITE_DEVICE_HEARTBEAT_API_URL` | optional | kiosk heartbeat endpoint |
| `VITE_STUDENT_QR_API_URL` | optional | QR signing endpoint |
| `VITE_QR_PUBLIC_KEY` / `VITE_STUDENT_QR_PUBLIC_KEY` | yes for scanner | QR verification |
| `VITE_RAZORPAY_KEY_ID` | yes for billing | checkout |
| `VITE_APP_ENV` | recommended in hosted envs | environment label for routing and monitoring |
| `VITE_RELEASE_SHA` | recommended in hosted envs | release correlation in monitoring |
| `VITE_SENTRY_DSN` | recommended in staging and production | client-side error monitoring |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | optional | client tracing volume |
| `VITE_SCAN_DEVICE_ID` | recommended for kiosks | stable kiosk identifier |
| `VITE_SCAN_DEVICE_NAME` | recommended for kiosks | readable device label |
| `VITE_SCAN_DEVICE_TOKEN` | recommended for kiosks | additional device auth |
| `VITE_SCAN_ADMIN_PIN` | recommended for kiosks | local kiosk reset / admin actions |
| `VITE_DEVICE_ADMIN_PIN` | optional | device admin tooling |
| `VITE_ENABLE_DEVICE_COMMANDS` | optional | remote control feature flag |
| `VITE_PUBLIC_APP_URL` / `VITE_APP_URL` | optional | absolute links |
| `VITE_APP_VERSION` | optional | kiosk heartbeat metadata |
| `VITE_SUPPORT_WHATSAPP` | optional | support CTA links |
| `VITE_PRODUCT_DEMO_VIDEO_URL` | optional | marketing site |
| `VITE_PRODUCT_DEMO_EMBED_URL` | optional | marketing site |
| `VITE_USE_HASH_ROUTER` | optional | routing mode |
| `VITE_BASE_PATH` | optional | deploy under subpath |
| `VITE_MAINTENANCE_MODE` | optional override | maintenance mode |
| `VITE_SUPABASE_PROJECT_ID` | optional | error messages and function hints |

### Server / Express / Vite Middleware Variables

| Variable | Required | Used by |
| --- | --- | --- |
| `SUPABASE_URL` | yes | server-side Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | auth, attendance, QR signing, device flows |
| `PORT` | optional | Express server port, default `3001` |
| `APP_ENV` | recommended in hosted envs | health payload and deployment environment label |
| `RELEASE_SHA` | recommended in hosted envs | release correlation |
| `OPENAI_API_KEY` | optional | partner AI endpoint |
| `OPENAI_MODEL` | optional | partner AI endpoint |
| `OPENAI_BASE_URL` | optional | custom OpenAI-compatible base URL |
| `PUBLIC_APP_URL` / `APP_URL` / `SITE_URL` | recommended | secure cookie and redirect logic |
| `AUTH_DEFAULT_COUNTRY_CODE` | optional | OTP phone normalization |
| `STUDENT_QR_PRIVATE_KEY` | yes for QR signing | signed student QR issue |
| `STUDENT_QR_PUBLIC_KEY` | recommended | server-side QR verification consistency |
| `MAINTENANCE_MODE` | optional | force global maintenance |
| `SENTRY_DSN` | recommended in staging and production | server-side error monitoring |
| `SENTRY_ENVIRONMENT` | recommended | Sentry environment label |
| `SENTRY_RELEASE` | recommended | Sentry release correlation |
| `SENTRY_TRACES_SAMPLE_RATE` | optional | server tracing volume |

### Billing And Payment Secrets

| Variable | Required when | Used by |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` | billing enabled | `create-payment`, checkout |
| `RAZORPAY_KEY_SECRET` | billing enabled | payment creation and verification |
| `RAZORPAY_WEBHOOK_SECRET` | webhook enabled | `razorpay-webhook` |

### Messaging, Reminder, And Calling Secrets

| Variable | Required when | Used by |
| --- | --- | --- |
| `TWILIO_ACCOUNT_SID` | OTP, reminders, calls | Twilio integrations |
| `TWILIO_AUTH_TOKEN` | OTP, reminders, calls | Twilio integrations |
| `TWILIO_WHATSAPP_FROM` | WhatsApp delivery | OTP and reminders |
| `TWILIO_SMS_FROM` | SMS delivery | OTP and reminders |
| `TWILIO_CALL_FROM` / `TWILIO_PHONE_NUMBER` | AI recovery calls | call origination |
| `TWILIO_SAY_LANGUAGE` | call status function | IVR voice settings |
| `TWILIO_SAY_VOICE` | call status function | IVR voice settings |
| `REMINDER_WEBHOOK_URL` | custom reminder provider | renewals and reminders |
| `REMINDER_DEFAULT_COUNTRY_CODE` | reminder delivery | phone normalization |
| `DEFAULT_COUNTRY_CODE` | reminder and calling flows | phone normalization |
| `ACCESS_TOKEN` / `META_WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp integration | reminders |
| `PHONE_NUMBER_ID` / `META_WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp integration | reminders |
| `WHATSAPP_API_URL` | custom endpoint | reminders |
| `PAYMENT_CALL_WEBHOOK_SECRET` | call status webhook | recovery call verification |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS | recovery calls |
| `ELEVENLABS_VOICE_ID` | ElevenLabs TTS | recovery calls |
| `ELEVENLABS_MODEL_ID` | ElevenLabs TTS | recovery calls |
| `GOOGLE_TTS_API_KEY` | Google TTS | recovery calls |
| `GOOGLE_TTS_VOICE_NAME` | Google TTS | recovery calls |
| `GOOGLE_TTS_LANGUAGE_CODE` | Google TTS | recovery calls |

### AI And Growth Secrets

| Variable | Required when | Used by |
| --- | --- | --- |
| `OPENAI_API_KEY` | partner AI or AI growth insights enabled | `/api/ai/partner`, `ai-growth-insights` |
| `OPENAI_MODEL` | optional | OpenAI model selection |
| `GOOGLE_MAPS_API_KEY` / `GOOGLE_PLACES_API_KEY` | AI lead finder enabled | `ai-lead-finder` |

### Operations And Backup Variables

| Variable | Used by |
| --- | --- |
| `BACKUP_S3_URI` | `scripts/backup-db.ps1` offsite S3 upload |
| `BACKUP_RCLONE_REMOTE` | `scripts/backup-db.ps1` offsite rclone upload |
| `RESTORE_DB_URL` | `scripts/restore-db.ps1` restore target |

### Backup Automation And Alerting Variables

| Variable | Used by |
| --- | --- |
| `OPS_OWNER_NAME` | owner field in backup, restore, drill, monitor, and alert logs |
| `BACKUP_REQUIRE_OFFSITE` | forces backup failure when no cloud target is configured |
| `BACKUP_SUPABASE_BUCKET` | Supabase Storage bucket for offsite backup zips |
| `BACKUP_SUPABASE_PATH` | Supabase Storage object prefix |
| `BACKUP_SUPABASE_URL` | Supabase URL for Storage uploads |
| `BACKUP_SUPABASE_SERVICE_ROLE_KEY` | service role key for Storage uploads |
| `RESTORE_STAGING_DB_URL` / `RESTORE_DRILL_DB_URL` | staging target for restore drills |
| `OPS_ALERT_WEBHOOK_URL` | webhook alert delivery |
| `OPS_ALERT_EMAIL_FROM` / `OPS_ALERT_EMAIL_TO` | alert email sender and recipients |
| `OPS_ALERT_SMTP_HOST` / `OPS_ALERT_SMTP_PORT` | SMTP transport for alert email |
| `OPS_ALERT_SMTP_USERNAME` / `OPS_ALERT_SMTP_PASSWORD` | SMTP auth credentials |
| `OPS_ALERT_SMTP_USE_SSL` | SMTP TLS toggle |
| `OPS_ALERT_TWILIO_ACCOUNT_SID` / `OPS_ALERT_TWILIO_AUTH_TOKEN` | Twilio alert auth |
| `OPS_ALERT_TWILIO_FROM` / `OPS_ALERT_TWILIO_TO` | WhatsApp or SMS alert sender and receiver |

Full infra runbook: [devops-and-infra.md](./devops-and-infra.md)

## 5. Deployment Process

### Recommended Production Topology

- frontend: Vercel
- API runtime: Render web service using `Dockerfile.api`
- database and storage: Supabase
- CI/CD control plane: GitHub Actions
- incident visibility: Sentry plus ops webhook alerts
- backup and restore: `.env.ops` plus scheduled scripts on the ops machine

### Database First

1. Apply migrations to the target Supabase project.
2. Regenerate the Supabase type snapshot after schema changes.
3. Run `npm run check:schema-sync`.
4. Verify RLS and RPC access for any new tables or functions.

### Edge Functions

Deploy the changed functions under `supabase/functions/`. The core production set currently includes:

- `create-payment`
- `subscription-quote`
- `verify-razorpay-payment`
- `razorpay-webhook`
- `process-renewals`
- `start-payment-recovery-calls`
- `send-payment-recovery-reminders`
- `payment-recovery-call-status`
- `scan-attendance`
- `admin-libraries`
- `ai-growth-insights`
- `ai-lead-finder`
- `process-waitlist`
- `detect-no-shows`
- `finalize-student-photo-upload`
- `cleanup-student-photo-assets`

All provider secrets needed by these functions must be stored as Supabase Function secrets, not only as local `.env` values.

### Frontend

Preferred path: deploy through GitHub Actions after a push to `staging` or `main`.

Manual fallback:

1. Build the SPA:

```bash
npm run build
```

2. Deploy the built assets from `dist/` to the Vercel project defined by `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.
3. Confirm the deployed domain points to the correct API host through:
   - `VITE_AUTH_API_BASE`
   - `VITE_API_BASE_URL`
   - `VITE_SCAN_API_URL`
   - `VITE_DEVICE_HEARTBEAT_API_URL`
   - `VITE_STUDENT_QR_API_URL`

### API Runtime

Preferred path: let GitHub Actions trigger the Render deploy hook after validation passes.

Manual fallback:

```bash
npm run build:production
npm run start:api:prod
```

Expected port: `3001` unless `PORT` is overridden.

Render should use `/health/ready` as the readiness probe and separate services for staging and production as defined in `render.yaml`.

### CI/CD Environments

Branch mapping:

- `staging` -> GitHub `staging` environment -> staging frontend and API
- `main` -> GitHub `production` environment -> production frontend and API

Validation gates before deploy:

- `npm run check:schema-sync`
- documentation coverage for the actual git range
- `npm test`
- `npm run build:production`

### Provider Configuration

- Configure Razorpay webhook delivery to the deployed `razorpay-webhook` function.
- Configure Twilio callbacks for OTP delivery status and payment recovery call status.
- Configure any Meta WhatsApp / custom reminder webhook credentials if those channels are in use.

### Scheduled Automation

At minimum, schedule:

- `process-renewals` daily
- `detect-no-shows` daily
- `process-waitlist` on the cadence your admissions workflow needs

## 6. Smoke Test Checklist After Deploy

1. Open the public landing page.
2. Sign in through OTP or email.
3. Reach `/dashboard`.
4. Add a student.
5. Generate a QR from `/dashboard/qr-codes`.
6. Bind a test kiosk on `/setup-device`.
7. Scan the QR on `/scan`.
8. Open `/dashboard/payments` and `/dashboard/renewals`.
9. Run one automation manually from the dashboard where available.
10. Confirm super admin login still requires the second factor.

## 7. Maintenance And Recovery

### Maintenance Mode

Maintenance can be turned on through:

- `platform_settings` with key `maintenance_mode`
- environment override `MAINTENANCE_MODE=true`

The app reads this through `/api/settings` and `MaintenanceGate`.

### Backup

Create a backup bundle:

```bash
npm run backup:db
```

Run the backup health monitor:

```bash
npm run backup:monitor
```

Run the one-command ops summary:

```bash
npm run ops:health
```

Optional offsite destinations:

- `BACKUP_S3_URI`
- `BACKUP_RCLONE_REMOTE`
- `BACKUP_SUPABASE_BUCKET`

### Backup Automation Setup

1. Copy `.env.ops.example` to `.env.ops`.
2. Fill backup, restore, and alert variables.
3. Test alert delivery:

```bash
npm run ops:alert:test
```

4. Install the scheduled tasks:

```bash
npm run setup:ops-schedule
```

The installer creates:

- a daily backup task
- a daily backup health monitor
- a monthly restore drill
- health endpoint URLs for remote monitoring should also be configured in `.env.ops`

### Restore

Restore a bundle into a target database:

```bash
npm run restore:db
```

Restore the latest backup into staging:

```bash
npm run restore:latest -- -Target staging
```

Run the restore drill manually:

```bash
npm run restore:drill
```

Required:

- `RESTORE_DB_URL`
- `psql`

Full runbook: `docs/backup-and-recovery.md`

## 8. Git Guardrails

- `npm install` runs `prepare`, which configures `git config core.hooksPath .githooks`.
- `pre-commit` blocks commits when schema sync fails or when delivery-relevant code changes do not include docs updates.
- `pre-push` blocks pushes when schema sync fails or when the pushed diff has no documentation update.
- GitHub Actions also checks docs coverage for the real PR or push range before deployment.
- Manual check commands:

```bash
npm run check:schema-sync
npm run check:delivery
npm run backup:monitor
npm run ops:health
npm run go-live:check
```

## 9. Operational Notes

- `npm run dev` already includes the custom auth and scan API middlewares inside Vite.
- The separate Express runtime is mainly useful for production-like local testing and some hosting targets.
- Scanner reliability depends on both local browser storage and server-side device binding.
- After any schema change, `src/integrations/supabase/types.ts` must stay aligned with `supabase/migrations/`.
