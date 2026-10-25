$ErrorActionPreference = 'Stop'

Write-Host "OpenSource Mate AI - project verification" -ForegroundColor Cyan

$required = @(
  'package.json',
  'backend/package.json',
  'backend/server.js',
  'backend/.env.example',
  'frontend/package.json',
  'frontend/src/App.tsx',
  'UPGRADE_PLAN.md'
)

foreach ($path in $required) {
  if (-not (Test-Path $path)) {
    throw "Required project file is missing: $path. Run this script from the project root."
  }
  Write-Host "OK  $path" -ForegroundColor Green
}

Write-Host "`nChecking backend tests..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw 'Backend test/syntax checks failed.' }

Write-Host "`nBuilding frontend..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend production build failed.' }

Write-Host "`nAll configured verification checks passed." -ForegroundColor Green
