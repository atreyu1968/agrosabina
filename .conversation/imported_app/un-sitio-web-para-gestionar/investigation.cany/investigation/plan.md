# Plan

1. [done] Ver dónde se corta el texto (tope de páginas y de caracteres) — read.js leía 5 páginas de PDF y 2 de escaneo, y se paraba en la primera que nombraba el total; views.js cortaba el texto en 6.000 caracteres
2. [done] Evitar que una fila de encabezado dé números — lineaEsEncabezado + liqDespues por línea en parse.js; guardas en nomina.js
3. [done] Separar varias hojas en varios documentos — trocearPorPaginas y hojaEsPapelPropio en views.js; cada trozo entra en la cola como documento propio
4. [done] Recompilar y comprobar copias y sintaxis — build.bat sale 0; site=dist idénticos (24 ficheros) y los módulos se analizan
5. [blocked] Probarlo en el navegador — web_site_open volvió a dar consent_required
