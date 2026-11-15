/*
 * Informes en PDF, hechos aquí mismo, sin internet.
 *
 * No usa ninguna biblioteca de fuera: escribe el fichero PDF a mano, que para
 * un informe de texto con líneas y tablas es más que suficiente. Las fuentes
 * son las dos Helvetica que todo lector de PDF trae (normal y negrita), en su
 * versión latina, así que las tildes y el símbolo del euro salen bien.
 *
 * Cada informe se describe con una lista de bloques (título, subtítulo,
 * párrafo, tabla…) y esta función lo convierte en las hojas del PDF.
 */

const PAGINA = {
  vertical: { w: 595.28, h: 841.89 },
  horizontal: { w: 841.89, h: 595.28 },
};

const MARGEN = 42;

/** Lo que ocupa cada carácter de Helvetica, en milésimas de su tamaño. */
const ANCHOS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Los caracteres que en el PDF van en un sitio distinto del de Unicode. */
const ESPECIALES = {
  "€": 128,
  "‚": 130,
  "ƒ": 131,
  "„": 132,
  "…": 133,
  "†": 134,
  "‡": 135,
  "ˆ": 136,
  "‰": 137,
  "Š": 138,
  "‹": 139,
  "Œ": 140,
  "Ž": 142,
  "‘": 145,
  "’": 146,
  "“": 147,
  "”": 148,
  "•": 149,
  "–": 150,
  "—": 151,
  "˜": 152,
  "™": 153,
  "š": 154,
  "›": 155,
  "œ": 156,
  "ž": 158,
  "Ÿ": 159,
};

/** Un carácter cualquiera, en el número de byte que entiende el PDF. */
function byteDe(ch) {
  const code = ch.codePointAt(0);
  if (code < 256) return code;
  return ESPECIALES[ch] == null ? 63 : ESPECIALES[ch];
}

/** El texto ya listo para meterlo entre paréntesis en el PDF. */
function textoPdf(value) {
  const s = String(value == null ? "" : value);
  let out = "";
  for (const ch of s) {
    const b = byteDe(ch);
    if (b === 40 || b === 41 || b === 92) out += "\\" + String.fromCharCode(b);
    else if (b < 32 || b === 127) out += " ";
    else out += String.fromCharCode(b);
  }
  return out;
}

/** Lo ancho que queda un texto, en puntos, con ese tamaño de letra. */
function anchoTexto(value, tam, negrita) {
  const s = String(value == null ? "" : value);
  let unidades = 0;
  for (const ch of s) {
    const b = byteDe(ch);
    const ancho = b >= 32 && b <= 126 ? ANCHOS[b - 32] : b === 128 ? 556 : 556;
    unidades += ancho;
  }
  const total = (unidades * tam) / 1000;
  return negrita ? total * 1.045 : total;
}

/** Recorta un texto con puntos suspensivos si no cabe en el ancho dado. */
function recorta(value, maxAncho, tam, negrita) {
  const s = String(value == null ? "" : value);
  if (anchoTexto(s, tam, negrita) <= maxAncho) return s;
  const puntos = "…";
  const anchoPuntos = anchoTexto(puntos, tam, negrita);
  let out = "";
  for (const ch of s) {
    if (anchoTexto(out + ch, tam, negrita) + anchoPuntos > maxAncho) break;
    out += ch;
  }
  return out + puntos;
}

/** Un número con dos decimales y punto, que es lo que pide el PDF. */
function num(n) {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toFixed(2);
}

/** Todo el PDF como bytes: cada carácter del texto es un byte. */
function aBytes(partes) {
  let largo = 0;
  for (const p of partes) largo += p.length;
  const out = new Uint8Array(largo);
  let i = 0;
  for (const p of partes) {
    for (let k = 0; k < p.length; k += 1) out[i] = p.charCodeAt(k) & 0xff;
    i += p.length;
  }
  return out;
}

/**
 * Monta el PDF entero a partir de las hojas ya dibujadas.
 * Los objetos son siempre los mismos: catálogo (1), páginas (2), las dos
 * fuentes (3 y 4) y, por cada hoja, la hoja y su contenido.
 */
function serializar(hojas, tam, titulo) {
  const partes = [];
  let largo = 0;
  const add = (s) => {
    partes.push(s);
    largo += s.length;
  };
  const donde = [];
  const objeto = (n, cuerpo) => {
    donde[n] = largo;
    add(`${n} 0 obj\n${cuerpo}\nendobj\n`);
  };

  add("%PDF-1.4\n");
  add(`%${String.fromCharCode(0xe2, 0xe3, 0xcf, 0xd3)}\n`);

  const total = hojas.length;
  const hojasIds = [];
  let siguiente = 5;
  for (let i = 0; i < total; i += 1) {
    hojasIds.push(siguiente);
    siguiente += 2;
  }

  objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objeto(
    2,
    `<< /Type /Pages /Kids [${hojasIds.map((n) => `${n} 0 R`).join(" ")}] /Count ${total} >>`
  );
  objeto(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objeto(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  hojas.forEach((ops, i) => {
    const idHoja = hojasIds[i];
    const idContenido = idHoja + 1;
    const contenido = ops.join("\n");
    objeto(
      idHoja,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(tam.w)} ${num(tam.h)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idContenido} 0 R >>`
    );
    objeto(idContenido, `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`);
  });

  const inicioXref = largo;
  add(`xref\n0 ${siguiente}\n`);
  add("0000000000 65535 f \n");
  for (let n = 1; n < siguiente; n += 1) {
    add(`${String(donde[n] || 0).padStart(10, "0")} 00000 n \n`);
  }
  add(`trailer\n<< /Size ${siguiente} /Root 1 0 R /Info << /Title (${textoPdf(titulo)}) >> >>\n`);
  add(`startxref\n${inicioXref}\n%%EOF\n`);
  return aBytes(partes);
}

/**
 * Hace el informe. Devuelve { filename, bytes }, listo para descargar.
 *
 * spec = {
 *   filename, title, subtitle, footer, horizontal,
 *   blocks: [ {type:"heading", text}, {type:"text", text, bold},
 *             {type:"space", size}, {type:"table", columns, rows, note} ]
 * }
 * En una tabla, cada columna es { label, weight, align } y cada fila es una
 * lista de celdas o { cells, bold, shade }.
 */
export function informePdf(spec) {
  const datos = spec || {};
  const tam = datos.horizontal ? PAGINA.horizontal : PAGINA.vertical;
  const izq = MARGEN;
  const der = tam.w - MARGEN;
  const ancho = der - izq;
  const arriba = tam.h - MARGEN;
  const abajo = MARGEN + 24;

  const hojas = [];
  let ops = [];
  let y = arriba;

  const salto = () => {
    hojas.push(ops);
    ops = [];
    y = arriba;
  };
  const sitio = (alto) => {
    if (y - alto < abajo) salto();
  };
  const texto = (value, x, yy, dim, negrita) => {
    const s = textoPdf(value);
    if (!s) return;
    ops.push(
      `BT /${negrita ? "F2" : "F1"} ${dim} Tf 1 0 0 1 ${num(x)} ${num(yy)} Tm (${s}) Tj ET`
    );
  };
  const rect = (x, yy, w, h, gris) => {
    ops.push(`${gris} ${gris} ${gris} rg ${num(x)} ${num(yy)} ${num(w)} ${num(h)} re f 0 0 0 rg`);
  };
  const raya = (x1, y1, x2, y2, gris) => {
    ops.push(`${gris} ${gris} ${gris} RG 0.6 w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S 0 0 0 RG`);
  };

  // Cabecera del informe (solo en la primera hoja).
  if (datos.title) {
    texto(datos.title, izq, y - 16, 16, true);
    y -= 24;
    if (datos.subtitle) {
      texto(datos.subtitle, izq, y - 9, 9.5, false);
      y -= 15;
    }
    raya(izq, y - 3, der, y - 3, 0.55);
    y -= 12;
  }

  for (const bloque of datos.blocks || []) {
    const tipo = (bloque && bloque.type) || "text";

    if (tipo === "space") {
      y -= Number(bloque.size) || 8;
      continue;
    }

    if (tipo === "heading") {
      sitio(30);
      y -= 6;
      texto(bloque.text, izq, y - 11, 11, true);
      y -= 16;
      raya(izq, y, der, y, 0.85);
      y -= 6;
      continue;
    }

    if (tipo === "text") {
      const dim = Number(bloque.size) || 9.5;
      const lineas = String(bloque.text == null ? "" : bloque.text).split("\n");
      for (const linea of lineas) {
        sitio(dim + 6);
        texto(recorta(linea, ancho, dim, !!bloque.bold), izq, y - dim, dim, !!bloque.bold);
        y -= dim + 4;
      }
      continue;
    }

    if (tipo === "table") {
      const columnas = bloque.columns || [];
      if (!columnas.length) continue;
      const pesos = columnas.map((c) => Number(c.weight) || 1);
      const sumaPesos = pesos.reduce((n, p) => n + p, 0) || 1;
      const anchos = pesos.map((p) => (ancho * p) / sumaPesos);
      const xs = [];
      let cursor = izq;
      for (const a of anchos) {
        xs.push(cursor);
        cursor += a;
      }
      const alto = Number(bloque.rowHeight) || 14;
      const dim = Number(bloque.size) || 8.5;

      const cabecera = () => {
        rect(izq, y - 16, ancho, 16, 0.9);
        columnas.forEach((c, i) => {
          const t = recorta(c.label || "", anchos[i] - 8, dim, true);
          const x =
            c.align === "right" ? xs[i] + anchos[i] - 4 - anchoTexto(t, dim, true) : xs[i] + 4;
          texto(t, x, y - 11.5, dim, true);
        });
        y -= 16;
      };

      sitio(46);
      cabecera();

      for (const fila of bloque.rows || []) {
        const celdas = Array.isArray(fila) ? fila : fila.cells || [];
        const negrita = !Array.isArray(fila) && !!fila.bold;
        const sombra = !Array.isArray(fila) && !!fila.shade;
        if (y - alto < abajo) {
          salto();
          cabecera();
        }
        if (sombra) rect(izq, y - alto, ancho, alto, 0.955);
        columnas.forEach((c, i) => {
          const bruto = celdas[i];
          const t = recorta(bruto == null ? "" : String(bruto), anchos[i] - 8, dim, negrita);
          const x =
            c.align === "right"
              ? xs[i] + anchos[i] - 4 - anchoTexto(t, dim, negrita)
              : xs[i] + 4;
          texto(t, x, y - (alto - 4), dim, negrita);
        });
        raya(izq, y - alto, der, y - alto, 0.88);
        y -= alto;
      }

      if (bloque.note) {
        y -= 4;
        for (const linea of String(bloque.note).split("\n")) {
          sitio(dim + 6);
          texto(recorta(linea, ancho, 8, false), izq, y - 8, 8, false);
          y -= 11;
        }
      }
      y -= 6;
      continue;
    }
  }

  hojas.push(ops);

  // Pie de cada hoja: una raya, el nombre del informe y «Página X de N».
  const cuantas = hojas.length;
  hojas.forEach((hoja, i) => {
    hoja.push(`0.85 0.85 0.85 RG 0.6 w ${num(izq)} ${num(MARGEN + 12)} m ${num(der)} ${num(MARGEN + 12)} l S 0 0 0 RG`);
    texto(recorta(datos.footer || datos.title || "", ancho - 70, 7.5, false), izq, MARGEN, 7.5, false);
    const derecha = `Página ${i + 1} de ${cuantas}`;
    const x = der - anchoTexto(derecha, 7.5, false);
    texto(derecha, x, MARGEN, 7.5, false);
  });

  return {
    filename: datos.filename || "informe.pdf",
    bytes: serializar(hojas, tam, datos.title || ""),
  };
}

/** Guarda el PDF con el nombre que se le diga, como cualquier descarga. */
export function descargarPdf(nombre, bytes) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre || "informe.pdf";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 5000);
}
