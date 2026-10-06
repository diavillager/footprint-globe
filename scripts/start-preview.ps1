$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoDirectory
$nodeCandidates = @(
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$runtime = $null
foreach ($candidate in $nodeCandidates) {
    $version = & $candidate -p 'process.versions.node'
    if ([version]$version -ge [version]'22.12.0') { $runtime = $candidate; break }
}
if (-not $runtime) { throw 'Node.js 22.12 or newer is required. Install it and run this script again.' }
$npmCommand = Get-Command npm.cmd -ErrorAction Stop
$npmCli = Join-Path (Split-Path -Parent $npmCommand.Source) 'node_modules/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli)) { throw 'npm CLI not found. Use npm ci, npm run build, npm run preview with Node.js 22.12+.' }
$env:PATH = (Split-Path -Parent $runtime) + ';' + $env:PATH
& $runtime $npmCli ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
& $runtime $npmCli run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Write-Host 'Open http://127.0.0.1:4173 and select your file in the browser. Ctrl+C stops the local server.'
& $runtime $npmCli run preview
