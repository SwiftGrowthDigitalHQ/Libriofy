param(
  [string]$BackupPath,
  [string]$BackupName,
  [string]$BackupRoot = "backups",
  [string]$StagingDbUrl,
  [string]$EnvFile = $env:OPS_ENV_FILE,
  [string]$Owner,
  [string]$LogDir = "backups/logs",
  [switch]$UseLatestBackup,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "ops-common.ps1")

$projectRoot = Get-ProjectRoot -ScriptRoot $PSScriptRoot
$resolvedEnvFile = Resolve-OptionalPath -Path $EnvFile -BasePath $projectRoot
Import-EnvFile -Path $resolvedEnvFile

if (-not $StagingDbUrl) {
  if ($env:RESTORE_STAGING_DB_URL) {
    $StagingDbUrl = $env:RESTORE_STAGING_DB_URL
  } else {
    $StagingDbUrl = $env:RESTORE_DRILL_DB_URL
  }
}

if (-not $StagingDbUrl) {
  throw "Set RESTORE_STAGING_DB_URL or RESTORE_DRILL_DB_URL before running a restore drill."
}

$resolvedOwner = Resolve-SystemOwner -Owner $Owner
$logsRoot = Join-Path $projectRoot $LogDir
$drillLogPath = Join-Path $logsRoot "restore-drill-log.jsonl"
$drillStatusPath = Join-Path $logsRoot "latest-restore-drill-status.json"
$restoreScriptPath = Join-Path $projectRoot "scripts\restore-db.ps1"
$startTimeUtc = (Get-Date).ToUniversalTime()
$selectedBackup = $BackupPath

try {
  Ensure-Directory -Path $logsRoot | Out-Null

  if (-not $selectedBackup -and -not $BackupName -and -not $UseLatestBackup) {
    $UseLatestBackup = $true
  }

  $restoreArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $restoreScriptPath,
    "-Target", "staging-drill",
    "-StagingDbUrl", $StagingDbUrl,
    "-LogDir", $LogDir
  )

  if ($resolvedEnvFile) {
    $restoreArgs += @("-EnvFile", $resolvedEnvFile)
  }

  if ($selectedBackup) {
    $restoreArgs += @("-BackupPath", (Resolve-OptionalPath -Path $selectedBackup -BasePath $projectRoot))
  } elseif ($BackupName) {
    $restoreArgs += @("-BackupName", $BackupName, "-BackupRoot", (Resolve-OptionalPath -Path $BackupRoot -BasePath $projectRoot))
  } else {
    $restoreArgs += @("-UseLatestBackup", "-BackupRoot", (Resolve-OptionalPath -Path $BackupRoot -BasePath $projectRoot))
  }

  if ($DryRun) {
    $restoreArgs += "-DryRun"
  }

  Invoke-External -Channel "restore-drill" -FilePath "powershell" -Arguments $restoreArgs -DryRun:$DryRun

  if ($DryRun) {
    Write-OpsStep -Channel "restore-drill" -Message "Dry run complete. No drill restore was executed."
    return
  }

  $latestRestoreStatusPath = Join-Path $logsRoot "latest-restore-status.json"
  $latestRestoreStatus = Get-Content -LiteralPath $latestRestoreStatusPath -Raw | ConvertFrom-Json
  $selectedBackup = if ($latestRestoreStatus.backup_source) { $latestRestoreStatus.backup_source } else { $selectedBackup }

  $completedAtUtc = (Get-Date).ToUniversalTime()
  $durationSeconds = [math]::Round(($completedAtUtc - $startTimeUtc).TotalSeconds, 2)
  $successEntry = [ordered]@{
    operation = "restore_drill"
    status = "success"
    owner = $resolvedOwner
    target = "staging-drill"
    backup_source = $selectedBackup
    started_at_utc = $startTimeUtc.ToString("o")
    completed_at_utc = $completedAtUtc.ToString("o")
    duration_seconds = $durationSeconds
    validation = $latestRestoreStatus.validation
  }

  Write-JsonLine -Path $drillLogPath -Entry $successEntry
  Write-JsonFile -Path $drillStatusPath -Entry $successEntry

  Write-OpsStep -Channel "restore-drill" -Message "Monthly restore drill completed successfully."
} catch {
  $completedAtUtc = (Get-Date).ToUniversalTime()
  $durationSeconds = [math]::Round(($completedAtUtc - $startTimeUtc).TotalSeconds, 2)
  $errorMessage = $_.Exception.Message

  if (-not $DryRun) {
    Ensure-Directory -Path $logsRoot | Out-Null

    $failureEntry = [ordered]@{
      operation = "restore_drill"
      status = "failed"
      owner = $resolvedOwner
      target = "staging-drill"
      backup_source = $selectedBackup
      started_at_utc = $startTimeUtc.ToString("o")
      completed_at_utc = $completedAtUtc.ToString("o")
      duration_seconds = $durationSeconds
      error = $errorMessage
    }

    Write-JsonLine -Path $drillLogPath -Entry $failureEntry
    Write-JsonFile -Path $drillStatusPath -Entry $failureEntry

    Send-OpsAlert `
      -Severity "critical" `
      -Title "Libriofy monthly restore drill failed" `
      -Message ("Restore drill failed. {0}" -f $errorMessage) `
      -Owner $resolvedOwner `
      -Metadata @{
        operation = "restore_drill"
        backup_source = $selectedBackup
      } `
      -LogsRoot $logsRoot | Out-Null
  }

  throw
}
