param(
  [string]$EnvFile = $env:OPS_ENV_FILE,
  [string]$LogDir = "backups/logs",
  [string]$Owner,
  [double]$MaxBackupAgeHours = 26,
  [double]$MaxRestoreDrillAgeDays = 35,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "ops-common.ps1")

$projectRoot = Get-ProjectRoot -ScriptRoot $PSScriptRoot
$resolvedEnvFile = Resolve-OptionalPath -Path $EnvFile -BasePath $projectRoot
Import-EnvFile -Path $resolvedEnvFile

$resolvedOwner = Resolve-SystemOwner -Owner $Owner
$logsRoot = Join-Path $projectRoot $LogDir
$monitorLogPath = Join-Path $logsRoot "backup-monitor-log.jsonl"
$monitorStatusPath = Join-Path $logsRoot "latest-backup-monitor-status.json"
$backupLogPath = Join-Path $logsRoot "backup-log.jsonl"
$restoreDrillLogPath = Join-Path $logsRoot "restore-drill-log.jsonl"
$nowUtc = (Get-Date).ToUniversalTime()

try {
  Ensure-Directory -Path $logsRoot | Out-Null

  $backupEntries = Read-JsonLinesFile -Path $backupLogPath
  $restoreDrillEntries = Read-JsonLinesFile -Path $restoreDrillLogPath

  $latestSuccessfulBackup = $backupEntries |
    Where-Object { $_.status -eq "success" } |
    Sort-Object { [DateTime]$_.completed_at_utc } -Descending |
    Select-Object -First 1

  $latestSuccessfulRestoreDrill = $restoreDrillEntries |
    Where-Object { $_.status -eq "success" } |
    Sort-Object { [DateTime]$_.completed_at_utc } -Descending |
    Select-Object -First 1

  $issues = New-Object System.Collections.ArrayList
  $backupAgeHours = $null
  $restoreDrillAgeDays = $null

  if (-not $latestSuccessfulBackup) {
    [void]$issues.Add("No successful backup has been recorded.")
  } else {
    $backupAgeHours = [math]::Round(($nowUtc - ([DateTime]$latestSuccessfulBackup.completed_at_utc).ToUniversalTime()).TotalHours, 2)
    if ($backupAgeHours -gt $MaxBackupAgeHours) {
      [void]$issues.Add(("Latest successful backup is {0} hours old, which exceeds the {1}-hour threshold." -f $backupAgeHours, $MaxBackupAgeHours))
    }
  }

  if (-not $latestSuccessfulRestoreDrill) {
    [void]$issues.Add("No successful monthly restore drill has been recorded.")
  } else {
    $restoreDrillAgeDays = [math]::Round(($nowUtc - ([DateTime]$latestSuccessfulRestoreDrill.completed_at_utc).ToUniversalTime()).TotalDays, 2)
    if ($restoreDrillAgeDays -gt $MaxRestoreDrillAgeDays) {
      [void]$issues.Add(("Latest successful restore drill is {0} days old, which exceeds the {1}-day threshold." -f $restoreDrillAgeDays, $MaxRestoreDrillAgeDays))
    }
  }

  if ($issues.Count -gt 0) {
    $message = [string]::Join(" ", @($issues))

    if (-not $DryRun) {
      Send-OpsAlert `
        -Severity "critical" `
        -Title "Libriofy backup health check failed" `
        -Message $message `
        -Owner $resolvedOwner `
        -Metadata @{
          operation = "backup_health_check"
          backup_age_hours = $backupAgeHours
          restore_drill_age_days = $restoreDrillAgeDays
        } `
        -LogsRoot $logsRoot | Out-Null
    }

    $failureEntry = [ordered]@{
      operation = "backup_health_check"
      status = if ($DryRun) { "dry_run_failure" } else { "failed" }
      owner = $resolvedOwner
      checked_at_utc = $nowUtc.ToString("o")
      backup_age_hours = $backupAgeHours
      restore_drill_age_days = $restoreDrillAgeDays
      issues = @($issues)
    }

    if (-not $DryRun) {
      Write-JsonLine -Path $monitorLogPath -Entry $failureEntry
      Write-JsonFile -Path $monitorStatusPath -Entry $failureEntry
    }

    throw $message
  }

  $successEntry = [ordered]@{
    operation = "backup_health_check"
    status = if ($DryRun) { "dry_run_success" } else { "success" }
    owner = $resolvedOwner
    checked_at_utc = $nowUtc.ToString("o")
    latest_backup_completed_at_utc = $latestSuccessfulBackup.completed_at_utc
    latest_restore_drill_completed_at_utc = $latestSuccessfulRestoreDrill.completed_at_utc
    backup_age_hours = $backupAgeHours
    restore_drill_age_days = $restoreDrillAgeDays
  }

  if (-not $DryRun) {
    Write-JsonLine -Path $monitorLogPath -Entry $successEntry
    Write-JsonFile -Path $monitorStatusPath -Entry $successEntry
  }

  Write-OpsStep -Channel "monitor" -Message "Backup health is within the configured thresholds."
} catch {
  if ($DryRun) {
    throw
  }

  throw
}
