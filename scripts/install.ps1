# MyDBTest — global installer for Windows (PowerShell 5+)

$ErrorActionPreference = 'Stop'

$repo        = 'https://github.com/revxshafi/MyDBTest'
$installDir  = "$HOME\.mydbtest"
$wrapperName = 'mydbtest.ps1'

# write wrapper to both PS5 and PS7 Scripts folders so it works in either
$scriptsDirs = @(
    "$HOME\Documents\PowerShell\Scripts",           # PS7
    "$HOME\Documents\WindowsPowerShell\Scripts"     # PS5
)

function ok($msg)   { Write-Host "  [  OK  ] $msg" -ForegroundColor Green  }
function fail($msg) { Write-Host "  [ FAIL ] $msg" -ForegroundColor Red    }
function run($msg)  { Write-Host "  [  >>  ] $msg" -ForegroundColor Cyan   }
function warn($msg) { Write-Host "  [ WARN ] $msg" -ForegroundColor Yellow }
function info($msg) { Write-Host "  [ INFO ] $msg" -ForegroundColor DarkGray }

Write-Host ""
info "MyDBTest installer"
Write-Host ""

# self-heal: set execution policy for current user so scripts aren't blocked
$policy = Get-ExecutionPolicy -Scope CurrentUser
if ($policy -eq 'Restricted' -or $policy -eq 'AllSigned') {
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
    ok "execution policy set to RemoteSigned for current user"
}

if ($args -contains '--uninstall') {
    run "removing MyDBTest"
    if (Test-Path "$installDir") { Remove-Item -Recurse -Force "$installDir" }
    foreach ($dir in $scriptsDirs) {
        $wp = Join-Path $dir $wrapperName
        if (Test-Path $wp) { Remove-Item -Force $wp }
    }
    ok "MyDBTest removed"
    info "path entry was not touched — use 'mydbtest uninstall' to clean shell profiles"
    Write-Host ""
    exit 0
}

# git check => install via winget if missing
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    warn "git not found — attempting install via winget"
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        fail "git is required and winget is not available"
        info "install git from https://git-scm.com and try again"
        exit 1
    }
    winget install --id Git.Git -e --source winget --silent
    # refresh PATH for this session
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        fail "git still not found after install — restart your terminal and try again"
        exit 1
    }
}

# clone or update
if (Test-Path "$installDir\.git") {
    $currentVer = ''
    try { $currentVer = (& powershell -File "$installDir\scripts\run.ps1" --version 2>$null) } catch {}
    $label = if ($currentVer) { " (currently $currentVer)" } else { '' }
    run "updating existing installation$label"
    git -C "$installDir" pull --ff-only
} else {
    run "cloning into $installDir"
    if (-not (git clone "$repo" "$installDir" 2>&1)) {
        fail "git clone failed"
        if (Test-Path "$installDir") { Remove-Item -Recurse -Force "$installDir" }
        info "check your internet connection and try again"
        exit 1
    }
}

# pre-install npm deps so first run is instant
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm) {
    run "installing npm dependencies"
    try {
        npm install --prefix "$installDir" --silent 2>$null
    } catch {
        info "npm install failed — dependencies will be installed on first run"
    }
}

# write wrappers to PS5 + PS7 Scripts folders
foreach ($dir in $scriptsDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
    $wrapperPath = Join-Path $dir $wrapperName
    @"
& "`$HOME\.mydbtest\scripts\run.ps1" @args
"@ | Set-Content -Path $wrapperPath -Encoding UTF8
    ok "wrapper written to $wrapperPath"
}

# PATH check => add Scripts dir for current shell
$targetDir = $scriptsDirs[0]  # PS7 dir; PS5 users have it via PS5 dir too
$userPath  = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -notlike "*$targetDir*") {
    [Environment]::SetEnvironmentVariable('PATH', "$userPath;$targetDir", 'User')
    ok "added $targetDir to user PATH"
    warn "restart your terminal for the change to take effect"
}

# verify
$verified = $false
try {
    $ver = & powershell -File "$installDir\scripts\run.ps1" --version 2>$null
    if ($ver -match 'MyDBTest') { $verified = $true; ok "$ver — installed successfully" }
} catch {}
if (-not $verified) {
    ok "installation complete — open a new terminal and run 'mydbtest' to start"
}

Write-Host ""
