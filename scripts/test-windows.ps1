$ErrorActionPreference = 'Stop'
$vectorRoot = Split-Path -Parent $PSScriptRoot
$vectorCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $vectorCompiler)) {
  $vectorCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
$vectorTestDir = Join-Path $vectorRoot 'outputs\native-tests'
$null = New-Item -ItemType Directory -Path $vectorTestDir -Force
$vectorTestExe = Join-Path $vectorTestDir 'VectorTests.exe'
$vectorHtml = Join-Path $vectorRoot 'Vector.html'
$vectorIcon = Join-Path $vectorRoot 'public\vector.ico'
& $vectorCompiler /nologo /target:exe /main:VectorTests /utf8output "/out:$vectorTestExe" "/win32icon:$vectorIcon" "/resource:$vectorIcon,Vector.ico" "/resource:$vectorHtml,Vector.html" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll (Join-Path $vectorRoot 'native\Vector.cs') (Join-Path $vectorRoot 'native\GameFiles.cs') (Join-Path $vectorRoot 'native\VectorTests.cs') (Join-Path $vectorRoot 'native\GameFileTests.cs') (Join-Path $vectorRoot 'native\Updates.cs') (Join-Path $vectorRoot 'native\Version.cs') (Join-Path $vectorRoot 'native\UpdateTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows tests did not compile.' }
& $vectorTestExe
if ($LASTEXITCODE -ne 0) { throw 'Windows tests failed.' }
