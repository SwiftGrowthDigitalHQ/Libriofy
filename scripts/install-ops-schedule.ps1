param(
  [string]$EnvFile = ".env.ops",
  [string]$DailyBackupTime = "02:00",
  [string]$HealthCheckTime = "07:00",
  [string]$MonthlyRestoreTime = "04:00",
  [int]$MonthlyRestoreDay = 1,
  [string]$TaskPrefix = "Libriofy",
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "ops-common.ps1")

function Register-ScheduledCommand {
  param(
    [string]$TaskName,
    [string[]]$Arguments
  )

  $createArgs = @("/Create", "/TN", $TaskName) + $Arguments

  if ($Force) {
    $createArgs += "/F"
  }

  Invoke-External -Channel "schedule" -FilePath "schtasks.exe" -Arguments $createArgs
}

$projectRoot = Get-ProjectRoot -ScriptRoot $PSScriptRoot
$resolvedEnvFile = Resolve-OptionalPath -Path $EnvFile -BasePath $projectRoot

Assert-Command -Name "schtasks.exe" -InstallHint "This scheduler installer requires Windows Task Scheduler."
Assert-Command -Name "powershell.exe" -InstallHint "PowerShell is required to register Windows tasks."

if (-not (Test-Path -LiteralPath $resolvedEnvFile)) {
  throw "Ops environment file was not found: $resolvedEnvFile. Create .env.ops from .env.ops.example before registering scheduled tasks."
}

$backupScript = Join-Path $projectRoot "scripts\backup-db.ps1"
$monitorScript = Join-Path $projectRoot "scripts\monitor-backup-health.ps1"
$restoreDrillScript = Join-Path $projectRoot "scripts\run-restore-drill.ps1"

$backupCommand = ('powershell.exe -ExecutionPolicy Bypass -File "{0}" -EnvFile "{1}" -RequireOffsiteTarget' -f $backupScript, $resolvedEnvFile)
$monitorCommand = ('powershell.exe -ExecutionPolicy Bypass -File "{0}" -EnvFile "{1}"' -f $monitorScript, $resolvedEnvFile)
$restoreDrillCommand = ('powershell.exe -ExecutionPolicy Bypass -File "{0}" -EnvFile "{1}" -UseLatestBackup' -f $restoreDrillScript, $resolvedEnvFile)

Register-ScheduledCommand -TaskName ("{0}-DailyBackup" -f $TaskPrefix) -Arguments @(
  "/SC", "DAILY",
  "/ST", $DailyBackupTime,
  "/TR", $backupCommand
)

Register-ScheduledCommand -TaskName ("{0}-BackupHealthCheck" -f $TaskPrefix) -Arguments @(
  "/SC", "DAILY",
  "/ST", $HealthCheckTime,
  "/TR", $monitorCommand
)

Register-ScheduledCommand -TaskName ("{0}-MonthlyRestoreDrill" -f $TaskPrefix) -Arguments @(
  "/SC", "MONTHLY",
  "/D", $MonthlyRestoreDay.ToString(),
  "/ST", $MonthlyRestoreTime,
  "/TR", $restoreDrillCommand
)

Write-OpsStep -Channel "schedule" -Message "Registered daily backup, backup health check, and monthly restore drill tasks."
