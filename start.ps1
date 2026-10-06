$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22+ from https://nodejs.org first.' }
    $major = & node -p 'parseInt(process.versions.node)'
    if ([int]$major -lt 22) { throw 'Node.js 22 or newer is required.' }
    & npm.cmd ci --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & node scripts/start.mjs @args
    exit $LASTEXITCODE
} finally { Pop-Location }
