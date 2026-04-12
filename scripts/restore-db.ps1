param(
  [string]$BackupPath,
  [string]$BackupDir,
  [string]$BackupName,
  [string]$BackupRoot = "backups",
  [string]$SchemaPath,
  [string]$DataPath,
  [string]$DbUrl,
  [string]$StagingDbUrl,
  [string]$Target = "production",
  [string]$EnvFile = $env:OPS_ENV_FILE,
  [string]$Owner,
  [string]$LogDir,
  [string]$TemporaryExtractRoot,
  [switch]$UseLatestBackup,
  [switch]$Force,
  [switch]$SkipPostRestoreValidation,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "ops-common.ps1")

function Resolve-BackupSource {
  param(
    [string]$ProjectRoot,
    [string]$BackupPathInput,
    [string]$BackupDirInput,
    [string]$BackupNameInput,
    [string]$BackupRootInput,
    [switch]$UseLatest
  )

  if ($BackupPathInput) {
    return (Resolve-Path -LiteralPath (Resolve-OptionalPath -Path $BackupPathInput -BasePath $ProjectRoot)).Path
  }

  if ($BackupDirInput) {
    return (Resolve-Path -LiteralPath (Resolve-OptionalPath -Path $BackupDirInput -BasePath $ProjectRoot)).Path
  }

  $resolvedBackupRoot = Resolve-OptionalPath -Path $BackupRootInput -BasePath $ProjectRoot

  if ($UseLatest) {
    return Get-LatestBackupArchive -BackupRoot $resolvedBackupRoot
  }

  if ($BackupNameInput) {
    $candidateArchive = Join-Path $resolvedBackupRoot ("{0}.zip" -f $BackupNameInput)
    if (Test-Path -LiteralPath $candidateArchive) {
      return (Resolve-Path -LiteralPath $candidateArchive).Path
    }

    $candidateDirectory = Join-Path $resolvedBackupRoot $BackupNameInput
    if (Test-Path -LiteralPath $candidateDirectory) {
      return (Resolve-Path -LiteralPath $candidateDirectory).Path
    }
  }

  return $null
}

$projectRoot = Get-ProjectRoot -ScriptRoot $PSScriptRoot
$resolvedEnvFile = Resolve-OptionalPath -Path $EnvFile -BasePath $projectRoot
Import-EnvFile -Path $resolvedEnvFile

if (-not $LogDir) {
  $LogDir = "backups/logs"
}

if (-not $DbUrl) {
  $DbUrl = $env:RESTORE_DB_URL
}

if (-not $StagingDbUrl) {
  if ($env:RESTORE_STAGING_DB_URL) {
    $StagingDbUrl = $env:RESTORE_STAGING_DB_URL
  } else {
    $StagingDbUrl = $env:RESTORE_DRILL_DB_URL
  }
}

$ownerName = Resolve-SystemOwner -Owner $Owner
$resolvedLogDir = Join-Path $projectRoot $LogDir
$restoreLogPath = Join-Path $resolvedLogDir "restore-log.jsonl"
$restoreStatusPath = Join-Path $resolvedLogDir "latest-restore-status.json"
$startTimeUtc = (Get-Date).ToUniversalTime()
$resolvedBackupSource = $null
$resolvedSchemaPath = $null
$resolvedDataPath = $null
$resolvedManifestPath = $null
$cleanupDirectory = $null
$backupDescriptor = "manual-sql-files"
$validation = $null

try {
  $targetKey = $Target.Trim().ToLowerInvariant()
  $targetDbUrl = $DbUrl

  if ($targetKey.StartsWith("staging")) {
    $targetDbUrl = $StagingDbUrl
  }

  if (-not $targetDbUrl) {
    throw "Set RESTORE_DB_URL for production restores or RESTORE_STAGING_DB_URL for staging drills."
  }

  if ($targetKey -eq "production" -and -not $Force) {
    throw "Production restore requires -Force to avoid accidental execution."
  }

  if ($BackupDir -and -not $SchemaPath) {
    $SchemaPath = Join-Path $BackupDir "schema.sql"
  }

  if ($BackupDir -and -not $DataPath) {
    $DataPath = Join-Path $BackupDir "data.sql"
  }

  if (-not $SchemaPath -or -not $DataPath) {
    $resolvedBackupSource = Resolve-BackupSource `
      -ProjectRoot $projectRoot `
      -BackupPathInput $BackupPath `
      -BackupDirInput $BackupDir `
      -BackupNameInput $BackupName `
      -BackupRootInput $BackupRoot `
      -UseLatest:$UseLatestBackup

    if (-not $resolvedBackupSource) {
      throw "Provide -BackupPath, -BackupDir, -BackupName, -UseLatestBackup, or both -SchemaPath and -DataPath."
    }

    $backupItem = Get-Item -LiteralPath $resolvedBackupSource
    $backupDescriptor = if ($backupItem.PSIsContainer) { $backupItem.Name } else { [System.IO.Path]::GetFileNameWithoutExtension($backupItem.Name) }

    if ($backupItem.PSIsContainer) {
      $resolvedSchemaPath = Join-Path $resolvedBackupSource "schema.sql"
      $resolvedDataPath = Join-Path $resolvedBackupSource "data.sql"
      $resolvedManifestPath = Join-Path $resolvedBackupSource "manifest.json"
    } elseif ($backupItem.Extension -ieq ".zip") {
      if (-not $TemporaryExtractRoot) {
        $TemporaryExtractRoot = [System.IO.Path]::GetTempPath()
      } else {
        $TemporaryExtractRoot = Resolve-OptionalPath -Path $TemporaryExtractRoot -BasePath $projectRoot
      }

      $resolvedTempRoot = Ensure-Directory -Path $TemporaryExtractRoot
      $cleanupDirectory = Join-Path $resolvedTempRoot ("libriofy-restore-" + [guid]::NewGuid().ToString("N"))
      Ensure-Directory -Path $cleanupDirectory | Out-Null

      Write-OpsStep -Channel "restore" -Message ("Extracting backup archive to {0}" -f $cleanupDirectory)
      if (-not $DryRun) {
        Expand-Archive -LiteralPath $resolvedBackupSource -DestinationPath $cleanupDirectory -Force
      }

      $resolvedSchemaPath = Join-Path $cleanupDirectory "schema.sql"
      $resolvedDataPath = Join-Path $cleanupDirectory "data.sql"
      $resolvedManifestPath = Join-Path $cleanupDirectory "manifest.json"
    } else {
      throw "BackupPath must point to a backup directory or a .zip archive."
    }
  } else {
    $resolvedSchemaPath = (Resolve-Path -LiteralPath (Resolve-OptionalPath -Path $SchemaPath -BasePath $projectRoot)).Path
    $resolvedDataPath = (Resolve-Path -LiteralPath (Resolve-OptionalPath -Path $DataPath -BasePath $projectRoot)).Path
    $backupDescriptor = Split-Path -Leaf (Split-Path -Parent $resolvedSchemaPath)
  }

  if (-not $DryRun) {
    Ensure-Directory -Path $resolvedLogDir | Out-Null
    Assert-Command -Name "psql" -InstallHint "Install PostgreSQL client tools and ensure psql is available."
  }

  if (-not $resolvedSchemaPath -or -not $resolvedDataPath) {
    throw "Resolved backup files are missing."
  }

  if (-not $DryRun) {
    $resolvedSchemaPath = (Resolve-Path -LiteralPath $resolvedSchemaPath).Path
    $resolvedDataPath = (Resolve-Path -LiteralPath $resolvedDataPath).Path

    if (-not (Test-Path -LiteralPath $resolvedSchemaPath)) {
      throw "Schema file was not found: $resolvedSchemaPath"
    }

    if (-not (Test-Path -LiteralPath $resolvedDataPath)) {
      throw "Data file was not found: $resolvedDataPath"
    }

    if ($resolvedManifestPath -and (Test-Path -LiteralPath $resolvedManifestPath)) {
      $resolvedManifestPath = (Resolve-Path -LiteralPath $resolvedManifestPath).Path
    } else {
      $resolvedManifestPath = $null
    }
  }

  Write-OpsStep -Channel "restore" -Message ("Restoring '{0}' into target '{1}'" -f $backupDescriptor, $Target)
  Invoke-External -Channel "restore" -FilePath "psql" -Arguments @($targetDbUrl, "-v", "ON_ERROR_STOP=1", "-f", $resolvedSchemaPath) -DryRun:$DryRun

  Write-OpsStep -Channel "restore" -Message "Restoring table data."
  Invoke-External -Channel "restore" -FilePath "psql" -Arguments @($targetDbUrl, "-v", "ON_ERROR_STOP=1", "-f", $resolvedDataPath) -DryRun:$DryRun

  if ($DryRun) {
    Write-OpsStep -Channel "restore" -Message "Dry run complete. No restore was executed."
    return
  }

  if (-not $SkipPostRestoreValidation) {
    $requiredTables = @("libraries", "students", "user_roles", "attendance_logs")
    $requiredTableValues = ($requiredTables | ForEach-Object { "('{0}')" -f $_ }) -join ","
    $missingTablesQuery = @"
WITH required(table_name) AS (
  VALUES $requiredTableValues
)
SELECT COALESCE(string_agg(required.table_name, ',' ORDER BY required.table_name), '')
FROM required
LEFT JOIN information_schema.tables AS tables
  ON tables.table_schema = 'public'
 AND tables.table_name = required.table_name
WHERE tables.table_name IS NULL;
"@
    $missingTables = Invoke-ExternalCapture -Channel "restore" -FilePath "psql" -Arguments @($targetDbUrl, "-v", "ON_ERROR_STOP=1", "-Atqc", $missingTablesQuery)

    if ($missingTables) {
      throw ("Post-restore validation failed. Missing required public tables: {0}" -f $missingTables)
    }

    $metricsQuery = @"
SELECT json_build_object(
  'public_table_count', (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'),
  'libraries_count', (SELECT COUNT(*) FROM public.libraries),
  'students_count', (SELECT COUNT(*) FROM public.students),
  'attendance_logs_count', (SELECT COUNT(*) FROM public.attendance_logs)
)::text;
"@
    $metricsJson = Invoke-ExternalCapture -Channel "restore" -FilePath "psql" -Arguments @($targetDbUrl, "-v", "ON_ERROR_STOP=1", "-Atqc", $metricsQuery)
    $validation = $metricsJson | ConvertFrom-Json
  }

  $completedAtUtc = (Get-Date).ToUniversalTime()
  $durationSeconds = [math]::Round(($completedAtUtc - $startTimeUtc).TotalSeconds, 2)
  $successEntry = [ordered]@{
    operation = "restore"
    backup_name = $backupDescriptor
    backup_source = $resolvedBackupSource
    schema_path = $resolvedSchemaPath
    data_path = $resolvedDataPath
    manifest_path = $resolvedManifestPath
    status = "success"
    owner = $ownerName
    target = $Target
    started_at_utc = $startTimeUtc.ToString("o")
    completed_at_utc = $completedAtUtc.ToString("o")
    duration_seconds = $durationSeconds
    validation = $validation
  }

  Write-JsonLine -Path $restoreLogPath -Entry $successEntry
  Write-JsonFile -Path $restoreStatusPath -Entry $successEntry

  Write-OpsStep -Channel "restore" -Message "Restore complete."
} catch {
  $completedAtUtc = (Get-Date).ToUniversalTime()
  $durationSeconds = [math]::Round(($completedAtUtc - $startTimeUtc).TotalSeconds, 2)
  $errorMessage = $_.Exception.Message

  if (-not $DryRun) {
    Ensure-Directory -Path $resolvedLogDir | Out-Null

    $failureEntry = [ordered]@{
      operation = "restore"
      backup_name = $backupDescriptor
      backup_source = $resolvedBackupSource
      schema_path = $resolvedSchemaPath
      data_path = $resolvedDataPath
      manifest_path = $resolvedManifestPath
      status = "failed"
      owner = $ownerName
      target = $Target
      started_at_utc = $startTimeUtc.ToString("o")
      completed_at_utc = $completedAtUtc.ToString("o")
      duration_seconds = $durationSeconds
      error = $errorMessage
    }

    Write-JsonLine -Path $restoreLogPath -Entry $failureEntry
    Write-JsonFile -Path $restoreStatusPath -Entry $failureEntry

    Send-OpsAlert `
      -Severity "critical" `
      -Title "Libriofy restore failed" `
      -Message ("Restore '{0}' into target '{1}' failed. {2}" -f $backupDescriptor, $Target, $errorMessage) `
      -Owner $ownerName `
      -Metadata @{
        operation = "restore"
        backup_name = $backupDescriptor
        target = $Target
        backup_source = $resolvedBackupSource
      } `
      -LogsRoot $resolvedLogDir | Out-Null
  }

  throw
} finally {
  if ($cleanupDirectory -and (Test-Path -LiteralPath $cleanupDirectory)) {
    Remove-Item -LiteralPath $cleanupDirectory -Recurse -Force
  }
}
