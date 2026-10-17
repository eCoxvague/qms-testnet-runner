[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
Import-Module -Name ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$projectRoot = [IO.Path]::GetDirectoryName($PSScriptRoot)
$campaign = [IO.File]::ReadAllText([IO.Path]::Combine($projectRoot, 'config', 'streak.json')) | ConvertFrom-Json
$bindingFile = [IO.Path]::Combine($projectRoot, '.cache', 'streak-wallet.json')
if (-not [IO.File]::Exists($bindingFile)) { throw 'Once npm run streak:prepare calistirin.' }
if (-not [IO.File]::Exists([IO.Path]::Combine($projectRoot, '.secrets', 'qms-key.dpapi'))) {
    throw 'Otomatik Windows gorevi icin ayni kullanicida DPAPI ile kayitli test anahtari gerekir.'
}
$binding = [IO.File]::ReadAllText($bindingFile) | ConvertFrom-Json
if ($binding.campaignId -ne $campaign.id -or $binding.address -notmatch '^0x[0-9a-fA-F]{40}$') { throw 'Streak cuzdan hazirligi gecersiz.' }
$name = 'QMS-Testnet-Streak-' + $campaign.id
$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$folder = $service.GetFolder('\')
$definition = $service.NewTask(0)
$definition.RegistrationInfo.Description = 'Daily QWAP swap + LP, with task-day and duplicate-send guards. Same Windows user; no password stored in task.'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$definition.Principal.UserId = $user
$definition.Principal.LogonType = 3 # InteractiveToken: requires this user's logged-in session.
$definition.Principal.RunLevel = 0
$definition.Settings.Enabled = $true
$definition.Settings.StartWhenAvailable = $true
$definition.Settings.MultipleInstances = 2 # Ignore new instance if this task is already running.
$definition.Settings.DisallowStartIfOnBatteries = $false
$definition.Settings.StopIfGoingOnBatteries = $false
$definition.Settings.ExecutionTimeLimit = 'PT15M'
$definition.Settings.Hidden = $true
$start = [DateTimeOffset]::Parse($campaign.startsAt).ToUniversalTime()
$end = $start.AddDays([int]$campaign.days)
$trigger = $definition.Triggers.Create(2) # Daily
$trigger.StartBoundary = $start.AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:sszzz')
$trigger.EndBoundary = $end.ToString('yyyy-MM-ddTHH:mm:sszzz')
$trigger.DaysInterval = 1
$trigger.Repetition.Interval = 'PT1H'
$trigger.Repetition.Duration = 'PT23H'
$trigger.Repetition.StopAtDurationEnd = $false
$trigger.Enabled = $true
$action = $definition.Actions.Create(0)
$action.Path = [IO.Path]::Combine($PSHOME, 'powershell.exe')
$action.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + [IO.Path]::Combine($PSScriptRoot, 'run-streak-scheduled.ps1') + '"'
$action.WorkingDirectory = $projectRoot
if ($ValidateOnly) {
    [void]$folder.RegisterTaskDefinition($name, $definition, 1, $user, $null, 3, $null) # TASK_VALIDATE_ONLY: no task is created.
    [Console]::WriteLine('Task definition validated; no scheduled task was installed.')
} elseif ($PSCmdlet.ShouldProcess($name, 'Register daily QMS testnet streak task')) {
    [void]$folder.RegisterTaskDefinition($name, $definition, 6, $user, $null, 3, $null)
    [Console]::WriteLine('Installed: ' + $name)
    [Console]::WriteLine('First run: 19 Oct 2026 13:05 UTC / 16:05 Turkey; hourly checks until campaign ends.')
    [Console]::WriteLine('Computer and this user session must be available. Finished task days are skipped.')
}
