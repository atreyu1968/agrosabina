@echo off
rem Copia el logo que dio la empresa dentro del sitio, para que el sitio no
rem dependa de la carpeta de adjuntos y viaje con las tres copias.
if not exist "site\assets\img" mkdir "site\assets\img"
copy /y "..\attachments\picture-1.png" "site\assets\img\agrosabina.png" >nul
if errorlevel 1 (
  echo No he podido copiar el logo.
  exit /b 1
)
echo Logo copiado a site\assets\img\agrosabina.png
exit /b 0
