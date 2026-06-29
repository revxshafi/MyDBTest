@echo off
setlocal
title MyDBTest
chcp 65001 >nul 2>&1

rem prefer PowerShell 7 (pwsh), fall back to PowerShell 5 (powershell)
set "PSCMD="
where pwsh >nul 2>&1 && set "PSCMD=pwsh"
if "%PSCMD%"=="" (
    where powershell >nul 2>&1 && set "PSCMD=powershell"
)

if "%PSCMD%"=="" (
    echo.
    echo   [ FAIL ]  PowerShell is required but was not found on PATH.
    echo   [ INFO ]  Install it from https://github.com/PowerShell/PowerShell
    exit /b 1
)

%PSCMD% -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
exit /b %ERRORLEVEL%
