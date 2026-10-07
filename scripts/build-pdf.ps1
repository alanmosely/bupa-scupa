# Build only pdftotext from the unmodified, pinned Xpdf source.
# Requires PowerShell 7 and Visual Studio 2022 C++ Build Tools with CMake and Ninja.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$lock = Get-Content -Raw -LiteralPath 'vendor-lock.json' | ConvertFrom-Json
$sourceArchive = Join-Path $root '.cache/downloads/xpdf-4.06.tar.gz'
if (!(Test-Path -LiteralPath $sourceArchive)) { throw 'Run npm run vendor first.' }
if ((Get-FileHash -LiteralPath $sourceArchive -Algorithm SHA256).Hash -ne $lock.'xpdf-4.06.tar.gz') {
    throw 'Xpdf source integrity check failed.'
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (!(Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio 2022 C++ Build Tools with CMake and Ninja.' }
$vs = & $vswhere -latest -version '[17.0,18.0)' -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Visual Studio 2022 C++ Build Tools were not found.' }
$compiler = Get-ChildItem -LiteralPath (Join-Path $vs 'VC/Tools/MSVC') -Directory |
    Sort-Object { [version]$_.Name } | Select-Object -Last 1
$compilerBin = Join-Path $compiler.FullName 'bin/HostX64/x64'
$cmake = Join-Path $vs 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'
$ninja = Join-Path $vs 'Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe'
foreach ($file in @($cmake, $ninja, (Join-Path $compilerBin 'cl.exe'))) {
    if (!(Test-Path -LiteralPath $file)) { throw "Missing build tool: $file" }
}

# Keep the SDK isolated from the machine's installed Windows features and registry.
$sdkVersion = '10.0.26100.9169'
$sdkRoot = Join-Path $root ".cache/windows-sdk/$sdkVersion"
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($package in @('microsoft.windows.sdk.cpp', 'microsoft.windows.sdk.cpp.x64')) {
    $name = "$package.$sdkVersion.nupkg"
    $archive = Join-Path $root ".cache/downloads/$name"
    if (!(Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/$package/$sdkVersion/$name" -OutFile $archive -UseBasicParsing
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $lock.$name) {
        throw "SDK integrity check failed: $name"
    }
    $destination = Join-Path $sdkRoot $package
    if (!(Test-Path -LiteralPath $destination)) {
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $destination)
    }
}
$sdk = Join-Path $sdkRoot 'microsoft.windows.sdk.cpp/c'
$sdkLibs = Join-Path $sdkRoot 'microsoft.windows.sdk.cpp.x64/c'
$env:INCLUDE = "$($compiler.FullName)/include;$sdk/Include/10.0.26100.0/ucrt;$sdk/Include/10.0.26100.0/shared;$sdk/Include/10.0.26100.0/um"
$env:LIB = "$($compiler.FullName)/lib/x64;$sdkLibs/ucrt/x64;$sdkLibs/um/x64"
$env:PATH = "$compilerBin;$sdk/bin/10.0.26100.0/x64;$env:PATH"

# A fresh directory prevents edited or stale source files from entering the build.
$work = Join-Path $root ('.cache/xpdf-source-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
& tar -xf $sourceArchive -C $work
if ($LASTEXITCODE -ne 0) { throw 'Xpdf source extraction failed.' }
$source = Join-Path $work 'xpdf-4.06'
$build = Join-Path $work 'build'
$configure = @(
    '-S', $source, '-B', $build, '-G', 'Ninja', "-DCMAKE_MAKE_PROGRAM=$ninja",
    '-DCMAKE_C_COMPILER=cl.exe', '-DCMAKE_CXX_COMPILER=cl.exe', '-DCMAKE_BUILD_TYPE=Release',
    '-DNO_FONTCONFIG=ON', '-DPAPER_LIBRARY=', '-DLCMS_LIBRARY=', '-DMULTITHREADED=OFF',
    '-DCMAKE_DISABLE_FIND_PACKAGE_ZLIB=ON', '-DCMAKE_DISABLE_FIND_PACKAGE_PNG=ON',
    '-DCMAKE_DISABLE_FIND_PACKAGE_Qt6Widgets=ON', '-DCMAKE_DISABLE_FIND_PACKAGE_Qt5Widgets=ON'
)
& $cmake @configure
if ($LASTEXITCODE -ne 0) { throw 'Xpdf configuration failed.' }
& $cmake --build $build --target pdftotext --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'Xpdf compilation failed.' }
$binary = Join-Path $build 'xpdf/pdftotext.exe'
Copy-Item -LiteralPath $binary -Destination 'vendor/xpdf/pdftotext.exe'
@{
    source = 'xpdf-4.06.tar.gz'
    sourceSha256 = $lock.'xpdf-4.06.tar.gz'
    sdkVersion = $sdkVersion
    compilerVersion = $compiler.Name
    target = 'pdftotext (Windows x64, Release, static MSVC runtime)'
    optionalLibraries = @()
    recipe = 'scripts/build-pdf.ps1 in the accompanying SCUPA source archive'
    binarySha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath 'vendor/xpdf/BUILD.json' -Encoding UTF8
Write-Output 'Built pdftotext from verified Xpdf source. Build provenance saved in vendor/xpdf/BUILD.json.'
