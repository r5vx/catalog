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
echo   You can leave Catalog open - a release builds in its own folder.
echo.

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
