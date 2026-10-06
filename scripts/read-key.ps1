$ErrorActionPreference = 'Stop'
$plainKey = $null
try {
    . ([System.IO.Path]::Combine($PSScriptRoot, 'dpapi.ps1'))
    $secretFile = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($PSScriptRoot), '.secrets', 'qms-key.dpapi')
    $encryptedKey = [System.IO.File]::ReadAllText($secretFile)
    $plainKey = Unprotect-QmsKey -Encrypted $encryptedKey
    [Console]::Out.Write($plainKey)
} catch {
    [Console]::Error.WriteLine('Yerel sifreli anahtar okunamadi. npm run key:import ile yukleyin.')
    exit 1
} finally {
    $plainKey = $null
}
