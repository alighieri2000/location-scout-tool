@echo off
set NODE_DIR=C:\Users\dante\AppData\Local\Programs\nodejs-portable\node-v22.16.0-win-x64
set PATH=%NODE_DIR%;%PATH%
cd /d "I:\Claude\location-scout-tool\frontend"
"%NODE_DIR%\node.exe" "%NODE_DIR%\node_modules\npm\bin\npm-cli.js" run dev
