param([string]$ReleaseDirectory = (Join-Path $PSScriptRoot '..\dist'), [string]$ExpectedThumbprint)
$ErrorActionPreference = 'Stop'
if ($ExpectedThumbprint -notmatch '^[a-fA-F0-9]{40}$') {
    throw 'Supply the independently verified signing certificate thumbprint. Never put private keys or passwords in this script.'
}
$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
foreach ($relative in @('bupa-scupa-x64.exe', 'win-unpacked\BUPA SCUPA.exe')) {
    $file = Join-Path $releaseRoot $relative
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $ExpectedThumbprint -or !$signature.TimeStamperCertificate) {
        throw "Missing, invalid, unexpected or untimestamped signature: $relative"
    }
    Write-Output "Verified trusted signature, expected certificate and timestamp: $relative"
}
