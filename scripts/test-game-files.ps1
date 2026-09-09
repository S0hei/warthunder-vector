# Explicit integration test: reads installed game files, not run by the unit suite.
$ErrorActionPreference = 'Stop'
$vectorRoot = Split-Path -Parent $PSScriptRoot
$vectorCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$vectorTestDir = Join-Path $vectorRoot 'outputs\native-tests'
$null = New-Item -ItemType Directory -Path $vectorTestDir -Force
$vectorTestExe = Join-Path $vectorTestDir 'GameFileIntegrationProbe.exe'
& $vectorCompiler /nologo /target:exe /main:GameFileIntegrationProbe /utf8output "/out:$vectorTestExe" /reference:System.Web.Extensions.dll (Join-Path $vectorRoot 'native\GameFiles.cs') (Join-Path $vectorRoot 'native\GameFileTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Game-file integration test did not compile.' }
& $vectorTestExe
if ($LASTEXITCODE -ne 0) { throw 'Game-file integration test failed.' }
