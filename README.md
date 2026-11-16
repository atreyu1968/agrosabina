# Agrosabina

Aplicación local de gestión contable para Agrosabina. Guarda la contabilidad y los documentos en el servidor Ubuntu donde se instala.

## Instalación inicial en Ubuntu sin Git ni curl

Estas instrucciones instalan una copia nueva descargada desde GitHub. No ejecutan `apt update`, `apt upgrade`, ni el comando de actualización de Agrosabina. Tampoco requieren instalar o utilizar `git` o `curl`.

La instalación sí necesita conexión a Internet para descargar los archivos desde el navegador e instalar las dependencias del proyecto desde el registro de paquetes de Node.js.

### Requisitos

- Ubuntu de 64 bits (arquitectura x86_64) con systemd.
- Una cuenta con permisos de administrador (`sudo`).
- Navegador web y conexión a Internet.
- Herramientas incluidas normalmente en Ubuntu: `tar`, `useradd`, `systemctl`, `runuser` y `journalctl`.
- Espacio libre para el código, las dependencias, la base de datos y los documentos.

No ejecutes `apt upgrade` ni el instalador automático `scripts/ubuntu/agrosabina.sh` para este procedimiento. Ese instalador está pensado para otra modalidad y utiliza Git y curl.

### 1. Descarga el código desde el navegador

1. Abre [el repositorio de Agrosabina](https://github.com/atreyu1968/agrosabina).
2. Pulsa **Code → Download ZIP**.
3. Guarda el archivo en la carpeta `Descargas` de Ubuntu y extráelo allí. Debe quedar una carpeta llamada `agrosabina-main`.

Si el navegador usa el nombre `Downloads` en lugar de `Descargas`, sustituye `Descargas` por `Downloads` en los comandos siguientes.

### 2. Descarga Node.js 24 desde el navegador

Agrosabina necesita Node.js 24 por la base de datos SQLite integrada en esa versión.

1. Abre el [directorio oficial de descargas de Node.js 24](https://nodejs.org/dist/latest-v24.x/).
2. Descarga el archivo cuyo nombre termina en `linux-x64.tar.xz` (no el que termina en `headers.tar.xz`).
3. Guarda el archivo en `Descargas`.

Comprueba que Ubuntu reconoce la arquitectura:

```bash
uname -m
```

El resultado debe ser `x86_64`. Si muestra otra arquitectura, no uses el archivo `linux-x64`.

### 3. Instala Node.js y pnpm

Abre Terminal y ejecuta:

```bash
NODE_ARCHIVE="$(find "$HOME/Descargas" -maxdepth 1 -type f -name 'node-v24.*-linux-x64.tar.xz' -print -quit)"
test -n "$NODE_ARCHIVE" || { echo "No se encontró el archivo de Node.js 24 en Descargas"; exit 1; }

sudo tar -xJf "$NODE_ARCHIVE" -C /opt
NODE_DIR="$(basename "$NODE_ARCHIVE" .tar.xz)"
sudo ln -sfn "/opt/$NODE_DIR" /opt/node24

export PATH="/opt/node24/bin:$PATH"
node --version
npm --version
```

`node --version` debe mostrar una versión `v24.x.x`. Instala la versión de pnpm usada por el proyecto:

```bash
sudo env PATH="/opt/node24/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" npm install --global pnpm@10.26.1
pnpm --version
```

El comando `sudo` puede solicitar la contraseña de tu usuario de Ubuntu.

### 4. Copia la aplicación y prepara las carpetas

El siguiente comando espera que el ZIP se haya extraído como `~/Descargas/agrosabina-main`:

```bash
test -d "$HOME/Descargas/agrosabina-main" || { echo "No se encontró Descargas/agrosabina-main; comprueba dónde extrajiste el ZIP"; exit 1; }
sudo install -d -m 0755 /opt/agrosabina
sudo cp -a "$HOME/Descargas/agrosabina-main/." /opt/agrosabina/

sudo useradd --system --home-dir /var/lib/agrosabina --create-home --shell /usr/sbin/nologin agrosabina
sudo install -d -o agrosabina -g agrosabina -m 0750 /var/lib/agrosabina
sudo install -d -o root -g root -m 0755 /etc/agrosabina
sudo chown -R agrosabina:agrosabina /opt/agrosabina
```

Estos comandos son para una primera instalación. No los repitas sobre una instalación existente: la carpeta de datos contiene la base de datos, los documentos y la clave que protege credenciales guardadas.

### 5. Instala dependencias y compila

```bash
sudo -u agrosabina env HOME=/var/lib/agrosabina PATH=/opt/node24/bin:/usr/bin:/bin bash -c '
  set -e
  cd /opt/agrosabina
  pnpm install --frozen-lockfile
  PORT=8080 BASE_PATH=/ pnpm --filter @workspace/agrosabina run build
  pnpm --filter @workspace/api-server run build
'
```

La instalación de dependencias puede tardar varios minutos. Si falla por falta de conexión o porque el ZIP está incompleto, resuelve el problema antes de continuar.

### 6. Crea la configuración inicial protegida

Este paso crea un código aleatorio de un solo uso para registrar al primer administrador:

```bash
SETUP_TOKEN="$(/opt/node24/bin/node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"

sudo tee /etc/agrosabina/agrosabina.env >/dev/null <<EOF
NODE_ENV=production
DATA_DIR=/var/lib/agrosabina
PORT=8080
HOST=127.0.0.1
TRUST_PROXY=false
APP_PUBLIC_URL=
APP_SETUP_TOKEN=$SETUP_TOKEN
EOF

sudo chown root:root /etc/agrosabina/agrosabina.env
sudo chmod 0600 /etc/agrosabina/agrosabina.env
printf 'Código de instalación (úsalo una sola vez): %s\n' "$SETUP_TOKEN"
unset SETUP_TOKEN
```

Guarda temporalmente el código que aparece en la terminal. No lo publiques ni lo envíes a otras personas. Lo necesitarás en el primer acceso.

### 7. Configura el servicio de Ubuntu

```bash
sudo tee /etc/systemd/system/agrosabina.service >/dev/null <<'EOF'
[Unit]
Description=Agrosabina
After=network.target

[Service]
Type=simple
User=agrosabina
Group=agrosabina
WorkingDirectory=/opt/agrosabina
EnvironmentFile=/etc/agrosabina/agrosabina.env
Environment=STATIC_DIR=/opt/agrosabina/artifacts/agrosabina/dist/public
ExecStart=/opt/node24/bin/node --enable-source-maps /opt/agrosabina/artifacts/api-server/dist/index.mjs
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/agrosabina

[Install]
WantedBy=multi-user.target
EOF

sudo chmod 0644 /etc/systemd/system/agrosabina.service
sudo systemctl daemon-reload
sudo systemctl enable --now agrosabina
```

Comprueba que el servicio está activo:

```bash
systemctl is-active agrosabina
```

Debe responder `active`. Si no lo hace, consulta el error:

```bash
sudo journalctl -u agrosabina -n 100 --no-pager
```

### 8. Crea el primer administrador

En el propio Ubuntu, abre [http://127.0.0.1:8080](http://127.0.0.1:8080). Introduce el código de instalación y completa el formulario para crear el primer administrador. Usa una contraseña de al menos 12 caracteres. Una vez creado, el código deja de permitir la creación inicial de otra cuenta.

Desde la aplicación, el administrador puede autorizar las demás cuentas. Para recuperar contraseñas por correo, configura Resend y un remitente verificado en **Ajustes → Administración de cuentas y correo**.

### Acceso desde otros dispositivos

Por seguridad, el servicio solo escucha en `127.0.0.1`, es decir, en el propio Ubuntu. No abras el puerto 8080 directamente a Internet. Para acceder desde otros equipos o instalar la PWA en un móvil, primero hace falta configurar una dirección HTTPS y un proxy inverso.

### Datos y diagnóstico

- Aplicación: `/opt/agrosabina`
- Base de datos, documentos y clave de cifrado: `/var/lib/agrosabina`
- Configuración privada: `/etc/agrosabina/agrosabina.env`
- Estado del servicio: `systemctl status agrosabina`
- Registro del servicio: `sudo journalctl -u agrosabina -n 100 --no-pager`

No borres `/var/lib/agrosabina`: contiene los datos contables y los documentos originales. Conserva también una copia segura de esa carpeta para poder recuperar la instalación.
