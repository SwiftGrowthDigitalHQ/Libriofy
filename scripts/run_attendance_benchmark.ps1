param(
  [string]$ConnectionString,
  [string]$SqlFile = "scripts/run_attendance_benchmark.sql",
  [string]$OutputDir = "benchmark-results",
  [string]$EnvFile = $env:OPS_ENV_FILE
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "ops-common.ps1")

$projectRoot = Get-ProjectRoot -ScriptRoot $PSScriptRoot
$resolvedEnvFile = Resolve-OptionalPath -Path $EnvFile -BasePath $projectRoot
Import-EnvFile -Path $resolvedEnvFile

$resolvedSqlFile = Resolve-OptionalPath -Path $SqlFile -BasePath $projectRoot
if (-not (Test-Path -LiteralPath $resolvedSqlFile)) {
  throw "Benchmark SQL file not found: $resolvedSqlFile"
}

if (-not $ConnectionString) {
  foreach ($candidate in @(
    $env:DATABASE_URL,
    $env:SUPABASE_DB_URL,
    $env:SUPABASE_CONNECTION_STRING,
    $env:PGDATABASE_URL
  )) {
    if ($candidate -and $candidate.Trim()) {
      $ConnectionString = $candidate.Trim()
      break
    }
  }
}

if (-not $ConnectionString) {
  throw @"
Missing database connection string.

Provide one of:
- -ConnectionString "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
- DATABASE_URL
- SUPABASE_DB_URL
- SUPABASE_CONNECTION_STRING
- PGDATABASE_URL

Use the direct PostgreSQL connection string, not the pooler string.
"@
}

Assert-Command -Name "psql" -InstallHint "Install PostgreSQL client tools and ensure psql is available."

$resolvedOutputDir = Ensure-Directory -Path (Join-Path $projectRoot $OutputDir)
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $resolvedOutputDir "attendance-benchmark-$timestamp.log"

Write-OpsStep -Channel "benchmark" -Message ("SQL file: {0}" -f $resolvedSqlFile)
Write-OpsStep -Channel "benchmark" -Message ("Log file: {0}" -f $logFile)
Write-OpsStep -Channel "benchmark" -Message "Running benchmark against the direct PostgreSQL connection."

$env:PGAPPNAME = "libriofy-attendance-benchmark"

$psqlArgs = @(
  $ConnectionString,
  "-X",
  "-v",
  "ON_ERROR_STOP=1",
  "-f",
  $resolvedSqlFile
)

& psql @psqlArgs 2>&1 | Tee-Object -FilePath $logFile
if ($LASTEXITCODE -ne 0) {
  throw "psql exited with code $LASTEXITCODE. Review the log file: $logFile"
}

Write-OpsStep -Channel "benchmark" -Message "Benchmark completed successfully."
Write-OpsStep -Channel "benchmark" -Message ("Review the captured output at {0}" -f $logFile)
