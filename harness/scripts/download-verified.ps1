#Requires -Version 5.1
<#
.SYNOPSIS
  Download a file from a URL (optionally through a mirror prefix) and verify its SHA-256.

.DESCRIPTION
  Mirrors are only transport. The hash recorded upstream is the source of truth:
  the file is downloaded to a temp path, hashed, and only moved into place when it matches.
  On mismatch the temp file is deleted and the next mirror is tried.

  Verified real-world use (2026-10-28): Qwen3-VL-2B-Instruct GGUF from hf-mirror.com,
  llama.cpp Windows builds through https://gh-proxy.com/ + the GitHub release URL.

.PARAMETER Url
  Canonical upstream URL. For GitHub releases this is the plain github.com URL.

.PARAMETER OutFile
  Final destination. Parent directory is created when missing.

.PARAMETER Sha256
  Expected SHA-256 (hex, case-insensitive). Get it from the HF mirror API (?blobs=true -> lfs.sha256)
  or the GitHub releases API (assets[].digest).

.PARAMETER Mirrors
  Prefixes applied to Url in order, e.g. 'https://gh-proxy.com/'. Use '' for direct.

.EXAMPLE
  .\download-verified.ps1 -Url "https://github.com/ggml-org/llama.cpp/releases/download/b11946/llama-b11946-bin-win-cuda-13.4-x64.zip" `
    -OutFile "D:\llama.zip" -Sha256 "5ac28ef7..." -Mirrors @("https://gh-proxy.com/")
#>
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [Parameter(Mandatory = $true)][string]$Sha256,
  [string[]]$Mirrors = @(''),
  [int]$Retries = 2
)

$ErrorActionPreference = 'Stop'
$expected = $Sha256.Trim().ToUpperInvariant()

function Get-Sha256([string]$path) {
  (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToUpperInvariant()
}

if (Test-Path -LiteralPath $OutFile) {
  if ((Get-Sha256 $OutFile) -eq $expected) {
    Write-Host "[skip] already present and verified: $OutFile"
    exit 0
  }
  Write-Host "[warn] existing file has a different hash, re-downloading: $OutFile"
}

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
$tmp = "$OutFile.part"

foreach ($mirror in $Mirrors) {
  $target = if ([string]::IsNullOrWhiteSpace($mirror)) { $Url } else { $mirror.TrimEnd('/') + '/' + $Url }
  for ($i = 1; $i -le $Retries; $i++) {
    Write-Host "[get ] $target (attempt $i/$Retries)"
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    try {
      & curl.exe -L --fail --silent --show-error --retry 2 --retry-delay 3 -o $tmp $target
      if ($LASTEXITCODE -ne 0) { throw "curl exit code $LASTEXITCODE" }
      if (-not (Test-Path -LiteralPath $tmp)) { throw 'no output file' }

      $actual = Get-Sha256 $tmp
      if ($actual -ne $expected) {
        Remove-Item -LiteralPath $tmp -Force
        Write-Host "[FAIL] hash mismatch"
        Write-Host "       expected $expected"
        Write-Host "       actual   $actual"
        break   # this mirror serves bad bytes; try the next one
      }

      Move-Item -LiteralPath $tmp -Destination $OutFile -Force
      $bytes = (Get-Item -LiteralPath $OutFile).Length
      $size = if ($bytes -ge 1MB) { '{0:N1} MB' -f ($bytes / 1MB) } else { '{0:N1} KB' -f ($bytes / 1KB) }
      Write-Host "[ ok ] verified $actual  ($size) -> $OutFile"
      exit 0
    }
    catch {
      Write-Host "[err ] $($_.Exception.Message)"
      if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
      Start-Sleep -Seconds 2
    }
  }
}

Write-Host '[FAIL] every mirror and attempt failed; nothing was written to the destination'
exit 1
