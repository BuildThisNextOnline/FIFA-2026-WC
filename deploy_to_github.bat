@echo off
title World Cup 2026 -- Deploy to GitHub
color 0B
echo.
echo  =====================================================
echo   World Cup 2026 Probability Tracker
echo   One-click GitHub deployment
echo  =====================================================
echo.

REM -- Check Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python not found.
    echo.
    echo  Please install Python from https://www.python.org/downloads/
    echo  Make sure to tick "Add Python to PATH" during installation.
    echo  Then re-run this file.
    echo.
    pause
    exit /b 1
)

REM -- Open config in Notepad if it still has placeholder values
python -c "import json,sys; c=json.load(open('github_config.json')); sys.exit(0 if c.get('github_token','').startswith('ghp_Y') or c.get('github_username','')=='YOUR_GITHUB_USERNAME' else 1)" >nul 2>&1
if not errorlevel 1 (
    echo  github_config.json needs your credentials.
    echo  Opening it in Notepad now -- fill in your details, save, then close Notepad.
    echo.
    notepad github_config.json
    echo  Continuing with deployment...
    echo.
)

REM -- Run the deployment script
python scripts\setup_github.py
if errorlevel 1 (
    echo.
    echo  Deployment did not complete. Read the messages above.
    echo  Fix github_config.json if needed, then re-run this file.
)

echo.
pause
