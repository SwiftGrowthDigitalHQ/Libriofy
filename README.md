# Libriofy

Libriofy is a library automation platform for seat management, students, attendance, payments, and renewals.

## Fix: "Database setup incomplete"

If `/dashboard` shows `public.user_roles was not found`, your Supabase project is linked but migrations were not applied on that project.

Run this in terminal from project root:

```bash
npx supabase login
npx supabase link --project-ref xaoitjyuuxwksofmmydh
npx supabase db push
```

If `supabase link` asks for database password, copy it from:
`Supabase Dashboard -> Project Settings -> Database -> Database password`.

Then restart app:

```bash
npm run dev
```

## Local development

```bash
npm install
npm run dev
```

Runs on `http://localhost:8080`.

## Build

```bash
npm run build
```

## Backup and recovery

Libriofy now includes an operational backup workflow for Supabase data:

- Supabase automatic backups should stay enabled for production recovery.
- `npm run backup:db` creates a weekly export bundle under `backups/`.
- Optional offsite upload is supported with AWS S3 or an `rclone` remote such as Google Drive.
- `npm run restore:db` replays a saved export into a target Postgres database.

Full runbook: [docs/backup-and-recovery.md](docs/backup-and-recovery.md)

## Automatic renewal reminders

Libriofy now supports automatic renewal reminders for students:

- `2 days before expiry`
- `1 day before expiry`
- `On the expiry day`

The reminder scan is handled by the `process-renewals` Supabase Edge Function. It creates reminder notifications, attempts delivery, and stores delivery status in the dashboard.

### Messaging provider setup

Use either a custom webhook or Twilio:

```bash
# Optional: custom webhook for your own WhatsApp/SMS provider
REMINDER_WEBHOOK_URL=https://your-provider.example.com/reminders

# Optional: default country code used when student phone numbers are saved without + prefix
REMINDER_DEFAULT_COUNTRY_CODE=+91

# Optional: Twilio fallback / direct delivery
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TWILIO_SMS_FROM=+1xxxxxxxxxx
```

If both WhatsApp and SMS are configured via Twilio, Libriofy tries WhatsApp first and falls back to SMS on failure.

### Daily automation

Schedule the `process-renewals` Edge Function to run once every day from the Supabase dashboard or your cron system. The renewals dashboard button can also run the same flow manually for testing.
