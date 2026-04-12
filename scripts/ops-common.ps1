Set-StrictMode -Version Latest

function Write-OpsStep {
  param(
    [string]$Channel,
    [string]$Message
  )

  Write-Host ("[{0}] {1}" -f $Channel, $Message)
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

function Get-ProjectRoot {
  param([string]$ScriptRoot)

  return (Resolve-Path (Join-Path $ScriptRoot "..")).Path
}

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }

  return (Resolve-Path -LiteralPath $Path).Path
}

function Resolve-OptionalPath {
  param(
    [string]$Path,
    [string]$BasePath
  )

  if (-not $Path) {
    return $null
  }

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return $Path
  }

  return Join-Path $BasePath $Path
}

function Import-EnvFile {
  param([string]$Path)

  if (-not $Path) {
    return
  }

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Ops environment file was not found: $Path"
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()

    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $pair = $trimmed -split "=", 2
    if ($pair.Count -ne 2) {
      continue
    }

    $name = $pair[0].Trim()
    $value = $pair[1].Trim()

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Resolve-SystemOwner {
  param([string]$Owner)

  foreach ($candidate in @($Owner, $env:OPS_OWNER_NAME, $env:BACKUP_SYSTEM_OWNER, "system-owner")) {
    if ($candidate -and $candidate.Trim()) {
      return $candidate.Trim()
    }
  }

  return "system-owner"
}

function Get-UtcTimestamp {
  return (Get-Date).ToUniversalTime().ToString("o")
}

function Get-BooleanFromString {
  param(
    [string]$Value,
    [bool]$Default = $false
  )

  if (-not $Value) {
    return $Default
  }

  return @("1", "true", "yes", "on") -contains $Value.Trim().ToLowerInvariant()
}

function Format-CommandDisplay {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  $display = @($FilePath)

  foreach ($argument in $Arguments) {
    if ($null -eq $argument) {
      continue
    }

    if ($argument -match "\s") {
      $display += ('"{0}"' -f $argument)
    } else {
      $display += $argument
    }
  }

  return $display -join " "
}

function Invoke-External {
  param(
    [string]$Channel,
    [string]$FilePath,
    [string[]]$Arguments,
    [switch]$DryRun
  )

  Write-OpsStep -Channel $Channel -Message ("Running: " + (Format-CommandDisplay -FilePath $FilePath -Arguments $Arguments))

  if ($DryRun) {
    return
  }

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw ("Command failed with exit code {0}: {1}" -f $LASTEXITCODE, $FilePath)
  }
}

function Invoke-ExternalCapture {
  param(
    [string]$Channel,
    [string]$FilePath,
    [string[]]$Arguments,
    [switch]$DryRun
  )

  Write-OpsStep -Channel $Channel -Message ("Running: " + (Format-CommandDisplay -FilePath $FilePath -Arguments $Arguments))

  if ($DryRun) {
    return ""
  }

  $output = & $FilePath @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $rendered = (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()

  if ($exitCode -ne 0) {
    throw ("Command failed with exit code {0}: {1}`n{2}" -f $exitCode, $FilePath, $rendered)
  }

  return $rendered
}

function Write-JsonLine {
  param(
    [string]$Path,
    $Entry
  )

  $directory = Split-Path -Parent $Path
  if ($directory) {
    Ensure-Directory -Path $directory | Out-Null
  }

  $jsonLine = $Entry | ConvertTo-Json -Depth 12 -Compress
  Add-Content -LiteralPath $Path -Value $jsonLine -Encoding utf8
}

function Write-JsonFile {
  param(
    [string]$Path,
    $Entry
  )

  $directory = Split-Path -Parent $Path
  if ($directory) {
    Ensure-Directory -Path $directory | Out-Null
  }

  $Entry | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Read-JsonLinesFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }

  $items = New-Object System.Collections.ArrayList

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed) {
      continue
    }

    [void]$items.Add(($trimmed | ConvertFrom-Json))
  }

  return @($items)
}

function Get-FileSha256 {
  param([string]$Path)

  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-FileSizeBytes {
  param([string]$Path)

  return [int64](Get-Item -LiteralPath $Path).Length
}

function Test-BackupArchive {
  param(
    [string]$ArchivePath,
    [Int64]$MinimumBytes = 1024,
    [string[]]$RequiredEntries = @("schema.sql", "data.sql", "manifest.json")
  )

  if (-not (Test-Path -LiteralPath $ArchivePath)) {
    throw "Backup archive was not found: $ArchivePath"
  }

  $archiveSizeBytes = Get-FileSizeBytes -Path $ArchivePath
  if ($archiveSizeBytes -lt $MinimumBytes) {
    throw ("Backup archive is too small: {0} bytes (minimum {1})." -f $archiveSizeBytes, $MinimumBytes)
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)

  try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })
    foreach ($requiredEntry in $RequiredEntries) {
      if ($entryNames -notcontains $requiredEntry) {
        throw "Backup archive is missing required entry '$requiredEntry'."
      }
    }
  } finally {
    $archive.Dispose()
  }

  return [ordered]@{
    archive_path = $ArchivePath
    size_bytes = $archiveSizeBytes
    sha256 = Get-FileSha256 -Path $ArchivePath
    required_entries = $RequiredEntries
    verified_at_utc = Get-UtcTimestamp
  }
}

function Get-LatestBackupArchive {
  param([string]$BackupRoot)

  if (-not (Test-Path -LiteralPath $BackupRoot)) {
    throw "Backup root does not exist: $BackupRoot"
  }

  $latestArchive = Get-ChildItem -LiteralPath $BackupRoot -Filter "libriofy-*.zip" -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

  if (-not $latestArchive) {
    throw "No backup archive matching 'libriofy-*.zip' was found in $BackupRoot"
  }

  return $latestArchive.FullName
}

function Send-FileToSupabaseStorage {
  param(
    [string]$SupabaseUrl,
    [string]$ServiceRoleKey,
    [string]$Bucket,
    [string]$ObjectPath,
    [string]$FilePath,
    [switch]$DryRun
  )

  if (-not $SupabaseUrl -or -not $ServiceRoleKey -or -not $Bucket -or -not $ObjectPath) {
    throw "Supabase storage upload requires Supabase URL, service role key, bucket, and object path."
  }

  $encodedObjectPath = (($ObjectPath -split "/") | ForEach-Object {
      [System.Uri]::EscapeDataString($_)
    }) -join "/"

  $targetUrl = "{0}/storage/v1/object/{1}/{2}" -f $SupabaseUrl.TrimEnd("/"), $Bucket, $encodedObjectPath
  $headers = @{
    Authorization = "Bearer $ServiceRoleKey"
    apikey = $ServiceRoleKey
    "x-upsert" = "true"
  }

  if ($DryRun) {
    return @{
      status = "dry_run"
      destination = $targetUrl
    }
  }

  Invoke-RestMethod -Method Post -Uri $targetUrl -Headers $headers -InFile $FilePath -ContentType "application/zip" | Out-Null

  return @{
    status = "uploaded"
    destination = $targetUrl
  }
}

function Send-SmtpAlertMessage {
  param(
    [string]$Subject,
    [string]$Body,
    [string]$HostName,
    [int]$Port,
    [string]$Username,
    [string]$Password,
    [string]$From,
    [string]$To,
    [bool]$UseSsl = $true
  )

  $message = New-Object System.Net.Mail.MailMessage
  $message.From = $From

  foreach ($recipient in ($To -split "[,;]" | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    [void]$message.To.Add($recipient)
  }

  $message.Subject = $Subject
  $message.Body = $Body

  $client = New-Object System.Net.Mail.SmtpClient($HostName, $Port)
  $client.EnableSsl = $UseSsl

  if ($Username) {
    $client.Credentials = New-Object System.Net.NetworkCredential($Username, $Password)
  }

  try {
    $client.Send($message)
  } finally {
    $message.Dispose()
    $client.Dispose()
  }
}

function Send-OpsAlert {
  param(
    [string]$Severity,
    [string]$Title,
    [string]$Message,
    [string]$Owner,
    [hashtable]$Metadata,
    [string]$LogsRoot,
    [switch]$DryRun
  )

  $resolvedOwner = Resolve-SystemOwner -Owner $Owner
  $timestampUtc = Get-UtcTimestamp
  $channels = New-Object System.Collections.ArrayList

  $webhookUrl = $env:OPS_ALERT_WEBHOOK_URL
  if ($webhookUrl) {
    try {
      $payload = [ordered]@{
        severity = $Severity
        title = $Title
        message = $Message
        owner = $resolvedOwner
        timestamp_utc = $timestampUtc
        metadata = $Metadata
      }

      if (-not $DryRun) {
        Invoke-RestMethod -Method Post -Uri $webhookUrl -Body ($payload | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
      }

      [void]$channels.Add([ordered]@{
          channel = "webhook"
          status = if ($DryRun) { "dry_run" } else { "sent" }
          destination = $webhookUrl
        })
    } catch {
      [void]$channels.Add([ordered]@{
          channel = "webhook"
          status = "failed"
          destination = $webhookUrl
          error = $_.Exception.Message
        })
    }
  }

  $smtpHost = $env:OPS_ALERT_SMTP_HOST
  $smtpPort = if ($env:OPS_ALERT_SMTP_PORT) { [int]$env:OPS_ALERT_SMTP_PORT } else { 587 }
  $smtpUser = $env:OPS_ALERT_SMTP_USERNAME
  $smtpPassword = $env:OPS_ALERT_SMTP_PASSWORD
  $smtpFrom = $env:OPS_ALERT_EMAIL_FROM
  $smtpTo = $env:OPS_ALERT_EMAIL_TO

  if ($smtpHost -and $smtpFrom -and $smtpTo) {
    try {
      if (-not $DryRun) {
        Send-SmtpAlertMessage `
          -Subject ("[Libriofy][$Severity] $Title") `
          -Body $Message `
          -HostName $smtpHost `
          -Port $smtpPort `
          -Username $smtpUser `
          -Password $smtpPassword `
          -From $smtpFrom `
          -To $smtpTo `
          -UseSsl (Get-BooleanFromString -Value $env:OPS_ALERT_SMTP_USE_SSL -Default $true)
      }

      [void]$channels.Add([ordered]@{
          channel = "email"
          status = if ($DryRun) { "dry_run" } else { "sent" }
          destination = $smtpTo
        })
    } catch {
      [void]$channels.Add([ordered]@{
          channel = "email"
          status = "failed"
          destination = $smtpTo
          error = $_.Exception.Message
        })
    }
  }

  $twilioSid = if ($env:OPS_ALERT_TWILIO_ACCOUNT_SID) { $env:OPS_ALERT_TWILIO_ACCOUNT_SID } else { $env:TWILIO_ACCOUNT_SID }
  $twilioToken = if ($env:OPS_ALERT_TWILIO_AUTH_TOKEN) { $env:OPS_ALERT_TWILIO_AUTH_TOKEN } else { $env:TWILIO_AUTH_TOKEN }
  $twilioFrom = if ($env:OPS_ALERT_TWILIO_FROM) { $env:OPS_ALERT_TWILIO_FROM } else { $null }
  $twilioTo = $env:OPS_ALERT_TWILIO_TO

  if ($twilioSid -and $twilioToken -and $twilioFrom -and $twilioTo) {
    try {
      $twilioUri = "https://api.twilio.com/2010-04-01/Accounts/$twilioSid/Messages.json"
      $basicToken = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(("{0}:{1}" -f $twilioSid, $twilioToken)))
      $headers = @{
        Authorization = "Basic $basicToken"
      }
      $body = @{
        From = $twilioFrom
        To = $twilioTo
        Body = "[Libriofy][$Severity] $Title`n$Message"
      }

      if (-not $DryRun) {
        Invoke-RestMethod -Method Post -Uri $twilioUri -Headers $headers -Body $body | Out-Null
      }

      [void]$channels.Add([ordered]@{
          channel = "twilio"
          status = if ($DryRun) { "dry_run" } else { "sent" }
          destination = $twilioTo
        })
    } catch {
      [void]$channels.Add([ordered]@{
          channel = "twilio"
          status = "failed"
          destination = $twilioTo
          error = $_.Exception.Message
        })
    }
  }

  $record = [ordered]@{
    timestamp_utc = $timestampUtc
    severity = $Severity
    title = $Title
    message = $Message
    owner = $resolvedOwner
    metadata = $Metadata
    channels = @($channels)
  }

  if ($LogsRoot) {
    Write-JsonLine -Path (Join-Path $LogsRoot "alerts-log.jsonl") -Entry $record
    Write-JsonFile -Path (Join-Path $LogsRoot "latest-alert-status.json") -Entry $record
  }

  return $record
}
