# Use .NET directly: Microsoft.PowerShell.Security may not load in the caller's environment.
try {
    [void][System.Reflection.Assembly]::Load('System.Security.Cryptography.ProtectedData')
} catch {
    [void][System.Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')
}

function Protect-QmsKey {
    param([Parameter(Mandatory = $true)][string]$Key)
    [byte[]]$keyBytes = [System.Text.Encoding]::UTF8.GetBytes($Key)
    try {
        $encryptedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
            $keyBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        return 'QMS-DPAPI-V1:' + [Convert]::ToBase64String($encryptedBytes)
    } finally {
        [Array]::Clear($keyBytes, 0, $keyBytes.Length)
    }
}

function Unprotect-QmsKey {
    param([Parameter(Mandatory = $true)][string]$Encrypted)
    $Encrypted = $Encrypted.Trim()
    $prefix = 'QMS-DPAPI-V1:'
    if ($Encrypted.StartsWith($prefix, [StringComparison]::Ordinal)) {
        [byte[]]$encryptedBytes = [Convert]::FromBase64String($Encrypted.Substring($prefix.Length))
        $encoding = [System.Text.Encoding]::UTF8
    } else {
        # Backward compatibility with Windows PowerShell ConvertFrom-SecureString DPAPI hex.
        if ($Encrypted -notmatch '^[0-9a-fA-F]+$' -or $Encrypted.Length % 2 -ne 0) {
            throw 'Sifreli anahtar dosyasi formati gecersiz.'
        }
        [byte[]]$encryptedBytes = [byte[]]::new($Encrypted.Length / 2)
        for ($i = 0; $i -lt $encryptedBytes.Length; $i++) {
            $encryptedBytes[$i] = [Convert]::ToByte($Encrypted.Substring($i * 2, 2), 16)
        }
        $encoding = [System.Text.Encoding]::Unicode
    }
    [byte[]]$keyBytes = $null
    try {
        $keyBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $encryptedBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        $key = $encoding.GetString($keyBytes)
        if ($key -notmatch '^(0x)?[0-9a-fA-F]{64}$') { throw 'Sifreli dosyadaki anahtar formati gecersiz.' }
        return $key
    } finally {
        if ($null -ne $keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
    }
}
