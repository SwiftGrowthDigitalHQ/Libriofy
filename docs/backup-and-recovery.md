# Backup And Recovery

Libriofy now uses an automated backup, verification, restore, drill, and monitoring workflow. This runbook is the operational source of truth for recovery. The target is clear: if production fails, the team should be able to restore service in `15-30 minutes` without guesswork.

## Recovery Objective

- Recovery time objective: `15-30 minutes`
- Recovery point objective: latest successful automated backup plus Supabase PITR
- Current owner: `system-owner` unless `OPS_OWNER_NAME` overrides it
- Repo source of truth for operations: `scripts/` plus this document

## System Components

| Layer | Purpose | Main script or system |
| --- | --- | --- |
| Supabase platform backup | fastest full-project recovery and PITR | Supabase managed backups |
| Daily logical backup | portable schema and data export | `scripts/backup-db.ps1` |
| Offsite copy | second storage location outside local machine | S3, `rclone` remote such as Google Drive, or Supabase Storage |
| Backup verification | verify archive exists, has required files, and has usable size | built into `scripts/backup-db.ps1` |
| Restore command | restore schema and data to a target database | `scripts/restore-db.ps1` |
| Monthly restore drill | prove staging restore still works | `scripts/run-restore-drill.ps1` |
| Backup health monitoring | detect missing or stale backups and drill failures | `scripts/monitor-backup-health.ps1` |
| Alerting | notify on failure or stale backup health | webhook, SMTP email, Twilio WhatsApp or SMS |
| Scheduler | install daily and monthly automation on Windows | `scripts/install-ops-schedule.ps1` |

## Required Setup

### 1. Create The Ops Environment File

Copy [.env.ops.example](../.env.ops.example) to `.env.ops` and fill in real values.

Important groups:

- backup source: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- restore targets: `RESTORE_DB_URL`, `RESTORE_STAGING_DB_URL`
- offsite storage: `BACKUP_S3_URI`, `BACKUP_RCLONE_REMOTE`, `BACKUP_SUPABASE_*`
- alerting: `OPS_ALERT_WEBHOOK_URL`, `OPS_ALERT_EMAIL_*`, `OPS_ALERT_TWILIO_*`
- owner: `OPS_OWNER_NAME`

### 2. Validate Alerting

Run a manual alert test:

```powershell
npm run ops:alert:test
```

### 3. Install Scheduled Tasks

Install the default Windows automation:

```powershell
npm run setup:ops-schedule
```

This registers:

- daily backup task
- daily backup health monitor
- monthly restore drill

## Daily Automated Backup

### Manual Command

```powershell
npm run backup:db
```

### Naming Convention

Every backup uses:

- `libriofy-YYYYMMDD-HHMMSS`

Example outputs:

- `backups/libriofy-20260407-020000/schema.sql`
- `backups/libriofy-20260407-020000/data.sql`
- `backups/libriofy-20260407-020000/manifest.json`
- `backups/libriofy-20260407-020000.zip`

### What The Backup Script Does

1. Dumps schema for `public`, `auth`, and `storage`.
2. Dumps table data for the same schemas.
3. Writes `manifest.json`.
4. Compresses the bundle into a timestamped zip.
5. Verifies the archive:
   required files must exist inside the zip
   archive size must be above the minimum threshold
   SHA-256 hash is recorded
6. Uploads the zip to any configured offsite targets.
7. Writes structured logs.
8. Sends an alert if anything fails.

### Offsite Targets

The same backup can be copied to one or more targets:

- AWS S3 through `BACKUP_S3_URI`
- Google Drive through `BACKUP_RCLONE_REMOTE`
- Supabase Storage through `BACKUP_SUPABASE_BUCKET`, `BACKUP_SUPABASE_PATH`, `BACKUP_SUPABASE_URL`, and `BACKUP_SUPABASE_SERVICE_ROLE_KEY`

For production, keep `BACKUP_REQUIRE_OFFSITE=true` in `.env.ops`.

## Backup Verification

Verification is built into the backup command. A backup is only considered successful when:

- `schema.sql` exists and is non-empty
- `data.sql` exists and is non-empty
- the zip archive exists
- the archive contains `schema.sql`, `data.sql`, and `manifest.json`
- the archive size crosses the configured minimum threshold
- the backup result is written to the log as `success`

If verification fails:

- the backup status is marked `failed`
- a critical alert is emitted
- the failure is written to logs

## Monitoring And Alerts

### Health Monitor Command

```powershell
npm run backup:monitor
```

The monitor checks:

- whether a successful backup exists within the backup age threshold
- whether a successful restore drill exists within the restore drill age threshold

Default thresholds:

- backup freshness: `26 hours`
- restore drill freshness: `35 days`

### Alert Channels

Any configured channel can be used:

- webhook: `OPS_ALERT_WEBHOOK_URL`
- email: `OPS_ALERT_EMAIL_*` plus `OPS_ALERT_SMTP_*`
- Twilio WhatsApp or SMS: `OPS_ALERT_TWILIO_*`

### Unified Ops Status

For a one-command status summary that includes backup, restore, drill, alert, and optional remote uptime checks:

```powershell
npm run ops:health
```

Useful variants:

```powershell
npm run ops:health -- --json
npm run ops:health -- --remote-only --strict
```

## Restore System

### First Choice For Major Production Incidents

Use Supabase point-in-time recovery or managed backup restore first. That is the fastest path for full-project recovery.

### Full Restore Command

Restore a specific backup:

```powershell
npm run restore:db -- -BackupName libriofy-YYYYMMDD-HHMMSS -Target production -Force
```

Restore the latest backup:

```powershell
npm run restore:latest -- -Target production -Force
```

### Staging Restore Test

Restore the latest backup into staging:

```powershell
npm run restore:latest -- -Target staging
```

Or run the dedicated drill command:

```powershell
npm run restore:drill
```

### What The Restore Script Does

1. Resolves a backup zip, folder, or explicit SQL files.
2. Extracts zip archives to a temporary folder when needed.
3. Restores schema with `psql`.
4. Restores data with `psql`.
5. Runs post-restore validation unless explicitly skipped.
6. Writes restore logs.
7. Sends a critical alert if restore fails.

### Post-Restore Validation

The restore script checks for key public tables:

- `libraries`
- `students`
- `user_roles`
- `attendance_logs`

It also records basic counts for:

- public tables
- libraries
- students
- attendance logs

## Monthly Restore Drill

The monthly drill proves that backups are actually restorable.

### Manual Command

```powershell
npm run restore:drill
```

### Automatic Process

The scheduler installs a monthly task that:

1. picks the latest backup
2. restores it into the staging restore database
3. validates the restored database
4. writes a success or failure record
5. emits a critical alert on failure

## Ownership And Logs

All backup and restore operations write machine-readable logs under `backups/logs/`.

| File | Meaning |
| --- | --- |
| `backup-log.jsonl` | daily backup history |
| `latest-backup-status.json` | last backup result |
| `restore-log.jsonl` | all restore runs |
| `latest-restore-status.json` | last restore result |
| `restore-drill-log.jsonl` | monthly drill history |
| `latest-restore-drill-status.json` | last drill result |
| `backup-monitor-log.jsonl` | backup health checks |
| `latest-backup-monitor-status.json` | last monitor result |
| `alerts-log.jsonl` | alert delivery attempts |
| `latest-alert-status.json` | last alert result |

Every log entry records:

- timestamp
- status
- owner
- duration where available
- backup name or source
- validation or error context

## 15-30 Minute Recovery Playbook

### Scenario A: Fastest Full Recovery

1. Open Supabase backup or PITR controls.
2. Restore to the desired recovery point.
3. Run the post-deploy smoke test from `docs/system-blueprint/setup-and-operations.md`.
4. Confirm auth, dashboard, student, scanner, and payments flows.

### Scenario B: Manual Repo-Driven Restore

1. Identify the latest verified backup:
   check `backups/logs/latest-backup-status.json`
2. Restore into staging first:

```powershell
npm run restore:latest -- -Target staging
```

3. If staging validation passes, restore production:

```powershell
npm run restore:latest -- -Target production -Force
```

4. Run the smoke test checklist.
5. Confirm monitoring shows healthy state.

## Operational Checklist

- `.env.ops` exists and is current
- at least one offsite target is configured
- `npm run ops:alert:test` passes
- scheduled tasks are registered
- daily backup status remains green
- monthly restore drill stays within the freshness threshold
- the current owner is documented in `OPS_OWNER_NAME`

## Related Docs

- [System Blueprint Backup And Recovery](system-blueprint/backup-and-recovery.md)
- [System Blueprint Setup And Operations](system-blueprint/setup-and-operations.md)
- [Future-Safe System Guide](system-blueprint/future-safe-system.md)
