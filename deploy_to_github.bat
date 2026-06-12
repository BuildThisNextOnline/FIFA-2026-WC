@echo off
title World Cup 2026 -- Deploy to GitHub
color 0B
echo.
echo  =====================================================
echo   World Cup 2026 Probability Tracker
echo   One-time GitHub deployment helper
echo  =====================================================
echo.

REM -- Check Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python not found.
    echo.
    echo  Please install Python from https://www.python.org/downloads/
    echo  Make sure to tick "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

REM -- Run the setup script
python scripts\setup_github.py
if errorlevel 1 (
    echo.
    echo  Something went wrong. Read the messages above for details.
    echo  Then re-run this file once you have fixed the issue.
)

echo.
pause
