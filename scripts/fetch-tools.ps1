$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cache = Join-Path $root '.cache'
$vendor = Join-Path $root 'vendor'
$lock = Get-Content -LiteralPath (Join-Path $root 'tools-lock.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force $cache,$vendor | Out-Null
function Download([string]$url,[string]$path) {
  if (!(Test-Path -LiteralPath $path)) { Invoke-WebRequest -Uri $url -OutFile $path }
}
function Verify([string]$path,[string]$hash) {
  $stream = [IO.File]::OpenRead($path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $actual = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $sha.Dispose() }
  if ($actual -ne $hash.ToLowerInvariant()) { throw "Checksum mismatch: $([IO.Path]::GetFileName($path))" }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ffTag = $lock.ffmpeg.release
$ffName = $lock.ffmpeg.asset
$ffBase = "https://github.com/BtbN/FFmpeg-Builds/releases/download/$ffTag"
$sum = Join-Path $cache "ffmpeg-$ffTag-checksums.txt"
Download "$ffBase/checksums.sha256" $sum
$ffHash = ((Get-Content -LiteralPath $sum | Where-Object { $_ -match [regex]::Escape($ffName) }) -split '\s+')[0]
if ($ffHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'FFmpeg checksum not found' }
if ($ffHash -ne $lock.ffmpeg.sha256) { throw 'FFmpeg upstream checksum differs from reviewed tools-lock.json' }
$archive = Join-Path $cache $ffName
Download "$ffBase/$ffName" $archive
Verify $archive $ffHash
$unpack = Join-Path $cache "ffmpeg-$ffTag-unpack"
if (!(Test-Path -LiteralPath $unpack)) { [IO.Compression.ZipFile]::ExtractToDirectory($archive,$unpack) }
$ff = Get-ChildItem -LiteralPath $unpack -Directory | Select-Object -First 1
$ffDest = Join-Path $vendor 'ffmpeg'
New-Item -ItemType Directory -Force $ffDest | Out-Null
Copy-Item -LiteralPath (Join-Path $ff.FullName 'bin') -Destination $ffDest -Recurse -Force
Get-ChildItem -LiteralPath $ff.FullName -File | Copy-Item -Destination $ffDest -Force
$ytVersion = $lock.ytDlp.version
$ytBase = "https://github.com/yt-dlp/yt-dlp/releases/download/$ytVersion"
$ytSum = Join-Path $cache 'yt-checksums.txt'
Download "$ytBase/SHA2-256SUMS" $ytSum
$ytHash = ((Get-Content -LiteralPath $ytSum | Where-Object { $_ -match '\syt-dlp.exe$' }) -split '\s+')[0]
if ($ytHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'yt-dlp checksum not found' }
if ($ytHash -ne $lock.ytDlp.sha256) { throw 'yt-dlp upstream checksum differs from reviewed tools-lock.json' }
$yt = Join-Path $vendor 'yt-dlp.exe'
Download "$ytBase/yt-dlp.exe" $yt
Verify $yt $ytHash
# A supported, pinned JS runtime; no runtime component downloads in the app.
$nodeVersion = $lock.node.version
$nodeName = "node-v$nodeVersion-win-x64.zip"
$nodeBase = "https://nodejs.org/dist/v$nodeVersion"
$nodeSum = Join-Path $cache 'node-checksums.txt'
Download "$nodeBase/SHASUMS256.txt" $nodeSum
$nodeHash = ((Get-Content -LiteralPath $nodeSum | Where-Object { $_ -match [regex]::Escape($nodeName) }) -split '\s+')[0]
if ($nodeHash -ne $lock.node.sha256) { throw 'Node upstream checksum differs from reviewed tools-lock.json' }
$nodeZip = Join-Path $cache $nodeName
Download "$nodeBase/$nodeName" $nodeZip
Verify $nodeZip $nodeHash
$nodeUnpack = Join-Path $cache 'node-unpack'
if (!(Test-Path -LiteralPath $nodeUnpack)) { [IO.Compression.ZipFile]::ExtractToDirectory($nodeZip,$nodeUnpack) }
Copy-Item -LiteralPath (Join-Path $nodeUnpack "node-v$nodeVersion-win-x64/node.exe") -Destination $vendor -Force
Copy-Item -LiteralPath (Join-Path $nodeUnpack "node-v$nodeVersion-win-x64/LICENSE") -Destination (Join-Path $vendor 'NODE-LICENSE.txt') -Force
Download "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$ytVersion/LICENSE" (Join-Path $vendor 'YT-DLP-LICENSE.txt')
Download "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$ytVersion/THIRD_PARTY_LICENSES.txt" (Join-Path $vendor 'YT-DLP-THIRD-PARTY.txt')
@{ffmpeg=@{release=$ffTag;asset=$ffName;sha256=$ffHash};ytDlp=@{version=$ytVersion;sha256=$ytHash};node=@{version=$nodeVersion;sha256=$nodeHash}} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $vendor 'manifest.json') -Encoding UTF8
Write-Host 'Verified official yt-dlp / Node.js and FFmpeg-linked BtbN tools are ready.'
