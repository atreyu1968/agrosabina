/*
 * Validar la copia completa antes de sustituir los datos del navegador.
 * Compatible con las copias antiguas sin mensajes ni versión explícita.
 */
export function validateBackup(data) {
  const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const fail = (detail) => {
    throw new Error(`Copia no válida: ${detail}. No se han sustituido los datos.`);
  };
  if (!object(data) || !Array.isArray(data.suppliers) || !Array.isArray(data.invoices)) {
    fail("debe contener las listas completas de proveedores y documentos");
  }
  if (data.version !== undefined && data.version !== 1) fail("versión no compatible");
  if (data.settings !== undefined && !object(data.settings)) fail("ajustes incorrectos");
  if (data.messages !== undefined && !Array.isArray(data.messages)) fail("lista de correos incorrecta");

  const idsOf = (rows, label) => {
    const ids = new Set();
    for (const row of rows) {
      if (!object(row) || typeof row.id !== "string" || !row.id.trim()) {
        fail(`${label} sin identificador válido`);
      }
      if (ids.has(row.id)) fail(`identificadores repetidos en ${label}`);
      ids.add(row.id);
    }
    return ids;
  };
  const suppliers = idsOf(data.suppliers, "proveedores");
  idsOf(data.invoices, "documentos");
  idsOf(data.messages || [], "correos");
  for (const s of data.suppliers) {
    if (!(typeof s.name === "string" && s.name.trim()) &&
        !(typeof s.nif === "string" && s.nif.trim())) fail("proveedor sin nombre ni NIF");
  }
  const amount = (v) => v === undefined || v === null || v === "" ||
    ((typeof v === "number" || typeof v === "string") && Number.isFinite(Number(v)));
  for (const inv of data.invoices) {
    if (inv.supplierId != null && inv.supplierId !== "" && !suppliers.has(inv.supplierId)) {
      fail("un documento hace referencia a un proveedor inexistente");
    }
    for (const key of ["base", "rate", "igic", "total"]) {
      if (!amount(inv[key])) fail(`importe incorrecto en ${key}`);
    }
    if (inv.lines !== undefined && (!Array.isArray(inv.lines) ||
        inv.lines.some((line) => !object(line) || !amount(line.base) || !amount(line.rate)))) {
      fail("desglose de IGIC incorrecto");
    }
    for (const key of ["nomina", "liquidacion", "original", "financial"]) {
      if (inv[key] != null && !object(inv[key])) fail(`datos incorrectos en ${key}`);
    }
  }
  for (const m of data.messages || []) {
    if (!(typeof m.subject === "string" && m.subject.trim()) &&
        !(typeof m.text === "string" && m.text.trim())) fail("correo sin contenido");
  }
}
