# Agrosabina SL · Compras, proveedores e IGIC

Un sitio web para llevar las compras y los documentos de **Agrosabina SL** (Canarias).
Se suben fotos o PDF, el programa lee los datos, crea solo la ficha del proveedor y deja
cada documento como **PAGADO** o **PENDIENTE**, con el IGIC desglosado. La sección se llama
**Compras** (antes «Facturas»); la dirección `#/facturas` sigue funcionando y lleva a
`#/compras`.

## La marca

El logotipo de la empresa es `site/assets/img/agrosabina.png` (el fichero que dio
Agrosabina, 429×179 px con transparencia). Se usa tal cual en la barra lateral, como
icono de la pestaña del navegador y en el icono de la pantalla de inicio del móvil.

En la barra lateral va **sin recuadro**: se enseña a su proporción (168 px de ancho como
mucho, 30 px de alto en el móvil) y con `mix-blend-mode: multiply`, para que el blanco del
PNG se funda con la barra blanca. Debajo solo queda una línea pequeña de texto
(«Compras, liquidaciones e IGIC»); el nombre ya está en el propio logotipo, así que no se
repite en grande.

Para cambiarlo, sustituye ese fichero por otro y vuelve a ejecutar `build.bat`. El nombre
«Agrosabina SL» está en el `alt` de la imagen (`site/index.html`) y en el valor por
defecto de los ajustes (`businessName` en `store.js`).

Todo ocurre dentro del navegador: los documentos y los datos **no se envían a ningún
servidor**. Se guardan en una base de datos **SQLite** que vive dentro del navegador
(ver más abajo), con una copia de seguridad en `localStorage`.

## Qué documentos entiende

Agrosabina no emite facturas: **recibe** liquidaciones y pagos de fruta y subvenciones, y
paga agua, luz, laborales, servicios externos, fitosanitarios, abonos… Por eso cada
documento tiene un **tipo** y, según el tipo, un **sentido** (lo que entra o lo que sale):

| Tipo | Sentido | Conceptos habituales |
| --- | --- | --- |
| Factura recibida | Gasto | agua, electricidad, laborales, servicios externos, fitosanitarios, abonos, combustible, impuestos |
| Nómina o coste laboral | Gasto | laborales y Seguridad Social |
| Liquidación de fruta | Ingreso | fruta (alhóndiga, cooperativa, kilos, calibre, precio/kg) |
| Subvención o ayuda | Ingreso | subvenciones (FEADER, FEAGA, pago único, Consejería) |
| Cobro o abono recibido | Ingreso | fruta |
| Otro documento | Gasto | otros |

El tipo y el concepto se rellenan solos con un **clasificador de reglas** (`model.js`) que
busca en el texto ya leído palabras conocidas («Endesa», «nómina», «glifosato», «alhóndiga»,
«subvención»…). Siempre se pueden corregir en la ficha del documento, con dos desplegables.
El resumen enseña **ingresos, gastos y resultado**, y en qué se va el dinero por concepto.

## El IGIC, producto a producto

El IGIC cambia según lo que se compra: no es lo mismo el agua o un abono que un servicio o
un producto al tipo general. Por eso un mismo documento puede llevar **varios tipos**.

En la ficha del documento, debajo de la base y del total, está **«Varios tipos de IGIC en el
mismo documento»**. Cada línea tiene su base y su tipo (`0 · 3 · 7 · 9,5 · 15 · 20 %`, los
mismos que ofrece el desplegable de siempre). Al escribir una base:

- la **base**, la **cuota** y el **total** de arriba se recalculan sumando todas las líneas;
- debajo aparece el resumen («2 tipos · base 300,00 € · IGIC 12,00 € · total 312,00 €»);
- si todas las líneas comparten tipo, el desplegable de tipo se pone solo en ese valor.

En la lista de compras, el tipo pequeño bajo la cuota dice «2 tipos» cuando el documento
lleva varios, y en la base de datos la columna `lineas` guarda las líneas como JSON. Un
documento sin líneas se comporta exactamente como antes: un solo tipo para todo.

Se guardan los importes con dos decimales y en formato español (`1.234,56 €`).

## Las liquidaciones de fruta

Una liquidación no trae un solo importe: trae **kilos, precio por kilo y descuentos**.
Cuando el tipo de documento es «Liquidación de fruta» aparece en la ficha un bloque con:

- **Producto o variedad** (opcional): plátano, aguacate, tomate…
- **Categoría** (opcional): extra, primera, segunda, destrío… Se escribe o se elige de la
  lista; sirve para ver después cómo se reparten los kilos entre calidades.
- **Kilos** entregados y **precio por kilo** (hasta tres decimales, p. ej. `0,853 €/kg`).
- **Descuentos**, una línea por concepto e importe (manipulación, envases, comisión de
  venta, transporte, seguros…). Se añaden y se quitan con los botones del bloque.

Al escribir, el programa calcula solo: `kilos × precio = bruto`, resta los descuentos y
deja el **líquido a percibir**, que pasa a la base y al total del documento (con el IGIC
del desplegable, que en la fruta del agricultor suele ser 0 %). Debajo aparece la cuenta
completa: «1.240 kg × 0,853 €/kg = 1.057,72 € − 92,00 € de descuentos · líquido a percibir
965,72 €».

En la base de datos, la columna `liquidacion` guarda `product`, `category`, `kg`, `price` y
la lista `discounts` como JSON; el bruto y el líquido no se guardan porque se recalculan.
Si el texto leído de la foto o del PDF trae los kilos y el precio por kilo, se rellenan
solos; si no, basta escribirlos a mano.

## Ventas e ingresos

La sección **Ventas** (menú de la izquierda) es el otro lado del negocio: lo que entra.
Arriba se pueden **subir las liquidaciones** (fotos o PDF, varios a la vez), hacer una foto
con la cámara o escribir una a mano; todas pasan por el mismo lector de siempre, así que se
rellenan solas.

Debajo se ven los **acumulados del periodo**:

- **Kilos vendidos**, cuántas liquidaciones traen kilos y de cuántos documentos en total.
- **Precio medio** por kilo (bruto entre kilos) y el bruto del periodo.
- **Peso medio por entrega**: kilos entre liquidaciones que traen kilos.
- **Líquido a percibir**: bruto menos descuentos.
- **Ingresos del periodo** (todo lo que entra: liquidaciones, subvenciones, cobros), con lo
  cobrado y lo que sigue pendiente.
- **Descuentos** y qué porcentaje del bruto representan.

Y tres desgloses con la misma cuenta —kilos, precio medio y líquido— **por producto**, **por
categoría** (extra, primera, segunda…) y **por comprador**, más una tabla **mes a mes**. Al
final está la lista de liquidaciones del periodo, con sus kilos, su precio por kilo y su
estado, y un botón para **exportar a CSV** todo lo que se está viendo.

El **periodo** se elige arriba: este mes, este trimestre, este año, los últimos doce meses
(una campaña), todo lo registrado o dos fechas a mano. Todo lo de la pantalla —cifras,
desgloses, lista y exportación— cambia con el periodo.

No hay ninguna tabla nueva en la base de datos: las cuentas se sacan de las liquidaciones ya
guardadas (`liquidacion`), así que una liquidación antigua cuenta igual.

## El correo

Un navegador **no puede conectarse a un buzón** (IMAP/POP necesita un servidor, y este sitio
son ficheros estáticos). Lo que sí puede: leer los correos **guardados como fichero `.eml`**.

En la pantalla **Correo** se sueltan uno o varios `.eml`:

- Gmail — abrir el mensaje → «Mostrar original» → descargar.
- Outlook — arrastrar el mensaje al escritorio (o «Guardar como»).
- Thunderbird — «Guardar como» → «Archivo».

El programa lee la cabecera (de, asunto, fecha), el cuerpo (incluidos los adjuntos en
Base64, los codificados «quoted-printable» y los acentos del asunto) y los adjuntos. Los
adjuntos que son PDF o imagen **entran solos en la cola de lectura**, como si se hubieran
subido a mano. Cada correo se puede revisar después con «Leer y revisar», o borrar. También
hay un botón para **pegar el texto** de un correo que no se pueda guardar.

Los correos se guardan dentro del navegador, junto a los documentos: no salen del ordenador.

## La clasificación con IA (opcional)

En **Ajustes → Clasificación con IA** se puede encender una ayuda con IA para decidir tipo y
concepto de cada documento. Funciona con cualquier servicio **compatible con OpenAI**: OpenAI,
Groq, OpenRouter, o un modelo local (Ollama, LM Studio). Se pega la dirección, el nombre del
modelo y la clave de ese servicio; la clave se guarda solo en este navegador.

- Va **apagada** por defecto.
- Solo se envía el **texto ya extraído** del documento (unas líneas), nunca la foto ni el PDF.
- Las reglas se aplican **primero**; la IA solo afina. Si falla (sin clave, sin internet, el
  servicio responde mal), se queda el resultado de las reglas y se avisa con un mensaje.
- «Probar la IA» manda una frase inventada y enseña la respuesta, sin tocar ningún documento.

Si esto no encaja con «tener acceso al buzón», la alternativa de verdad es un pequeño
servidor que lea el correo por IMAP; entonces los documentos ya no estarían solo en este
ordenador. Eso es una decisión de la empresa, no un detalle del programa.

## La base de datos

Los proveedores, las facturas y los ajustes están en una base de datos SQLite de verdad,
creada con [sql.js](https://sql.js.org) (SQLite compilado a WebAssembly). El fichero de la
base de datos se guarda como bytes en **IndexedDB** (`facturas.igic`), porque `localStorage`
solo admite texto y unos 5 MB.

Tablas:

- `proveedores` — id, nombre, NIF, email, teléfono, nota, fecha de alta.
- `facturas` — número, fechas, base, tipo de IGIC, cuota, total, estado (`PAGADO` /
  `PENDIENTE`, con `CHECK`), fecha de pago, origen, nombre del fichero, texto leído,
  notas y confianza de la lectura, más `tipo` (factura, liquidación, subvención…),
  `categoria` (agua, luz, laborales…), `sentido` (`INGRESO` / `GASTO`), `lineas` (una
  base y un tipo de IGIC por línea) y `liquidacion` (kilos, precio y descuentos de la
  fruta). La clave de proveedor es una clave foránea con `ON DELETE CASCADE`.
- `correos` — los `.eml` guardados: de, asunto, fecha, texto, adjuntos (en JSON) y
  cuándo se importaron y se revisaron.
- `ajustes` — clave y valor.
- Vista `igic_por_proveedor` — base, cuota y total ya sumados por proveedor y estado.

`PRAGMA foreign_keys = ON` y `user_version = 4`. Una base de datos de la versión anterior se
completa sola: `sqlite.js` mira `PRAGMA table_info(facturas)` y añade las columnas que falten
(`ALTER TABLE … ADD COLUMN`), sin perder nada. Las columnas `tipo`, `categoria`, `sentido`,
`lineas` y `liquidacion` llegaron así.

En **Ajustes → Base de datos SQLite** se ve cuántas filas hay y se puede **descargar el
fichero `.sqlite`** tal cual, que se abre con DB Browser for SQLite o con cualquier
programa de SQLite. Los datos de la versión anterior (solo `localStorage`) se pasan a
SQLite la primera vez que se abre.

Si el navegador no puede cargar sql.js (sin conexión la primera vez, o algo lo bloquea),
el sitio guarda como antes en `localStorage` y avisa con un mensaje: todo sigue
funcionando.

## La cámara

El botón **Hacer una foto** abre la cámara dentro de la página (`getUserMedia`): se ve lo
que enfoca, se dispara con un botón, se pueden hacer **varias fotos seguidas** (una factura
de dos hojas) y al terminar se pasan todas a la cola de lectura. Hay botón para cambiar
entre cámara trasera y delantera.

La cámara del navegador solo funciona con `https://` o en `localhost`. Si no está
disponible, o si se niega el permiso, se abre el selector de archivos del sistema, que en
un móvil también ofrece la cámara.

## Cómo está hecho

- `site/` — la fuente: HTML, CSS y JavaScript sin dependencias ni compilación.
- `dist/` — el resultado, listo para servir tal cual. **Esto es lo que se publica.**
- `index.html` y `assets/` en la raíz de `app/` — la misma copia del sitio, generada por
  el build, para poder servirlo también desde aquí sin depender del paso de copia.

Es un sitio estático: no hay nada que compilar, solo copiar. El build hace esa copia:

```
build.bat            # en Windows, sin Node.js
npm run build        # también vale: lo resuelve el npm.cmd del proyecto
```

### Sobre npm y Node.js

Este ordenador no tiene Node.js, así que un `package.json` con un script `build`
habría hecho fallar el build (`npm.cmd no está en el PATH`). Como el sitio no
necesita ninguna herramienta de Node, el manifiesto se guarda aparte, como
`package.reference.json`, y el proyecto se construye con `build.bat`, que copia
`site/` a `dist/` y a la raíz de `app/`.

El `npm.cmd` que hay en la carpeta sigue ahí por comodidad: responde a `npm install`
(no hay nada que instalar) y a `npm run build` llamando a `build.bat`. Si algún día
se instala Node.js de verdad, `tools/build.mjs` hace exactamente lo mismo.

## Cómo abrirlo

Hay que **servir** el sitio (por ejemplo con el botón de vista previa de la aplicación, o
con cualquier servidor web) y entrar por la dirección que da. Sirve tanto `app/` como
`app/dist/`. No conviene abrir `index.html` con doble clic: los navegadores bloquean el
código de una página que viene del disco y solo se vería un aviso. En ese caso el sitio lo
explica en pantalla en lugar de quedarse en blanco.

## Qué lee de una factura

| Dato | De dónde sale |
| --- | --- |
| Proveedor | Nombre y NIF/CIF de la cabecera (descarta los del cliente) |
| Nº de factura | «Factura nº», «Fra.», series tipo `F-2024/012` |
| Fecha y vencimiento | Formatos `dd/mm/aaaa`, `12 de marzo de 2024`, ISO |
| Base imponible | «Base imponible», «Importe» |
| IGIC | Tipo en % y cuota (0 %, 3 %, 7 %, 9,5 %, 15 %, 20 %) |
| Total | «Total factura» |
| Estado | «Pagado», «Recibo», «Pendiente», «Vencido» |

Si falta un importe pero los demás cuadran, lo calcula (base × tipo, total − base…) y lo
marca como calculado para que se vea de un vistazo.

## Cómo lee los documentos

- **PDF de texto** (los que genera el programa de facturación): lee el texto incrustado
  con PDF.js. Es instantáneo y exacto.
- **PDF escaneado o foto**: dibuja la página en un lienzo (a unos 2100 px de ancho, más
  nítido para el texto pequeño) y la pasa por OCR con Tesseract.js en español. De un PDF
  escaneado lee hasta dos páginas si en la primera no aparece el total.

Antes de leer, la foto se pone en gris y se le estira el contraste, y las imágenes
pequeñas se amplían.

Para acertar más, el OCR no se queda con la primera lectura:

1. Lectura normal (un bloque de texto).
2. Otra pasada buscando **columnas**, que es como van los importes en muchas facturas.
3. Otra sobre la imagen en **blanco y negro puro** (umbral de Otsu).
4. Si la confianza es baja, se prueba la foto **girada** 90°, 270° y 180°.

De todas las lecturas se queda la que mejor puntúa: confianza del lector **más** los datos
de factura que el analizador reconoce (proveedor, número, fecha, base, cuota, total). Y en
los importes se corrigen las letras que el OCR confunde con números (`O`→0, `l`→1, `S`→5,
`B`→8).

Las bibliotecas (PDF.js, Tesseract.js y sql.js) se cargan de un CDN la primera vez que se
usan. Sin conexión el sitio sigue funcionando: se pueden escribir las facturas a mano o
pegar el texto de la factura, y el mismo lector extrae los datos.

## Interpretación con IA (opcional, apagada)

En **Ajustes** hay un bloque «Interpretación con IA». Viene apagado y sin clave: mientras
esté así, el programa solo usa sus reglas y no sale nada del ordenador.

- **Servicio**: DeepSeek (el de por defecto), OpenAI, Groq u «otro servicio compatible».
  Los tres hablan el mismo idioma (`/chat/completions` con una clave), así que solo cambian
  la dirección y el nombre del modelo; al elegir uno se rellenan solos.
- **Clave**: se guarda en este navegador, junto a los documentos. Se saca en la web del
  servicio elegido.
- **Probar la conexión**: pregunta al servicio por una frase corta y enseña la respuesta y
  qué tipo de documento y qué concepto entiende de un texto de ejemplo.

Cómo se usa al leer un documento:

1. Primero trabajan las reglas del programa, como siempre.
2. Si la IA está encendida, se le manda **solo el texto ya leído** (nunca la foto ni el
   PDF) y se le pide tipo, concepto, proveedor, NIF, número, fechas, base, IGIC, total y,
   si es una liquidación, kilos, precio, descuentos y categoría.
3. Lo que contesta **solo rellena huecos**: nunca pisa un dato que las reglas ya han
   leído. La liquidación de la IA solo se acepta cuando las reglas no la han sabido leer.
4. Si la IA falla (sin internet, clave mal, respuesta rara), se sigue con las reglas y se
   avisa en la ventana de revisión.
5. Los datos que vengan de la IA se marcan en la revisión: «Estos datos los ha leído la IA
   (modelo) y no las reglas: …».

## Fecha de cobro y de pago

Cada documento guarda el día en que se cobró (si es un ingreso) o se pagó (si es un gasto).

- Al pulsar el estado en una lista o en la ficha, se pregunta la fecha con la de **hoy**
  puesta; se puede cambiar o cancelar.
- Volver a «Pendiente» borra esa fecha, porque ya no hay cobro ni pago.
- En el formulario del documento, al marcar «Cobrado» o «Pagado» aparece el campo de la
  fecha; si se deja vacío se guarda la de hoy.
- La fecha sale junto al estado en las listas («Cobrado · 12/03/2025») y en la ficha, y
  viaja en el CSV de «Ventas e ingresos».
- Se guarda en la columna `fecha_pago`, que ya existía en la base de datos, así que no hay
  que migrar nada.

