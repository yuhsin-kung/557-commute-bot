@echo off
chcp 65001 >nul
title 557 監測（含人數）- 要結束請按 Ctrl+C
cd /d "%~dp0.."
where uv >nul 2>nul || (echo 找不到 uv，請先安裝：winget install astral-sh.uv & pause & exit /b 1)
uv run tools\557監測.py %*
echo.
echo 監測已結束，結果在 data\557監測 資料夾，可以關掉這個視窗。
if exist "data\557監測" start "" "data\557監測"
pause
