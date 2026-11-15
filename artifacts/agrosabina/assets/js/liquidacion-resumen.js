import { parseAmount, round2 } from "./util.js";

const NUM = String.raw`-?\d[\d.,]*`;
const priceOf = (s) => {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Resúmenes finales con categorías y subtotales semanales.
 * No sumar las semanas otra vez cuando el documento ya trae el acumulado.
 */
export function leerResumenLiquidacion(text) {
  const lines = String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const totalIndex = lines.findLastIndex((s) => /^TOTAL\s+LIQUIDACI[OÓ]N\b/i.test(s));
  if (totalIndex < 0) return null;
  const match = lines[totalIndex].match(new RegExp(
    `^TOTAL\\s+LIQUIDACI[OÓ]N\\s+(${NUM})\\s+${NUM}\\s*%\\s+(${NUM})\\s+(${NUM})\\s*$`, "i"
  ));
  if (!match) return null;
  const kg = parseAmount(match[1]);
  const price = priceOf(match[2]);
  const gross = parseAmount(match[3]);
  if (!(kg > 0) || price == null || price < 0 || gross == null) return null;

  const notes = [];
  let start = 0;
  for (let i = 0; i < totalIndex; i++) {
    if (/^TOTAL\s+SEMANA\b/i.test(lines[i]) ||
        /\bCONCEPTO\b.*\bKILOS\b.*\bPRECIO\b.*\bIMPORTE\b/i.test(lines[i])) start = i + 1;
  }
  const partidas = [];
  const rowPattern = new RegExp(`^(.+?)\\s+(${NUM})\\s+${NUM}\\s*%\\s+(${NUM})\\s+(${NUM})\\s*$`);
  for (const line of lines.slice(start, totalIndex)) {
    const row = line.match(rowPattern);
    if (!row) continue;
    const rowKg = parseAmount(row[2]);
    const rowPrice = priceOf(row[3]);
    const rowGross = parseAmount(row[4]);
    if (rowKg == null || rowPrice == null || rowGross == null) continue;
    partidas.push({ categoria: row[1].trim(), kg: rowKg, price: rowPrice, gross: rowGross });
  }
  if (partidas.length) {
    const kgSum = round2(partidas.reduce((s, p) => s + p.kg, 0));
    const grossSum = round2(partidas.reduce((s, p) => s + p.gross, 0));
    if (Math.abs(kgSum - kg) > 0.021 || Math.abs(grossSum - gross) > 0.021) {
      notes.push("Las categorías del resumen no coinciden con su total impreso. Se conservan los totales del documento; revisa el desglose.");
    }
  } else {
    notes.push("No se han reconocido las categorías del resumen; revisa el desglose.");
  }
  notes.push("Se ha leído el TOTAL Liquidación y su resumen por categorías, sin volver a sumar los subtotales semanales. Los precios medios impresos pueden estar redondeados.");

  const footer = lines.slice(totalIndex + 1).join("\n");
  const tax = footer.match(new RegExp(`IGIC\\s+(${NUM})\\s*%\\s+(${NUM})\\s+(${NUM})`, "i"));
  const base = footer.match(new RegExp(`IMPORTE\\s+BASE\\s*:\\s*(${NUM})`, "i"));
  const finalTotal = footer.match(new RegExp(`(?:^|\\n)TOTAL\\s*:\\s*(${NUM})`, "i"));
  const net = base ? parseAmount(base[1]) : tax ? parseAmount(tax[2]) : gross;
  const rate = tax ? priceOf(tax[1]) : null;
  const igic = tax ? parseAmount(tax[3]) : null;
  if (finalTotal && net != null && igic != null &&
      Math.abs(round2(net + igic) - parseAmount(finalTotal[1])) > 0.021) {
    notes.push("El total final no coincide con la base más el IGIC. Revisa la liquidación.");
  }

  // La cabecera contiene columnas distintas para Nº Liquidación, Factura y S/Factura.
  let number = "";
  const header = lines.findIndex((s) => /N[º°o]\s*LIQUIDACI[OÓ]N/i.test(s));
  if (header >= 0) {
    const data = lines[header + 1]?.match(/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s+(\S+)/);
    if (data) number = data[1];
  }
  const company = lines.slice(0, header >= 0 ? header : totalIndex)
    .map((s) => s.match(/^(.+?\bS\.?\s*[AL]\.?)(?:\s|$)/i))
    .find(Boolean);
  return {
    kg, price, gross, net, rate, igic, partidas, category: "",
    number, supplierName: company ? company[1].trim() : "", notes, ok: net != null,
  };
}
