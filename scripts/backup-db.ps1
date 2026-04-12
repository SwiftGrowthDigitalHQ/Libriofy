param(
  [string]$OutputDir = "backups",
  [string]$LogDir,
  [string]$EnvFile = $env:OPS_ENV_FILE,
  [string[]]$Schemas = @("public", "auth", "storage"),
  [string]$S3Uri,
  [string]$RcloneRemote,
  [string]$SupabaseStorageBucket,
  [string]$SupabaseStoragePath,
  [string]$SupabaseStorageUrl,
  [string]$SupabaseStorageServiceRoleKey,
  [string]$Owner,
  [Int64]$MinimumArchiveBytes = 1024,
  [switch]$RequireOffsiteTarget,
  [switch]$SkipOffsite,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "ops-common.ps1")

$projectRoot = Get-ProjectRoot -ScriptRoot $PSScriptRoot
$resolvedEnvFile = Resolve-OptionalPath -Path $EnvFile -BasePath $projectRoot
Import-EnvFile -Path $resolvedEnvFile

if (-not $LogDir) {
  $LogDir = Join-Path $OutputDir "logs"
}

if (-not $S3Uri) {
  $S3Uri = $env:BACKUP_S3_URI
}

if (-not $RcloneRemote) {
  $RcloneRemote = $env:BACKUP_RCLONE_REMOTE
}

if (-not $SupabaseStorageBucket) {
  $SupabaseStorageBucket = $env:BACKUP_SUPABASE_BUCKET
}

if (-not $SupabaseStoragePath) {
  $SupabaseStoragePath = if ($env:BACKUP_SUPABASE_PATH) { $env:BACKUP_SUPABASE_PATH } else { "database-backups" }
}

if (-not $SupabaseStorageUrl) {
  if ($env:BACKUP_SUPABASE_URL) {
    $SupabaseStorageUrl = $env:BACKUP_SUPABASE_URL
  } elseif ($env:SUPABASE_URL) {
    $SupabaseStorageUrl = $env:SUPABASE_URL
  } else {
    $SupabaseStorageUrl = $env:VITE_SUPABASE_URL
  }
}

if (-not $SupabaseStorageServiceRoleKey) {
  if ($env:BACKUP_SUPABASE_SERVICE_ROLE_KEY) {
    $SupabaseStorageServiceRoleKey = $env:BACKUP_SUPABASE_SERVICE_ROLE_KEY
  } else {
    $SupabaseStorageServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
  }
}

if (-not $RequireOffsiteTarget.IsPresent) {
  $RequireOffsiteTarget = [switch](Get-BooleanFromString -Value $env:BACKUP_REQUIRE_OFFSITE -Default $false)
}

$ownerName = Resolve-SystemOwner -Owner $Owner
$resolvedOutputDir = Join-Path $projectRoot $OutputDir
$resolvedLogDir = Join-Path $projectRoot $LogDir
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupName = "libriofy-$timestamp"
$workingDir = Join-Path $resolvedOutputDir $backupName
$schemaPath = Join-Path $workingDir "schema.sql"
$dataPath = Join-Path $workingDir "data.sql"
$manifestPath = Join-Path $workingDir "manifest.json"
$archivePath = Join-Path $resolvedOutputDir "$backupName.zip"
$backupLogPath = Join-Path $resolvedLogDir "backup-log.jsonl"
$backupStatusPath = Join-Path $resolvedLogDir "latest-backup-status.json"
$schemaList = @($Schemas | Where-Object { $_ -and $_.Trim() } | Select-Object -Unique)
$startTimeUtc = (Get-Date).ToUniversalTime()
$localBackupCreated = $false

if ($schemaList.Count -eq 0) {
  throw "At least one schema is required."
}

$offsiteTargetsConfigured = @($S3Uri, $RcloneRemote, $SupabaseStorageBucket) |
  Where-Object { $_ -and $_.Trim() }

if (-not $SkipOffsite -and $RequireOffsiteTarget -and $offsiteTargetsConfigured.Count -eq 0) {
  throw "At least one offsite target is required. Configure S3, rclone, or Supabase Storage."
}

try {
  Assert-Command -Name "npx" -InstallHint "Install Node.js and ensure npm/npx are available."

  if (-not $SkipOffsite) {
    if ($S3Uri) {
      Assert-Command -Name "aws" -InstallHint "Install AWS CLI or omit BACKUP_S3_URI."
    }

    if ($RcloneRemote) {
      Assert-Command -Name "rclone" -InstallHint "Install rclone or omit BACKUP_RCLONE_REMOTE."
    }
  }

  if ($SupabaseStorageBucket) {
    if (-not $SupabaseStorageUrl -or -not $SupabaseStorageServiceRoleKey) {
      throw "Supabase Storage uploads require BACKUP_SUPABASE_URL and BACKUP_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY."
    }
  }

  if (-not $DryRun) {
    Ensure-Directory -Path $resolvedOutputDir | Out-Null
    Ensure-Directory -Path $resolvedLogDir | Out-Null
    Ensure-Directory -Path $workingDir | Out-Null
  }

  $schemaArg = [string]::Join(",", $schemaList)
  $baseArgs = @("supabase", "db", "dump", "--linked", "--schema", $schemaArg)

  Write-OpsStep -Channel "backup" -Message ("Creating schema dump for schemas: {0}" -f $schemaArg)
  Invoke-External -Channel "backup" -FilePath "npx" -Arguments ($baseArgs + @("--file", $schemaPath)) -DryRun:$DryRun

  Write-OpsStep -Channel "backup" -Message ("Creating data dump for schemas: {0}" -f $schemaArg)
  Invoke-External -Channel "backup" -FilePath "npx" -Arguments ($baseArgs + @("--data-only", "--use-copy", "--file", $dataPath)) -DryRun:$DryRun

  if ($DryRun) {
    Write-OpsStep -Channel "backup" -Message "Dry run complete. No files were created."
    return
  }

  $schemaSizeBytes = Get-FileSizeBytes -Path $schemaPath
  $dataSizeBytes = Get-FileSizeBytes -Path $dataPath

  if ($schemaSizeBytes -le 0) {
    throw "Schema dump was created but is empty."
  }

  if ($dataSizeBytes -le 0) {
    throw "Data dump was created but is empty."
  }

  $manifest = [ordered]@{
    backup_name = $backupName
    created_at_utc = Get-UtcTimestamp
    owner = $ownerName
    source = "supabase linked project"
    schemas = $schemaList
    files = @(
      [ordered]@{
        name = "schema.sql"
        purpose = "Database schema and objects"
        size_bytes = $schemaSizeBytes
      },
      [ordered]@{
        name = "data.sql"
        purpose = "Table data"
        size_bytes = $dataSizeBytes
      }
    )
    offsite_targets = [ordered]@{
      s3_uri = if ($S3Uri) { $S3Uri } else { $null }
      rclone_remote = if ($RcloneRemote) { $RcloneRemote } else { $null }
      supabase_bucket = if ($SupabaseStorageBucket) { $SupabaseStorageBucket } else { $null }
      supabase_path = if ($SupabaseStorageBucket) { $SupabaseStoragePath } else { $null }
    }
  }

  Write-JsonFile -Path $manifestPath -Entry $manifest

  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }

  Write-OpsStep -Channel "backup" -Message ("Compressing backup bundle to {0}" -f $archivePath)
  Compress-Archive -Path (Join-Path $workingDir "*") -DestinationPath $archivePath -CompressionLevel Optimal
  $localBackupCreated = $true

  $verification = Test-BackupArchive -ArchivePath $archivePath -MinimumBytes $MinimumArchiveBytes
  Write-OpsStep -Channel "backup" -Message ("Verified archive integrity. Size: {0} bytes" -f $verification.size_bytes)

  $offsiteUploads = New-Object System.Collections.ArrayList

  if (-not $SkipOffsite) {
    if ($S3Uri) {
      $s3Target = "{0}/{1}.zip" -f $S3Uri.TrimEnd("/"), $backupName
      Invoke-External -Channel "backup" -FilePath "aws" -Arguments @("s3", "cp", $archivePath, $s3Target)
      [void]$offsiteUploads.Add([ordered]@{
          target = "s3"
          destination = $s3Target
          status = "uploaded"
          completed_at_utc = Get-UtcTimestamp
        })
    }

    if ($RcloneRemote) {
      $remoteTarget = "{0}/{1}.zip" -f $RcloneRemote.TrimEnd("/"), $backupName
      Invoke-External -Channel "backup" -FilePath "rclone" -Arguments @("copyto", $archivePath, $remoteTarget)
      [void]$offsiteUploads.Add([ordered]@{
          target = "rclone"
          destination = $remoteTarget
          status = "uploaded"
          completed_at_utc = Get-UtcTimestamp
        })
    }

    if ($SupabaseStorageBucket) {
      $objectPath = ("{0}/{1}.zip" -f $SupabaseStoragePath.Trim("/"), $backupName).Trim("/")
      $supabaseUpload = Send-FileToSupabaseStorage `
        -SupabaseUrl $SupabaseStorageUrl `
        -ServiceRoleKey $SupabaseStorageServiceRoleKey `
        -Bucket $SupabaseStorageBucket `
        -ObjectPath $objectPath `
        -FilePath $archivePath

      [void]$offsiteUploads.Add([ordered]@{
          target = "supabase_storage"
          destination = $supabaseUpload.destination
          status = $supabaseUpload.status
          completed_at_utc = Get-UtcTimestamp
        })
    }
  }

  $completedAtUtc = (Get-Date).ToUniversalTime()
  $durationSeconds = [math]::Round(($completedAtUtc - $startTimeUtc).TotalSeconds, 2)

  $successEntry = [ordered]@{
    operation = "backup"
    backup_name = $backupName
    status = "success"
    owner = $ownerName
    started_at_utc = $startTimeUtc.ToString("o")
    completed_at_utc = $completedAtUtc.ToString("o")
    duration_seconds = $durationSeconds
    working_directory = $workingDir
    archive_path = $archivePath
    archive_size_bytes = $verification.size_bytes
    archive_sha256 = $verification.sha256
    schema_size_bytes = $schemaSizeBytes
    data_size_bytes = $dataSizeBytes
    schemas = $schemaList
    verification = $verification
    offsite_uploads = @($offsiteUploads)
  }

  Write-JsonLine -Path $backupLogPath -Entry $successEntry
  Write-JsonFile -Path $backupStatusPath -Entry $successEntry

  Write-OpsStep -Channel "backup" -Message "Backup complete."
  Write-OpsStep -Channel "backup" -Message ("Archive: {0}" -f $archivePath)
} catch {
  $completedAtUtc = (Get-Date).ToUniversalTime()
  $durationSeconds = [math]::Round(($completedAtUtc - $startTimeUtc).TotalSeconds, 2)
  $errorMessage = $_.Exception.Message

  if (-not $DryRun) {
    Ensure-Directory -Path $resolvedLogDir | Out-Null

    $failureEntry = [ordered]@{
      operation = "backup"
      backup_name = $backupName
      status = "failed"
      owner = $ownerName
      started_at_utc = $startTimeUtc.ToString("o")
      completed_at_utc = $completedAtUtc.ToString("o")
      duration_seconds = $durationSeconds
      working_directory = $workingDir
      archive_path = $archivePath
      local_backup_created = $localBackupCreated
      error = $errorMessage
    }

    Write-JsonLine -Path $backupLogPath -Entry $failureEntry
    Write-JsonFile -Path $backupStatusPath -Entry $failureEntry

    Send-OpsAlert `
      -Severity "critical" `
      -Title "Libriofy backup failed" `
      -Message ("Backup {0} failed. {1}" -f $backupName, $errorMessage) `
      -Owner $ownerName `
      -Metadata @{
        operation = "backup"
        backup_name = $backupName
        working_directory = $workingDir
        archive_path = $archivePath
      } `
      -LogsRoot $resolvedLogDir | Out-Null
  }

  throw
}
