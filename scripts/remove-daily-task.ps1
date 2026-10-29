[CmdletBinding(SupportsShouldProcess = $true)]
param()
$ErrorActionPreference = 'Stop'
Import-Module -Name ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$projectRoot = [IO.Path]::GetDirectoryName($PSScriptRoot)
$dailyProfile = [IO.File]::ReadAllText([IO.Path]::Combine($projectRoot, 'config', 'daily.json')) | ConvertFrom-Json
$name = 'QMS-Daily-Activity-' + $dailyProfile.id
if ($PSCmdlet.ShouldProcess($name, 'Remove QMS daily activity task')) {
  $service = New-Object -ComObject 'Schedule.Service'; $service.Connect()
  $service.GetFolder('\').DeleteTask($name, 0)
  [Console]::WriteLine('Removed: ' + $name)
}
