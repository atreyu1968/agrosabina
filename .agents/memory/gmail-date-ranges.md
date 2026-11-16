---
name: Fechas y estado de lectura en Gmail
description: Semántica del intervalo de recepción de correo y correos leídos.
---

El intervalo de Gmail corresponde a la recepción del correo, no a la emisión de la factura adjunta. Incluye completos los dos días elegidos en horario de Canarias, también durante los cambios de horario. La fecha fiscal del documento se valida separadamente frente al ejercicio.

**Why:** el usuario pidió verificar la importación entre fechas; los límites no deben depender de la zona horaria implícita del buscador ni de la cabecera enviada por el remitente.

**How to apply:** usar límites temporales explícitos y comprobar también la recepción al descargar cada correo. Mantener el mismo intervalo al paginar y mostrar sus fechas en la misma zona.

Incluir correos abiertos y no leídos. Haber abierto un mensaje no significa haber importado su documento.

**Why:** el usuario indicó «debe incluir correos ya abiertos».

**How to apply:** no filtrar por estado de lectura; conservar por separado las comprobaciones de documentos ya importados para evitar duplicados.
