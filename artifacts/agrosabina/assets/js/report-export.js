import { informePdf } from "./pdf.js";
import { parseAmount, fmtNum } from "./util.js";

const numericHeader = /^(?:base(?: imponible| repercutida| soportada)?|tipo igic \(%\)|cuota igic|igic(?: repercutido| soportado)?|total|importe|resultado|debe|haber|saldo|suma debe|suma haber|saldo deudor|saldo acreedor|días de retraso)$/i;
export function reportMatrix(report) {
  if (!report.headers?.length) throw new Error("El informe no tiene columnas.");
  return (report.rows || []).map((row) => report.headers.map((header, index) => {
    const value = row[index];
    if (value == null || value === "") return "";
    if (numericHeader.test(header)) {
      const number = typeof value === "number" ? value : parseAmount(String(value));
      return Number.isFinite(number) ? number : String(value);
    }
    // Identifiers (NIF, accounts and document references) must remain text.
    return String(value);
  }));
}

export function reportPdf(report) {
  const rows = reportMatrix(report);
  if (!rows.length) throw new Error("No hay datos que exportar con estos filtros.");
  // Wide document indexes are split into related column groups, never silently omitted.
  const groups = [];
  const maxColumns = 7;
  if (report.headers.length <= maxColumns) groups.push(report.headers.map((_, i) => i));
  else {
    const anchors = report.headers.map((header, i) => /^(fecha|número|nº factura|referencia)$/i.test(header) ? i : -1).filter((i) => i >= 0).slice(0, 2);
    if (!anchors.length) anchors.push(0);
    const rest = report.headers.map((_, i) => i).filter((i) => !anchors.includes(i));
    for (let i = 0; i < rest.length; i += maxColumns - anchors.length) groups.push([...anchors, ...rest.slice(i, i + maxColumns - anchors.length)]);
  }
  const blocks = [
    { type: "text", text: `Periodo: ${report.period || "Todos los registros filtrados"}` },
    { type: "text", text: `Emitido: ${new Date().toLocaleString("es-ES", { timeZone: "Atlantic/Canary" })} · Horario de Canarias` },
    { type: "text", text: `Filas: ${rows.length}. ${report.filters || ""}` },
    { type: "text", text: "Informe de gestión generado con los datos registrados. No sustituye declaraciones ni justificantes oficiales.", size: 8 },
  ];
  for (const [groupIndex, indices] of groups.entries()) {
    if (groups.length > 1) blocks.push({ type: "heading", text: `Detalle ${groupIndex + 1} de ${groups.length} · mismas filas y orden` });
    blocks.push({
      type: "table", size: 8, rowHeight: 15, wrap: true,
      columns: indices.map((i) => ({
        label: report.headers[i],
        weight: /concepto|nombre|proveedor|tercero|epígrafe|archivo|aviso/i.test(report.headers[i]) ? 3 : 1.4,
        align: numericHeader.test(report.headers[i]) ? "right" : "left",
      })),
      rows: rows.map((row) => indices.map((i) => typeof row[i] === "number" ? fmtNum(row[i]) : row[i])),
    });
  }
  return informePdf({
    filename: `${report.filename}.pdf`, title: `Agrosabina SL · ${report.title}`,
    footer: `${report.title} · ${report.period || "Registros filtrados"}`,
    horizontal: report.headers.length > 4, blocks,
  });
}

export async function reportXls(report) {
  const rows = reportMatrix(report);
  if (!rows.length) throw new Error("No hay datos que exportar con estos filtros.");
  // Real BIFF8/OLE XLS, not CSV or HTML renamed as an Excel file.
  if (rows.length > 65535 || report.headers.length > 256) throw new Error("XLS admite hasta 65.535 filas de datos y 256 columnas. Reduce el intervalo del informe.");
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  book.Props = { Title: report.title, Author: "Agrosabina SL", CreatedDate: new Date() };
  const sheet = XLSX.utils.aoa_to_sheet([report.headers, ...rows]);
  sheet["!cols"] = report.headers.map((header, i) => ({ wch: Math.min(60, Math.max(header.length + 2, ...rows.slice(0, 100).map((row) => String(row[i] ?? "").length + 1))) }));
  sheet["!autofilter"] = { ref: sheet["!ref"] };
  for (const key of Object.keys(sheet)) {
    if (!key.startsWith("!") && sheet[key].t === "n") sheet[key].z = "#,##0.00;[Red]-#,##0.00";
  }
  XLSX.utils.book_append_sheet(book, sheet, "Informe");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Informe", report.title], ["Empresa", "Agrosabina SL"], ["Periodo", report.period || "Registros filtrados"],
    ["Filtros", report.filters || ""], ["Filas", rows.length],
    ["Emitido (Canarias)", new Date().toLocaleString("es-ES", { timeZone: "Atlantic/Canary" })],
    ["Nota", "Informe de gestión. No sustituye declaraciones ni justificantes oficiales."],
  ]), "Información");
  return { filename: `${report.filename}.xls`, bytes: XLSX.write(book, { type: "array", bookType: "biff8" }) };
}
