@echo off
REM تشغيل «ميزان» بأمر واحد على ويندوز.
REM   set PORT=8080 && start.bat
cd /d "%~dp0"

if not exist "backend\node_modules" goto setup
if not exist "frontend\dist\index.html" goto setup
goto run

:setup
echo ... first run: installing and building
call npm run setup
if errorlevel 1 exit /b 1

:run
call npm start
