param(
  [string]$OutputDir = "backups",
  [string[]]$Schemas = @("public", "auth", "storage"),
  [string]$S3Uri = $env:BACKUP_S3_URI,
  [string]$RcloneRemote = $env:BACKUP_RCLONE_REMOTE,
  [switch]$SkipOffsite,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)

  Write-Host "[backup] $Message"
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

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$resolvedOutputDir = Join-Path $projectRoot $OutputDir
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupName = "libriofy-$timestamp"
$workingDir = Join-Path $resolvedOutputDir $backupName
$schemaPath = Join-Path $workingDir "schema.sql"
$dataPath = Join-Path $workingDir "data.sql"
$manifestPath = Join-Path $workingDir "manifest.json"
$archivePath = Join-Path $resolvedOutputDir "$backupName.zip"
$schemaList = @($Schemas | Where-Object { $_ -and $_.Trim() } | Select-Object -Unique)

if ($schemaList.Count -eq 0) {
  throw "At least one schema is required."
}

Assert-Command -Name "npx" -InstallHint "Install Node.js and ensure npm/npx are available."

if (-not $DryRun) {
  New-Item -ItemType Directory -Path $workingDir -Force | Out-Null
}

$schemaArg = [string]::Join(",", $schemaList)
$baseArgs = @("supabase", "db", "dump", "--linked", "--schema", $schemaArg)

Write-Step "Creating schema dump for schemas: $schemaArg"
Invoke-External -FilePath "npx" -Arguments ($baseArgs + @("--file", $schemaPath))

Write-Step "Creating data dump for schemas: $schemaArg"
Invoke-External -FilePath "npx" -Arguments ($baseArgs + @("--data-only", "--use-copy", "--file", $dataPath))

if ($DryRun) {
  Write-Step "Dry run complete. No files were created."
  return
}

$manifest = [ordered]@{
  backup_name = $backupName
  created_at_utc = (Get-Date).ToUniversalTime().ToString("o")
  source = "supabase linked project"
  schemas = $schemaList
  files = @(
    [ordered]@{
      name = "schema.sql"
      purpose = "Database schema and objects"
    },
    [ordered]@{
      name = "data.sql"
      purpose = "Table data"
    }
  )
  offsite = [ordered]@{
    s3_uri = if ($S3Uri) { $S3Uri } else { $null }
    rclone_remote = if ($RcloneRemote) { $RcloneRemote } else { $null }
  }
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding utf8

if (Test-Path $archivePath) {
  Remove-Item $archivePath -Force
}

Write-Step "Compressing backup bundle to $archivePath"
Compress-Archive -Path (Join-Path $workingDir "*") -DestinationPath $archivePath -CompressionLevel Optimal

if (-not $SkipOffsite) {
  if ($S3Uri) {
    Assert-Command -Name "aws" -InstallHint "Install AWS CLI or omit BACKUP_S3_URI."
    $s3Target = "{0}/{1}.zip" -f $S3Uri.TrimEnd("/"), $backupName
    Write-Step "Uploading archive to AWS S3"
    Invoke-External -FilePath "aws" -Arguments @("s3", "cp", $archivePath, $s3Target)
  }

  if ($RcloneRemote) {
    Assert-Command -Name "rclone" -InstallHint "Install rclone or omit BACKUP_RCLONE_REMOTE."
    $remoteTarget = "{0}/{1}.zip" -f $RcloneRemote.TrimEnd("/"), $backupName
    Write-Step "Uploading archive using rclone"
    Invoke-External -FilePath "rclone" -Arguments @("copyto", $archivePath, $remoteTarget)
  }
}

Write-Step "Backup complete."
Write-Step "Working directory: $workingDir"
Write-Step "Archive: $archivePath"
