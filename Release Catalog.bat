@echo off
title Releasing Catalog
cd /d "%~dp0"

echo.
echo   Releasing Catalog
echo   -----------------
echo.
echo   This builds a new version and publishes it. Everyone who has
echo   Catalog installed gets it the next time they open the app.
echo.
echo   Close Catalog before continuing.
echo.
pause

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
call npm run release %1
if errorlevel 1 goto failed

echo.
pause
exit /b 0

:failed
echo.
echo   Something went wrong. Leave this window open and tell Claude what it says.
echo.
pause
exit /b 1
