param([string]$OutputName = 'Vector.exe')

$ErrorActionPreference = 'Stop'
if ([IO.Path]::GetFileName($OutputName) -ne $OutputName -or [IO.Path]::GetExtension($OutputName) -ne '.exe') {
  throw 'OutputName must be an executable filename in the project folder.'
}
$vectorRoot = Split-Path -Parent $PSScriptRoot
$vectorVersion = (Get-Content -LiteralPath (Join-Path $vectorRoot 'package.json') -Raw | ConvertFrom-Json).version
$vectorVersionSource = Join-Path $vectorRoot 'native\Version.cs'
if ((Get-Content -LiteralPath $vectorVersionSource -Raw) -notmatch ('Current = "' + [regex]::Escape($vectorVersion) + '"')) { throw 'Package and Windows versions differ.' }
$vectorCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $vectorCompiler)) {
  $vectorCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $vectorCompiler)) { throw '.NET Framework 4 compiler was not found.' }
$vectorHtml = Join-Path $vectorRoot 'Vector.html'
if (-not (Test-Path -LiteralPath $vectorHtml)) { throw 'Build Vector.html before the Windows launcher.' }
$vectorOutput = Join-Path $vectorRoot $OutputName
$vectorSource = Join-Path $vectorRoot 'native\Vector.cs'
$vectorIcon = Join-Path $vectorRoot 'public\vector.ico'
if (-not (Test-Path -LiteralPath $vectorIcon)) { throw 'Vector icon is missing: public/vector.ico.' }
& $vectorCompiler /nologo /target:winexe /platform:anycpu /optimize+ /utf8output "/out:$vectorOutput" "/win32icon:$vectorIcon" "/resource:$vectorIcon,Vector.ico" "/resource:$vectorHtml,Vector.html" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll $vectorSource (Join-Path $vectorRoot 'native\GameFiles.cs') (Join-Path $vectorRoot 'native\Updates.cs') $vectorVersionSource
if ($LASTEXITCODE -ne 0) { throw 'Vector.exe compilation failed.' }
Write-Host ('Portable Windows app created: {0} ({1:N0} KB)' -f $vectorOutput, ((Get-Item -LiteralPath $vectorOutput).Length / 1KB))
