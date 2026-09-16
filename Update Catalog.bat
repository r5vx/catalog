@echo off
setlocal
title Updating Catalog
cd /d "%~dp0"

echo.
echo   Updating Catalog
echo   ----------------
echo.
echo   The Update button in Settings does this without a window, and
echo   without closing the app first. This is the manual fallback.
echo.

set /a tries=0

:wait
tasklist /fi "imagename eq Catalog.exe" 2>nul | find /i "Catalog.exe" >nul
if errorlevel 1 goto build

set /a tries+=1
if %tries%==1 echo   Waiting for Catalog to close...
if %tries% GEQ 60 goto stuck

rem A one-second sleep. Not `timeout`, which refuses to run at all when its
rem input is redirected - and this script is started by the app, not by you.
ping -n 2 127.0.0.1 >nul
goto wait

:stuck
echo.
echo   Catalog is still running after a minute:
echo.
tasklist /fi "imagename eq Catalog.exe" /fo table /nh
echo.
echo   Close it and run this again.
echo.
pause
exit /b 1

:build
echo   Rebuilding...
echo.
call npm run pack
if errorlevel 1 goto failed

echo.
echo   Starting Catalog...
start "" "dist-app\win-unpacked\Catalog.exe"
exit /b 0

:failed
echo.
echo   The rebuild failed. The message above says why.
echo.
pause
exit /b 1
