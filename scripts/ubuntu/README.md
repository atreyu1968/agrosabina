# Instalar y actualizar Agrosabina en Ubuntu

El instalador crea un servicio local de systemd. El código queda en `/opt/agrosabina`, los datos contables y documentos en `/var/lib/agrosabina`, y la configuración protegida en `/etc/agrosabina`.

## Instalación

Clona el repositorio y ejecuta el instalador con permisos de administrador:

```bash
git clone --depth 1 https://github.com/atreyu1968/agrosabina.git ~/agrosabina-bootstrap
sudo ~/agrosabina-bootstrap/scripts/ubuntu/agrosabina.sh install
```

La instalación no pide datos de forma interactiva. Al terminar, el instalador muestra un código de un solo uso. Abre `http://127.0.0.1:8080` en el propio Ubuntu, introduce ese código y crea el primer administrador con su correo y una contraseña de al menos 12 caracteres. No compartas el código de instalación.

Después, desde **Ajustes → Administración de cuentas y correo**:

1. Autoriza a las demás personas creando sus cuentas.
2. Configura una clave API de Resend y un remitente verificado.
3. Indica la dirección pública de la aplicación si los enlaces de recuperación deben abrirse desde otros equipos.

El servidor escucha solo en `127.0.0.1` de forma predeterminada. Para acceder desde otros equipos, configura HTTPS mediante un proxy inverso antes de exponerlo a la red. No publiques el puerto de la aplicación directamente en Internet.

## Actualización

```bash
sudo /opt/agrosabina/scripts/ubuntu/agrosabina.sh update
```

La actualización comprueba que no haya cambios manuales en el repositorio, crea una copia de la base de datos y los documentos en `/var/backups/agrosabina/`, descarga solo avances de la rama `main`, compila y comprueba el servicio. Si falla la compilación o la comprobación, restaura el código anterior; si la nueva versión llegó a iniciarse, también restaura los datos guardados antes de la actualización.

## Comprobaciones y datos

```bash
sudo /opt/agrosabina/scripts/ubuntu/agrosabina.sh status
sudo journalctl -u agrosabina -n 100
```

- Copias generadas antes de actualizar: `/var/backups/agrosabina/`.
- Base de datos, documentos originales y clave de cifrado: `/var/lib/agrosabina/`.
- Configuración del servicio y código inicial: `/etc/agrosabina/agrosabina.env`.

No borres la carpeta de datos ni la configuración al actualizar. El código de instalación permanece en el archivo de configuración, pero solo sirve mientras la base no tenga un administrador; se puede retirar de `APP_SETUP_TOKEN` después de crear la cuenta inicial.
