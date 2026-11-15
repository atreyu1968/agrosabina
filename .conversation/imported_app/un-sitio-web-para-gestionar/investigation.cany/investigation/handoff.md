# Handoff

Turno «encabezados y varias hojas» cerrado a nivel de código; compilado y copias idénticas, pero SIN probar en navegador (web_site_open dio consent_required otra vez, y no hay Node.js en el equipo: `node --version` sale 1).

Hecho (todo en app/site, luego build.bat):
1. read.js: pdfTextLayer lee hasta 40 hojas (antes 5) y devuelve {text, pages, total, textos[]} con el texto de cada hoja; pdfScanCanvases 12 por defecto (antes 2) y readFile ya NO corta en la primera hoja que dice «total»; devuelve textos[] también en pdf-ocr e image-ocr.
2. parse.js: `lineaEsEncabezado` (exportada) + PALABRAS_ENCABEZADO ampliado; `liqDespues` busca el número en la misma línea de la etiqueta y solo acepta el de debajo si la etiqueta está sola; `liqAntes` sin cambios de fondo; CAPTURA=30000 (antes 6000) con nota si recorta.
3. nomina.js: importa { lineaEsEncabezado } de parse.js (sin ciclo: parse.js no importa nomina.js) y salta líneas de cabecera al buscar al trabajador.
4. views.js: `hojaEsPapelPropio` + `trocearPorPaginas`; runOne acepta job.preTexto/preSource, trocea y mete las hojas siguientes como trabajos en cola («archivo · página N»), job.trozos pone una nota; paintIngest usa job.name || job.file.name; runPruebas calcula item.trozos y pruebaHtml los lista (.prueba-separa, CSS añadido en styles.css); rawText de la cola a 30.000.
5. build.bat exit 0. site↔dist idénticos 24 ficheros; site/assets↔app/assets idénticos 23. views.js, parse.js, read.js y nomina.js de dist se analizan (js_app_map).

Trampas / pendiente:
- No repetir web_site_open sin permiso explícito; si lo piden, project_preview sirve app/dist en http://127.0.0.1:55267/.
- Quedan 2 `slice(0, 6000)` en views.js sin localizar por línea (offsets 91570 y 187916 del fichero previo): no afectan a la lectura de la cola (ya a 30.000), revisar si se toca la pantalla de pruebas o el correo.
- Riesgo conocido del troceo: una factura de dos hojas donde la segunda repita cabecera y «TOTAL» se partiría en dos; el nombre «· página N» lo deja a la vista para corregirlo a mano. Se descartan como continuación las que dicen «continuación/anexo/resumen».
- Descubierto que un `import`/`export` nuevo obliga a comprobar los dos lados (hecho: 1 export, 3 apariciones de trocearPorPaginas, 2 de lineaEsEncabezado).

