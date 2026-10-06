$ErrorActionPreference = 'Stop'
. ([System.IO.Path]::Combine($PSScriptRoot, 'dpapi.ps1'))
$projectRoot = [System.IO.Path]::GetDirectoryName($PSScriptRoot)
$secretDir = [System.IO.Path]::Combine($projectRoot, '.secrets')
$secretFile = [System.IO.Path]::Combine($secretDir, 'qms-key.dpapi')
$secureKey = Read-Host 'Yalnizca test cuzdani private key (giris gizli)' -AsSecureString
$ptr = [IntPtr]::Zero
$plainKey = $null
$temporaryFile = $null
try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
    if ($plainKey -notmatch '^(0x)?[0-9a-fA-F]{64}$') { throw 'Anahtar 64 hex karakter olmali.' }
    $encrypted = Protect-QmsKey -Key ('0x' + ($plainKey -replace '^0x', ''))
    [void][System.IO.Directory]::CreateDirectory($secretDir)
    if (([System.IO.File]::GetAttributes($secretDir) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Anahtar klasoru sembolik baglanti olamaz.'
    }
    if ([System.IO.File]::Exists($secretFile) -and
        (([System.IO.File]::GetAttributes($secretFile) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw 'Anahtar dosyasi sembolik baglanti olamaz.'
    }
    $temporaryFile = [System.IO.Path]::Combine($secretDir, '.write-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [System.IO.File]::WriteAllText($temporaryFile, $encrypted, [System.Text.Encoding]::ASCII)
    if ([System.IO.File]::Exists($secretFile)) {
        [System.IO.File]::Replace($temporaryFile, $secretFile, [NullString]::Value)
    } else {
        [System.IO.File]::Move($temporaryFile, $secretFile)
    }
    [Console]::WriteLine('Anahtar Windows DPAPI ile sifrelendi. Ayni Windows kullanicisi ile okunabilir.')
} finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $plainKey = $null
    if ($temporaryFile -and [System.IO.File]::Exists($temporaryFile)) { [System.IO.File]::Delete($temporaryFile) }
    if ($secureKey) { $secureKey.Dispose() }
}
