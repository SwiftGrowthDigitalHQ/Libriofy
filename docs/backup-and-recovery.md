# Backup And Recovery

Libriofy stores student, library owner, attendance, payment, and renewal data in Supabase. The operational target is a three-layer backup strategy so the platform stays recoverable after accidental deletes, bad deployments, or database incidents.

## Backup layers

1. Supabase automatic backups

Enable Supabase automatic backups and point-in-time recovery in the production project. This is the fastest way to recover the whole database after corruption or large-scale data loss.

2. Weekly export from this repository

Run a full logical export every week:

```powershell
npm run backup:db
```

The script creates:

- `backups/libriofy-YYYYMMDD-HHMMSS/schema.sql`
- `backups/libriofy-YYYYMMDD-HHMMSS/data.sql`
- `backups/libriofy-YYYYMMDD-HHMMSS/manifest.json`
- `backups/libriofy-YYYYMMDD-HHMMSS.zip`

By default the backup includes the `public`, `auth`, and `storage` schemas from the linked Supabase project.

3. Offsite copy

Use one of the following environment variables before running the backup script:

- `BACKUP_S3_URI=s3://your-bucket/libriofy`
- `BACKUP_RCLONE_REMOTE=gdrive:libriofy-backups`

`BACKUP_S3_URI` uploads the zip archive with AWS CLI.

`BACKUP_RCLONE_REMOTE` uploads the zip archive with `rclone`, which is a practical option for Google Drive, S3-compatible storage, and other cloud remotes.

## Weekly operating procedure

1. Confirm the Supabase project is linked.
2. Run `npm run backup:db`.
3. Verify that the zip archive exists under `backups/`.
4. If offsite upload is configured, confirm the archive appears in S3 or the configured `rclone` remote.
5. Retain at least 12 weekly backups and one monthly restore-tested backup.

For a dry run that prints commands without creating files:

```powershell
npm run backup:db -- -DryRun
```

## Scheduling

On Windows, schedule the command below in Task Scheduler to run every week:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\Administrator\Desktop\Libriofy\scripts\backup-db.ps1
```

On Linux or a CI runner, execute the same PowerShell script with `pwsh` or call the equivalent `npm run backup:db`.

## Restore procedure

### First choice: Supabase restore

If the issue affects the whole production database, restore from the latest Supabase automatic backup or point-in-time recovery in the Supabase dashboard.

### Second choice: manual export restore

1. Extract the required backup zip.
2. Set the target connection string:

```powershell
$env:RESTORE_DB_URL="postgresql://postgres:password@host:5432/postgres"
```

3. Restore schema and data:

```powershell
npm run restore:db -- -BackupDir .\backups\libriofy-YYYYMMDD-HHMMSS
```

The restore script requires `psql` from PostgreSQL client tools. Always test the restore on a staging database before production.

## Tooling requirements

- Node.js and `npx`
- Supabase CLI for exports
- AWS CLI if `BACKUP_S3_URI` is used
- `rclone` if `BACKUP_RCLONE_REMOTE` is used
- PostgreSQL client tools if manual restore is required
