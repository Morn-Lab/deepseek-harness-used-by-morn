@echo off
rem Keep this file ASCII-only for cmd compatibility.
rem Starts a local llama.cpp vision server (llama-server) for the image-note pipeline.
rem Defaults: 127.0.0.1:8080, model files under models\vision\.
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
set "VISION_DIR=%ROOT%models\vision"
set "GGUF=%VISION_DIR%\model.gguf"
set "MMPROJ=%VISION_DIR%\mmproj.gguf"
set "PORT=8080"
if not "%VISION_PORT%"=="" set "PORT=%VISION_PORT%"
if not "%VISION_CTX%"=="" (set "CTX=%VISION_CTX%") else (set "CTX=8192")
if not "%VISION_GPU_LAYERS%"=="" (set "NGL=%VISION_GPU_LAYERS%") else (set "NGL=99")

rem 1. locate llama-server.exe: local tools dir, then PATH, then %LOCALAPPDATA%\llama.cpp
set "LLAMA=%ROOT%tools\llama.cpp\llama-server.exe"
if not exist "%LLAMA%" (
  for /f "delims=" %%i in ('where llama-server 2^>nul') do if not defined LLAMA_PATH set "LLAMA_PATH=%%i"
  if defined LLAMA_PATH set "LLAMA=%LLAMA_PATH%"
)
if not exist "%LLAMA%" (
  if exist "%LOCALAPPDATA%\llama.cpp\llama-server.exe" set "LLAMA=%LOCALAPPDATA%\llama.cpp\llama-server.exe"
)
if not exist "%LLAMA%" (
  echo [vision] llama-server.exe not found.
  echo [vision] Put it at: "%ROOT%tools\llama.cpp\llama-server.exe"
  echo [vision] or install llama.cpp and make sure llama-server is on PATH.
  echo [vision] Download: https://github.com/ggml-org/llama.cpp/releases  ^(win-cuda-x64 zip^)
  pause
  exit /b 1
)

rem 2. require model + vision projector
if not exist "%GGUF%" (
  echo [vision] Missing model file: "%GGUF%"
  echo [vision] Put a vision-capable GGUF there ^(e.g. MiniCPM-V / Qwen*-VL, Q4_K_M^).
  echo [vision] Sources: https://hf-mirror.com  or  https://modelscope.cn  ^(HuggingFace is unreachable here^).
  echo [vision] Details: docs\vision-service.md
  pause
  exit /b 1
)
if not exist "%MMPROJ%" (
  echo [vision] Missing vision projector: "%MMPROJ%"
  echo [vision] The mmproj-*.gguf file is required, otherwise the model cannot see images.
  echo [vision] Details: docs\vision-service.md
  pause
  exit /b 1
)

rem 3. warn when the port is already taken
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [vision] Port %PORT% is already in use. Set VISION_PORT=8081 to pick another one.
  pause
  exit /b 1
)

echo [vision] server : "%LLAMA%"
echo [vision] model  : "%GGUF%"
echo [vision] mmproj : "%MMPROJ%"
echo [vision] listen : http://127.0.0.1:%PORT%/v1   ctx=%CTX%  gpu-layers=%NGL%
echo [vision] In the app: provider base URL http://127.0.0.1:%PORT%/v1 , any model name, any API key.
echo [vision] Stop with Ctrl+C. Close this window to free the VRAM again.
echo.

rem --no-warmup keeps startup fast; single slot is enough for the serialized note queue.
rem --image-min-tokens 1024: Qwen-VL models warn below this; grounding quality drops otherwise.
"%LLAMA%" -m "%GGUF%" --mmproj "%MMPROJ%" --image-min-tokens 1024 -c %CTX% -ngl %NGL% --host 127.0.0.1 --port %PORT% -np 1 --no-warmup --jinja
set "CODE=%ERRORLEVEL%"
echo.
echo [vision] llama-server exited with code %CODE%.
pause
exit /b %CODE%
