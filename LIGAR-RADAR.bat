@echo off
rem Liga o radar ao vivo da Twitch (scripts\radar-ao-vivo.mjs) com dois cliques.
rem Abre na pasta do projeto, pergunta os canais e deixa a janela aberta. Para desligar: Ctrl+C.
rem O radar nunca publica: os cortes ficam em para-postar\ esperando o OK.
rem Texto sem acentos de proposito: o cmd.exe troca os acentos conforme a pagina de codigo.
chcp 65001 >nul
title Radar ao vivo - GTA 6
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado no PATH. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

echo.
echo  RADAR AO VIVO - GTA 6
echo  Pasta: %CD%
echo.
echo  Canais separados por virgula (ex.: coringa,paulinholokobr,luquet4). Canal da Kick: kick:nome (ex.: kick:coringa).
echo  So Enter = todos os canais da Twitch e da Kick dos streamers ativos do streamers.json.
echo.
set "CANAIS="
set /p "CANAIS=  Canais: "
echo.

if "%CANAIS%"=="" (
  node scripts\radar-ao-vivo.mjs %*
) else (
  node scripts\radar-ao-vivo.mjs --canais "%CANAIS: =%" %*
)

echo.
echo  O radar parou (codigo %ERRORLEVEL%). Log em fila\radar.log
pause
