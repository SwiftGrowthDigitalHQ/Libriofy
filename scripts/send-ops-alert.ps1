param(
  [string]$Severity = "info",
  [string]$Title = "Libriofy ops alert test",
  [string]$Message = "Manual alert test from Libriofy operations tooling.",
  [string]$EnvFile = $env:OPS_ENV_FILE,
  [string]$Owner,
  [string]$LogDir = "backups/logs",
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "ops-common.ps1")

$projectRoot = Get-ProjectRoot -ScriptRoot $PSScriptRoot
$resolvedEnvFile = Resolve-OptionalPath -Path $EnvFile -BasePath $projectRoot
Import-EnvFile -Path $resolvedEnvFile

$logsRoot = Join-Path $projectRoot $LogDir
Ensure-Directory -Path $logsRoot | Out-Null

$resolvedOwner = Resolve-SystemOwner -Owner $Owner
$alertRecord = Send-OpsAlert `
  -Severity $Severity `
  -Title $Title `
  -Message $Message `
  -Owner $resolvedOwner `
  -Metadata @{
    operation = "manual_alert_test"
  } `
  -LogsRoot $logsRoot `
  -DryRun:$DryRun

Write-OpsStep -Channel "alert" -Message ("Alert processed with severity '{0}'." -f $Severity)
$alertRecord | ConvertTo-Json -Depth 10
