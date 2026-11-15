@echo off
REM Compila el sitio sin necesidad de Node.
REM Copia la fuente (site\) a dist\, que es lo que se publica, y deja tambien
REM el sitio servible en la raiz de app\ (index.html + assets\).
cd /d "%~dp0"

if not exist "site\index.html" (
  echo No encuentro site\index.html: no hay nada que copiar.
  exit /b 1
)

rem --- 1. La copia publicable ------------------------------------------------
if exist dist rmdir /s /q dist
xcopy site dist /E /I /Y >nul
if errorlevel 1 (
  echo No se pudo copiar el sitio a dist.
  exit /b 1
)

rem --- 2. El sitio en la raiz de app\ ---------------------------------------
xcopy "site\index.html" . /Y >nul
if errorlevel 1 (
  echo No se pudo copiar index.html a la raiz de app\.
  exit /b 1
)
xcopy "site\assets" "assets" /E /I /Y >nul
if errorlevel 1 (
  echo No se pudieron copiar los assets a la raiz de app\.
  exit /b 1
)

echo Sitio copiado a dist\ y a la raiz de app\
