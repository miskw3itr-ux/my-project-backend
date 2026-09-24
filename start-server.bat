@echo off
cd /d "%~dp0"
echo Dar Al-Alef V2 - http://localhost:3001
REM وضع الدخول المفتوح المؤقت (بلا شاشة دخول — كل الصلاحيات): احذف السطر التالي لاسترجاع الدخول
set OPEN_MODE=1
node server.js
pause
