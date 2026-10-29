[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
Import-Module -Name ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$projectRoot = [IO.Path]::GetDirectoryName($PSScriptRoot)
$dailyProfile = [IO.File]::ReadAllText([IO.Path]::Combine($projectRoot, 'config', 'daily.json')) | ConvertFrom-Json
$bindingFile = [IO.Path]::Combine($projectRoot, '.cache', 'daily-wallet.json')
if (-not [IO.File]::Exists($bindingFile)) { throw 'Once npm run daily:prepare calistirin.' }
if (-not [IO.File]::Exists([IO.Path]::Combine($projectRoot, '.secrets', 'qms-key.dpapi'))) { throw 'Otomatik gorev icin ayni Windows kullanicisinda DPAPI test anahtari gerekir.' }
$binding = [IO.File]::ReadAllText($bindingFile) | ConvertFrom-Json
if ($binding.profileId -ne $dailyProfile.id -or $binding.address -notmatch '^0x[0-9a-fA-F]{40}$' -or $binding.counter -notmatch '^0x[0-9a-fA-F]{40}$') { throw 'Gunluk hazirlik gecersiz.' }
$name = 'QMS-Daily-Activity-' + $dailyProfile.id
$service = New-Object -ComObject 'Schedule.Service'; $service.Connect()
$folder = $service.GetFolder('\'); $definition = $service.NewTask(0)
$definition.RegistrationInfo.Description = 'Four daily testnet actions; maximum five transactions including approval; 30-day profile; no key in task.'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$definition.Principal.UserId = $user; $definition.Principal.LogonType = 3; $definition.Principal.RunLevel = 0
$definition.Settings.Enabled = $true; $definition.Settings.StartWhenAvailable = $true
$definition.Settings.MultipleInstances = 2; $definition.Settings.DisallowStartIfOnBatteries = $false
$definition.Settings.StopIfGoingOnBatteries = $false; $definition.Settings.ExecutionTimeLimit = 'PT15M'; $definition.Settings.Hidden = $true
$start = [DateTimeOffset]::Parse($dailyProfile.startsAt).ToUniversalTime()
$end = $start.AddDays([int]$dailyProfile.days)
if ([int]$dailyProfile.days -lt 1 -or [int]$dailyProfile.days -gt 30 -or [DateTimeOffset]::UtcNow -ge $end) { throw 'Gunluk profil suresi gecersiz veya bitmis.' }
$trigger = $definition.Triggers.Create(2)
$trigger.StartBoundary = $start.AddMinutes(15).ToString('yyyy-MM-ddTHH:mm:sszzz')
$trigger.EndBoundary = $end.ToString('yyyy-MM-ddTHH:mm:sszzz'); $trigger.DaysInterval = 1
$trigger.Repetition.Interval = 'PT1H'; $trigger.Repetition.Duration = 'PT23H'
$trigger.Repetition.StopAtDurationEnd = $false; $trigger.Enabled = $true
$action = $definition.Actions.Create(0)
$action.Path = [IO.Path]::Combine($PSHOME, 'powershell.exe')
$action.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + [IO.Path]::Combine($PSScriptRoot, 'run-daily-scheduled.ps1') + '"'
$action.WorkingDirectory = $projectRoot
if ($ValidateOnly) {
  [void]$folder.RegisterTaskDefinition($name, $definition, 1, $user, $null, 3, $null)
  [Console]::WriteLine('Daily definition validated; no task installed.')
} elseif ($PSCmdlet.ShouldProcess($name, 'Register daily QMS testnet activity')) {
  [void]$folder.RegisterTaskDefinition($name, $definition, 6, $user, $null, 3, $null)
  [Console]::WriteLine('Installed: ' + $name)
  [Console]::WriteLine('Daily 13:15 UTC / 16:15 Turkey; hourly retries skip confirmed actions. Ends: ' + $end.ToString('u'))
  [Console]::WriteLine('Computer, Internet and this Windows user session must be available.')
}
