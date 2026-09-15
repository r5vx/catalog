@echo off
title Updating Catalog
cd /d "%~dp0"

echo.
echo   Updating Catalog
echo   ----------------
echo.
echo   Waiting for Catalog to close...

set /a tries=0

:wait
tasklist /fi "imagename eq Catalog.exe" 2>nul | find /i "Catalog.exe" >nul
if errorlevel 1 goto build
set /a tries+=1
if %tries% GEQ 90 goto stuck
timeout /t 1 /nobreak >nul
goto wait

:stuck
echo.
echo   Catalog is still running. Close it and run this again.
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
timeout /t 2 /nobreak >nul
exit /b 0

:failed
echo.
echo   Something went wrong. Leave this window open and tell Claude what it says.
echo.
pause
exit /b 1
