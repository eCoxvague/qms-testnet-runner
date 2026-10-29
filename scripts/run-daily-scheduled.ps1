param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
Import-Module -Name ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$projectRoot = [IO.Path]::GetDirectoryName($PSScriptRoot)
$binding = [IO.File]::ReadAllText([IO.Path]::Combine($projectRoot, '.cache', 'daily-wallet.json')) | ConvertFrom-Json
if ($binding.address -notmatch '^0x[0-9a-fA-F]{40}$') { throw 'Daily wallet binding invalid.' }
$nodeCommand = Get-Command node -ErrorAction Stop
$logDirectory = [IO.Path]::Combine($projectRoot, 'reports', 'daily-scheduler')
[void][IO.Directory]::CreateDirectory($logDirectory)
$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$nodeArgs = @('"' + [IO.Path]::Combine($PSScriptRoot, 'run-daily.mjs') + '"', '--broadcast', '--address', $binding.address)
if ($DryRun) { $nodeArgs += '--dry-run' }
$process = Start-Process -FilePath $nodeCommand.Source -ArgumentList $nodeArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru `
  -RedirectStandardOutput ([IO.Path]::Combine($logDirectory, $stamp + '.out.log')) `
  -RedirectStandardError ([IO.Path]::Combine($logDirectory, $stamp + '.err.log'))
exit $process.ExitCode
