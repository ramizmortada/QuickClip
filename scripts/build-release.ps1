# QuickClip Local Release Builder
$ErrorActionPreference = "Stop"

Write-Host "🚀 Building QuickClip Release with Auto-Updater Signatures..." -ForegroundColor Cyan

# 1. Ensure Cargo is in PATH
$env:PATH += ";$HOME\.cargo\bin"

# 2. Set Signing Key and CI env
$keyPath = "$HOME\.tauri\quickclip.key"
if (-not (Test-Path $keyPath)) {
    Write-Error "Private key not found at $keyPath"
    exit 1
}

$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Raw $keyPath).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
$env:CI = "true"

# 3. Build & Package (with --ci to skip interactive password prompts)
npx tauri build --ci

# 4. Prepare release folder
$distRelease = "dist-release"
if (Test-Path $distRelease) {
    Remove-Item -Recurse -Force $distRelease
}
New-Item -ItemType Directory -Path $distRelease | Out-Null

# Copy NSIS setup, MSI, signatures, and latest.json
if (Test-Path "src-tauri\target\release\bundle\nsis") {
    Get-ChildItem -Path "src-tauri\target\release\bundle\nsis\*.*" | Copy-Item -Destination $distRelease -Force
}
if (Test-Path "src-tauri\target\release\bundle\latest.json") {
    Copy-Item "src-tauri\target\release\bundle\latest.json" -Destination $distRelease -Force
}

Write-Host "`n✅ Build Complete! Release files are ready in: $distRelease" -ForegroundColor Green
Get-ChildItem $distRelease | Select-Object Name, Length | Format-Table -AutoSize
