[CmdletBinding(SupportsShouldProcess = $true)]
param()
$ErrorActionPreference = 'Stop'
Import-Module -Name ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$projectRoot = [IO.Path]::GetDirectoryName($PSScriptRoot)
$campaign = [IO.File]::ReadAllText([IO.Path]::Combine($projectRoot, 'config', 'streak.json')) | ConvertFrom-Json
$name = 'QMS-Testnet-Streak-' + $campaign.id
if ($PSCmdlet.ShouldProcess($name, 'Remove QMS testnet streak scheduled task')) {
    $service = New-Object -ComObject 'Schedule.Service'; $service.Connect()
    $service.GetFolder('\').DeleteTask($name, 0)
    [Console]::WriteLine('Removed: ' + $name)
}
