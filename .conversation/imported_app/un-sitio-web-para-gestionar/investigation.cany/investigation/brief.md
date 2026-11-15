# Brief

**Question:** El lector confunde encabezados de tabla con datos y no usa el texto completo; además un mismo archivo puede traer varias nóminas, liquidaciones o facturas en hojas distintas. ¿Dónde ocurre y cómo arreglarlo?

**Purpose:** Que el banco de pruebas y la importación real enseñen fielmente lo que el programa entiende de cada papel, sin mezclar hojas ni tomar rótulos por importes.

**Targets:**
- C:\Users\Javier\Documents\Craft Anything\un-sitio-web-para-gestionar\app

**Constraints:**
- Sitio estático desde app/dist, sin servidor
- Solo se escribe dentro de app/
- Build con cmd /c build.bat en app/, sin Node.js
- Tres copias idénticas: site, dist y raíz de app
- No romper datos guardados
- Interfaz en español
- Nada sale del ordenador
- Nada de pruebas en navegador sin permiso

**Done when:** Ningún rótulo de columna se convierte en importe, kilos, fecha o nombre; se usa el texto completo de todas las hojas; cada hoja que es un papel distinto se guarda como documento aparte; build.bat sale 0 y las tres copias son idénticas y se analizan sin errores.
