# MyDBTest — entry point for Windows (PowerShell 5+).
# delegates to run.sh via WSL (preferred) or Git Bash
# all environment logic lives in run.sh, this is a thin launcher

$VERSION = (Get-Content (Join-Path $PSScriptRoot '..' 'package.json') | ConvertFrom-Json).version

# self-heal: Windows blocks .ps1 by default, relax it and re-launch
$policy = Get-ExecutionPolicy -Scope CurrentUser
if ($policy -eq 'Restricted' -or $policy -eq 'Undefined') {
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
    & powershell -ExecutionPolicy RemoteSigned -File $MyInvocation.MyCommand.Path @args
    exit
}

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function ok($msg)   { Write-Host "  [  OK  ] $msg" -ForegroundColor Green    }
function fail($msg) { Write-Host "  [ FAIL ] $msg" -ForegroundColor Red      }
function run($msg)  { Write-Host "  [  >>  ] $msg" -ForegroundColor Cyan     }
function warn($msg) { Write-Host "  [ WARN ] $msg" -ForegroundColor Yellow   }
function info($msg) { Write-Host "  [ INFO ] $msg" -ForegroundColor DarkGray }

# short-circuit flags that don't need bash

$argStr = $args -join ' '

if ($argStr -match '^(--version|-v)$') {
    Write-Host "MyDBTest v$VERSION"
    exit 0
}

if ($argStr -match '^(--help|-h)$') {
    Write-Host ""
    Write-Host "  MyDBTest  -  v$VERSION" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Test your MongoDB, PostgreSQL, or Redis connection."
    Write-Host ""
    Write-Host "  Usage" -ForegroundColor Cyan
    Write-Host "    .\scripts\run.bat [--help | -h]"
    Write-Host "    .\scripts\run.bat [--version | -v]"
    Write-Host "    .\scripts\run.bat [--update]"
    Write-Host "    .\scripts\run.bat --json <mongodb|postgresql|redis> <url>"
    Write-Host ""
    exit 0
}

Write-Host ""
Write-Host "  MyDBTest" -ForegroundColor Cyan
Write-Host ""

# try WSL first (more reliable than Git Bash)

$wslAvailable = $false
try {
    wsl --status 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $wslAvailable = $true }
} catch { }

if ($wslAvailable) {
    run "Running via WSL..."
    $drive    = $scriptDir[0].ToString().ToLower()
    $unixPath = ($scriptDir -replace '\\', '/') -replace '^[A-Za-z]:', "/mnt/$drive"
    # pass script as separate token => spaces in path stay safe
    wsl -- bash "$unixPath/run.sh" @args
    exit $LASTEXITCODE
}

# find Git Bash in common install locations

$gitBashCandidates = @(
    "$env:ProgramFiles\Git\bin\bash.exe",
    "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
    "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe",
    "$env:USERPROFILE\scoop\apps\git\current\bin\bash.exe",
    "C:\tools\git\bin\bash.exe"
)

# accept bash.exe if already on PATH (Cygwin, MSYS2)
$bashCmd = Get-Command bash.exe -ErrorAction SilentlyContinue
if ($bashCmd) {
    $gitBashCandidates = @($bashCmd.Source) + $gitBashCandidates
}

$gitBash = $gitBashCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $gitBash) {
    warn "Git Bash not found — attempting install via winget..."

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Host ""
        fail "winget is not available on this machine"
        info "Install Git manually from https://git-scm.com then re-run."
        exit 1
    }

    winget install --id Git.Git -e --source winget --silent

    # re-check after install
    $gitBash = $gitBashCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $gitBash) {
        Write-Host ""
        fail "Could not locate Git Bash after installation"
        info "Restart your terminal and try again, or run from WSL."
        exit 1
    }
}

run "Running via Git Bash..."
$drive       = $scriptDir[0].ToString().ToLower()
$gitBashPath = ($scriptDir -replace '\\', '/') -replace '^[A-Za-z]:', "/$drive"
# invoke run.sh directly => prevents shell injection via args with quotes/semicolons
& $gitBash "$gitBashPath/run.sh" @args
exit $LASTEXITCODE
