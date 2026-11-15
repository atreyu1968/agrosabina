import { parseAmount, round2 } from "./util.js";

const money = (line) => (String(line).match(/-?\d[\d.]*,\d{2}(?!\d)|-?\d+\.\d{2}(?!\d)/g) || [])
  .map(parseAmount).filter((v) => v != null);

/** Nóminas con rótulos y cifras en filas distintas, sin depender de posiciones OCR. */
export function leerTablaNomina(text) {
  const raw = String(text || "").split(/\r?\n/).filter((line) => line.trim());
  const lines = raw.map((line) => line.replace(/\s+/g, " ").trim());
  const out = { notas: [] };
  const workerIndex = lines.findIndex((line) => /^TRABAJADOR(?:\/A)?\s+.*CATEGOR[IÍ]A/i.test(line));
  if (workerIndex >= 0 && lines[workerIndex + 1]) {
    const row = lines[workerIndex + 1];
    const repeated = lines.slice(0, workerIndex).filter((candidate) =>
      candidate.length >= 5 && /^[A-ZÁÉÍÓÚÑÜ ]+$/.test(candidate) &&
      row.startsWith(candidate + " "));
    const firstColumn = raw[workerIndex + 1].trim().split(/\s{2,}/)[0];
    out.trabajador = repeated.sort((a, b) => b.length - a.length)[0] ||
      (firstColumn !== row ? firstColumn : "");
  }
  const period = String(text).match(/\b(\d{1,2})\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)\s+(\d{2,4})\s+a\s+(\d{1,2})\s+\2\s+\3\s+(\d{1,2})\b/i);
  if (period) {
    const month = String(["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"].indexOf(period[2].toUpperCase()) + 1).padStart(2, "0");
    const year = period[3].length === 2 ? `20${period[3]}` : period[3];
    const from = `${year}-${month}-${period[1].padStart(2, "0")}`;
    const to = `${year}-${month}-${period[4].padStart(2, "0")}`;
    out.periodo = `${from} a ${to}`;
    out.issueDate = to;
    out.dias = Number(period[5]);
  }
  const netIndex = lines.findIndex((line) => /L[IÍ]QUIDO A PERCIBIR/i.test(line));
  if (netIndex >= 0) {
    const values = money(lines[netIndex]);
    out.neto = values.at(-1) ?? money(lines[netIndex + 1]).at(-1) ?? null;
  }
  const summary = lines.findIndex((line) => /T\.\s*DEVENGADO/i.test(line) && /T\.\s*A DEDUCIR/i.test(line));
  if (summary >= 0) {
    const values = money(lines[summary + 1]);
    const last = values.at(-1);
    const previous = values.at(-2);
    if (out.neto != null && last != null) {
      if (previous != null && Math.abs(round2(previous - last - out.neto)) < 0.021) {
        out.bruto = previous;
        out.totalDeducciones = last;
      } else if (Math.abs(last - out.neto) < 0.021) {
        out.bruto = last;
        out.totalDeducciones = 0;
      } else {
        out.notas.push("No se ha podido conciliar la fila de totales con el líquido de la nómina.");
      }
    }
  }
  const end = summary >= 0 ? summary : netIndex >= 0 ? netIndex : lines.length;
  const workerContributions = lines.slice(0, end).filter((line) => /COTIZACI[OÓ]N/i.test(line))
    .map((line) => money(line).at(-1)).filter((v) => v != null);
  if (workerContributions.length) out.ssTrabajador = round2(workerContributions.reduce((a, b) => a + b, 0));
  const irpf = lines.slice(0, end).find((line) => /TRIBUTACI[OÓ]N.*I\.?R\.?P\.?F\.?/i.test(line));
  if (irpf) out.irpf = money(irpf).at(-1) ?? null;
  if (out.totalDeducciones === 0) {
    out.ssTrabajador ??= 0;
    out.irpf ??= 0;
  }
  const costLine = lines.find((line) => /COSTE EMPRESA\s*:/i.test(line));
  const cost = costLine ? money(costLine).at(-1) : null;
  const employerStart = lines.findIndex((line) => /BASE\s+TIPO\s+APORTACI[OÓ]N EMPRESARIAL/i.test(line));
  if (employerStart >= 0) {
    const contributions = lines.slice(employerStart + 1)
      // El rótulo puede estar en otra línea por su tamaño o por el OCR:
      // dentro de esta tabla mandan las tres columnas base, tipo e importe.
      .map(money).filter((values) => values.length >= 3).map((values) => values.at(-1));
    if (contributions.length) out.ssEmpresa = round2(contributions.reduce((a, b) => a + b, 0));
  }
  if (out.ssEmpresa == null && cost != null && out.bruto != null && cost >= out.bruto) {
    out.ssEmpresa = round2(cost - out.bruto);
    out.notas.push("La Seguridad Social de empresa se ha obtenido del coste impreso menos el bruto; revísala.");
  }
  if (cost != null && out.bruto != null && out.ssEmpresa != null &&
      Math.abs(round2(out.bruto + out.ssEmpresa - cost)) > 0.021) {
    out.notas.push(`El coste empresa impreso (${cost.toFixed(2)} €) no coincide con bruto más aportaciones empresariales (${round2(out.bruto + out.ssEmpresa).toFixed(2)} €). Revisa posibles bonificaciones; no se han inventado ni aplicado descuentos.`);
  }
  return out;
}
