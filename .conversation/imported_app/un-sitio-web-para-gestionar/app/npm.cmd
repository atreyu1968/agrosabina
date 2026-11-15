@echo off
rem npm.cmd: sustituto minimo de npm para este proyecto.
rem
rem En este ordenador no hay Node.js instalado, asi que "npm run build" no
rem arrancaba. El sitio es HTML, CSS y JavaScript sin dependencias: el build
rem solo copia site\ a dist\. Este fichero vive en la carpeta del proyecto y
rem Windows busca los comandos primero en la carpeta actual, de modo que
rem "npm run build" y "npm install" funcionan sin instalar nada.
rem
rem Los argumentos se limpian de comillas antes de compararlos, porque algunos
rem lanzadores anaden una comilla al final del ultimo argumento.
setlocal EnableExtensions
set "HERE=%~dp0"

set "V1=%~1"
if defined V1 set "V1=%V1:"=%"
set "V2=%~2"
if defined V2 set "V2=%V2:"=%"
set "V3=%~3"
if defined V3 set "V3=%V3:"=%"

if not defined V1 goto noargs
if /i "%V1%"=="--version" goto showver
if /i "%V1%"=="-v" goto showver
if /i "%V1%"=="version" goto showver
if "%V1:~0,1%"=="-" goto skipflag
goto dispatch

rem Primera opcion tipo -s o --silent: miramos los argumentos siguientes.
:skipflag
set "V1=%V2%"
set "V2=%V3%"
if not defined V1 goto noargs
if "%V1:~0,1%"=="-" goto skipflag

:dispatch
if /i "%V1%"=="--version" goto showver
if /i "%V1%"=="-v" goto showver
if /i "%V1%"=="version" goto showver
if /i "%V1%"=="install" goto nodeps
if /i "%V1%"=="i" goto nodeps
if /i "%V1%"=="ci" goto nodeps
if /i "%V1%"=="add" goto nodeps
if /i "%V1%"=="update" goto nodeps
if /i "%V1%"=="test" goto nodeps
if /i "%V1%"=="build" goto build
if /i "%V1%"=="run" goto runscript
if /i "%V1%"=="run-script" goto runscript
if /i "%V1%"=="start" goto refuse
if /i "%V1%"=="dev" goto refuse
goto unknown

:runscript
if not defined V2 goto noargs
if /i "%V2%"=="build" goto build
if /i "%V2%"=="build:windows" goto build
if /i "%V2%"=="build-windows" goto build
if /i "%V2%"=="start" goto refuse
if /i "%V2%"=="dev" goto refuse
if /i "%V2%"=="test" goto nodeps
goto unknown

rem Lo que de verdad hace el build: copiar site\ a dist\.
:build
call "%HERE%build.bat"
exit /b %ERRORLEVEL%

:nodeps
echo npm info: este proyecto no tiene dependencias que instalar.
exit /b 0

:showver
echo 10.8.2 (sustituto sin Node.js)
exit /b 0

:noargs
echo Uso: npm run build
echo Copia site\ a dist\ sin necesidad de Node.js.
exit /b 0

:refuse
echo npm error: esto es un sitio estatico; no hay servidor de desarrollo.
echo Usa la vista previa de la aplicacion o cualquier servidor web con dist\.
exit /b 1

:unknown
echo npm error: comando no disponible sin Node.js: %V1% %V2%
echo Aqui solo hacen falta "npm install" y "npm run build".
exit /b 1
