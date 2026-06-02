$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$webDir = Join-Path (Split-Path -Parent $scriptDir) "PapaCheck.Web"
$assetDir = Join-Path $scriptDir "assets\web"

Write-Host "[sync] 同步 Web 资源到 APK assets..." -ForegroundColor Cyan

# Ensure target directories exist
$dirs = @(
    $assetDir,
    (Join-Path $assetDir "css"),
    (Join-Path $assetDir "js")
)
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
}

# Copy files
$files = @(
    "admin.html",
    "index.html",
    "sw.js",
    "favicon.png",
    "css\admin.css",
    "css\style.css",
    "js\api.js",
    "js\app.js",
    "js\admin.js",
    "js\big-screen.js",
    "js\change-log.js",
    "js\connection.js",
    "js\db.js",
    "js\sync.js"
)

foreach ($f in $files) {
    $src = Join-Path $webDir $f
    $dst = Join-Path $assetDir $f
    if (Test-Path $src) {
        Copy-Item $src $dst -Force
    } else {
        Write-Host "  WARNING: $src not found, skipping" -ForegroundColor Yellow
    }
}

Write-Host "[sync] 完成" -ForegroundColor Green
