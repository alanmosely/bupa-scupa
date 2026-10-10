# Run in Windows PowerShell 5.1 or later. No Node, browser, SDK or admin rights needed.
param(
    [string]$ReleaseDirectory = (Join-Path $PSScriptRoot '..\dist'),
    [switch]$AllowUnsignedPreview
)
$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$runRoot = Join-Path ([IO.Path]::GetTempPath()) ('scupa-acceptance-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runRoot | Out-Null
Write-Output "Acceptance workspace: $runRoot"
$results = @()
$priorAppDir = $env:SCUPA_APP_DIR
$priorPath = $env:PATH
try {
    $sums = @{}
    Get-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') | ForEach-Object {
        if ($_ -notmatch '^([a-f0-9]{64})  ([a-zA-Z0-9._-]+)$') { throw 'Invalid checksum manifest.' }
        if ($sums.ContainsKey($Matches[2])) { throw 'Duplicate checksum entry.' }
        $sums[$Matches[2]] = $Matches[1]
    }
    $appZips = @($sums.Keys | Where-Object { $_ -match '^bupa-scupa-(.+)-x64\.zip$' })
    if ($appZips.Count -ne 1) { throw 'Expected one versioned application ZIP in the checksum manifest.' }
    $version = $appZips[0] -replace '^bupa-scupa-(.+)-x64\.zip$', '$1'
    foreach ($name in @('bupa-scupa-x64.exe', "bupa-scupa-$version-x64.zip", "bupa-scupa-$version-source.zip")) {
        $file = Join-Path $releaseRoot $name
        if (!$sums.ContainsKey($name) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $sums[$name]) {
            throw "Checksum mismatch: $name"
        }
    }
    $extracted = Join-Path $runRoot 'extracted'
    Expand-Archive -LiteralPath (Join-Path $releaseRoot "bupa-scupa-$version-x64.zip") -DestinationPath $extracted
    $targets = @(
        (Join-Path $releaseRoot 'bupa-scupa-x64.exe'),
        (Join-Path $extracted 'BUPA SCUPA.exe')
    )
    $env:PATH = Join-Path $env:SystemRoot 'System32'
    foreach ($index in 0..1) {
        $exe = $targets[$index]
        $signature = Get-AuthenticodeSignature -LiteralPath $exe
        if ($signature.Status -ne 'Valid' -and !($AllowUnsignedPreview -and $signature.Status -eq 'NotSigned')) {
            throw "Authenticode verification failed: $($signature.Status). Unsigned previews require -AllowUnsignedPreview."
        }
        $archive = Join-Path $runRoot "archive-$index"
        $env:SCUPA_APP_DIR = Join-Path $runRoot "preferences-$index"
        foreach ($command in @('schema', 'status', 'report', 'claims')) {
            $output = Join-Path $runRoot "$index-$command.json"
            if (@($archive, $output) | Where-Object { $_.Contains('"') }) { throw 'Unsupported quote in test path.' }
            $arguments = "--agent $command --data-dir `"$archive`" --output `"$output`""
            $process = Start-Process -FilePath $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
            if (!$process.WaitForExit(120000)) {
                $process.Kill()
                throw "Timed out: $command"
            }
            $process.Refresh()
            if ($process.ExitCode -ne 0) { throw "Agent process failed: $command ($($process.ExitCode))" }
            $reply = Get-Content -Raw -LiteralPath $output | ConvertFrom-Json
            if ($reply.ok -ne $true -or $reply.command -ne $command) { throw "Invalid response: $command" }
            $results += [pscustomobject]@{ distribution = @('portable', 'zip')[$index]; command = $command; passed = $true }
        }
        if (Test-Path -LiteralPath (Join-Path $archive 'master\claims.csv')) { throw 'Read-only commands created a master.' }
    }
    $evidence = [pscustomobject]@{
        version = $version
        checkedAt = [DateTime]::UtcNow.ToString('o')
        windows = [Environment]::OSVersion.VersionString
        architecture = $env:PROCESSOR_ARCHITECTURE
        allowedUnsignedPreview = [bool]$AllowUnsignedPreview
        # This script cannot establish that the host is a fresh OS.
        cleanMachineConfirmedByTester = $false
        tests = $results
        manualChecksRemaining = @('fresh OS provenance', 'GUI and storage notice', 'manual login/MFA', 'household discovery and member confirmation', 'PDF amounts', 'cancellation', 'SmartScreen and antivirus')
    }
    $evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runRoot 'acceptance.json') -Encoding UTF8
    Write-Output "Portable checks passed. Evidence: $runRoot"
    Write-Output 'Complete the manual checks in docs/CLEAN_WINDOWS.md; this is not a release approval.'
} finally {
    $env:SCUPA_APP_DIR = $priorAppDir
    $env:PATH = $priorPath
}
