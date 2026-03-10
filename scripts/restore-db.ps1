param(
  [string]$BackupDir,
  [string]$SchemaPath,
  [string]$DataPath,
  [string]$DbUrl = $env:RESTORE_DB_URL,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)

  Write-Host "[restore] $Message"
}

function Assert-Command {
  param(
    [string]$Name,
    [string]$InstallHint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found. $InstallHint"
  }
}

function Invoke-External {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  $display = @($FilePath) + ($Arguments | ForEach-Object {
      if ($_ -match "\s") {
        '"{0}"' -f $_
      } else {
        $_
      }
    })

  Write-Step ("Running: " + ($display -join " "))

  if ($DryRun) {
    return
  }

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw ("Command failed with exit code {0}: {1}" -f $LASTEXITCODE, $FilePath)
  }
}

if ($BackupDir) {
  $resolvedBackupDir = Resolve-Path $BackupDir

  if (-not $SchemaPath) {
    $SchemaPath = Join-Path $resolvedBackupDir "schema.sql"
  }

  if (-not $DataPath) {
    $DataPath = Join-Path $resolvedBackupDir "data.sql"
  }
}

if (-not $SchemaPath -or -not $DataPath) {
  throw "Provide -BackupDir or both -SchemaPath and -DataPath."
}

if (-not $DbUrl) {
  throw "Set RESTORE_DB_URL or pass -DbUrl with the target Postgres connection string."
}

$resolvedSchemaPath = Resolve-Path $SchemaPath
$resolvedDataPath = Resolve-Path $DataPath

if (-not $DryRun) {
  Assert-Command -Name "psql" -InstallHint "Install PostgreSQL client tools and ensure psql is available."
}

Write-Step "Restoring schema. Use a staging database first before production."
Invoke-External -FilePath "psql" -Arguments @($DbUrl, "-v", "ON_ERROR_STOP=1", "-f", $resolvedSchemaPath)

Write-Step "Restoring table data."
Invoke-External -FilePath "psql" -Arguments @($DbUrl, "-v", "ON_ERROR_STOP=1", "-f", $resolvedDataPath)

Write-Step "Restore complete."
