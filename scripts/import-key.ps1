$ErrorActionPreference = 'Stop'
. ([System.IO.Path]::Combine($PSScriptRoot, 'dpapi.ps1'))
$projectRoot = [System.IO.Path]::GetDirectoryName($PSScriptRoot)
$secretDir = [System.IO.Path]::Combine($projectRoot, '.secrets')
$secretFile = [System.IO.Path]::Combine($secretDir, 'qms-key.dpapi')
$secureKey = Read-Host 'Yalnizca test cuzdani private key (giris gizli)' -AsSecureString
$ptr = [IntPtr]::Zero
$plainKey = $null
try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
    if ($plainKey -notmatch '^(0x)?[0-9a-fA-F]{64}$') { throw 'Anahtar 64 hex karakter olmali.' }
    $encrypted = Protect-QmsKey -Key ('0x' + ($plainKey -replace '^0x', ''))
    [void][System.IO.Directory]::CreateDirectory($secretDir)
    [System.IO.File]::WriteAllText($secretFile, $encrypted, [System.Text.Encoding]::ASCII)
    [Console]::WriteLine('Anahtar Windows DPAPI ile sifrelendi. Ayni Windows kullanicisi ile okunabilir.')
} finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $plainKey = $null
    if ($secureKey) { $secureKey.Dispose() }
}
