import { fold, normaliseSpanishNif } from "./util.js";

const FIELDS = {
  name: ["nombre", "empresa", "razon social", "cliente", "proveedor", "name", "company"],
  nif: ["nif", "cif", "nie", "nif cif", "nif/cif", "vat", "tax id"],
  role: ["tipo", "rol", "tipo de tercero", "categoria"],
  contactName: ["persona de contacto", "nombre de contacto", "contacto", "contact person"],
  email: ["correo", "correo electronico", "email", "e mail", "e-mail"],
  phone: ["telefono", "movil", "telefono movil", "phone", "mobile"],
  address: ["direccion", "domicilio", "calle", "address"],
  city: ["poblacion", "localidad", "ciudad", "city"],
  postalCode: ["codigo postal", "cp", "postal code", "zip"],
  country: ["pais", "country"],
  website: ["web", "pagina web", "sitio web", "website"],
  paymentMethod: ["forma de pago", "metodo de pago", "payment method"],
  paymentTermDays: ["plazo de pago", "plazo de pago dias", "dias de pago", "dias", "payment terms", "payment days"],
  note: ["nota", "notas", "observaciones", "comments", "notes"],
};

function normalizedHeader(value) {
  return fold(String(value || "").replace(/[_-]+/g, " "));
}

function valueFor(row, aliases) {
  const wanted = new Set(aliases.map(normalizedHeader));
  const entry = Object.entries(row || {}).find(([key]) => wanted.has(normalizedHeader(key)));
  return entry ? String(entry[1] ?? "").trim() : "";
}

function roleValue(value) {
  const role = fold(value);
  if (!role) return "";
  if (["cliente", "client", "comprador"].includes(role)) return "CLIENTE";
  if (["ambos", "cliente y proveedor", "proveedor y cliente", "both"].includes(role)) return "AMBOS";
  if (["proveedor", "supplier", "vendedor"].includes(role)) return "PROVEEDOR";
  return null;
}

export function crmPaymentMethod(value) {
  const method = fold(value);
  if (!method) return "";
  if (["efectivo", "caja", "metalico", "cash"].includes(method)) return "CAJA";
  if (["transferencia", "transferencia bancaria", "bank transfer"].includes(method)) return "TRANSFERENCIA";
  if (["domiciliacion", "domiciliacion bancaria", "direct debit"].includes(method)) return "DOMICILIACION";
  if (["banco", "bank"].includes(method)) return "BANCO";
  if (["tarjeta", "card", "tpv"].includes(method)) return "TARJETA";
  if (["cheque", "cheque bancario", "check"].includes(method)) return "CHEQUE";
  if (["otro", "otros", "other"].includes(method)) return "OTRO";
  return null;
}

function parseDays(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d+)(?:[.,]0+)?\s*(?:dias?|days?)?$/i);
  if (!match) return Number.NaN;
  const days = Number(match[1]);
  return Number.isInteger(days) && days >= 0 && days <= 3650 ? days : Number.NaN;
}

export function normalizeCrmRows(rows) {
  const records = [];
  const errors = [];

  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const record = Object.fromEntries(
      Object.entries(FIELDS).map(([field, aliases]) => [field, valueFor(row, aliases)]),
    );
    if (Object.values(record).every((value) => !value)) continue;

    const issues = [];
    const limits = {
      name: 240, nif: 24, contactName: 160, email: 320, phone: 60,
      address: 240, city: 120, postalCode: 24, country: 80, website: 200, note: 1000,
    };
    for (const [field, limit] of Object.entries(limits)) {
      record[field] = record[field].replace(/\s+/g, " ").trim().slice(0, limit);
    }
    const rawNif = record.nif;
    record.nif = rawNif ? normaliseSpanishNif(rawNif) : "";
    if (!record.name && !record.nif) issues.push("Falta el nombre y el NIF.");
    else if (!record.name) issues.push("Falta el nombre.");
    if (rawNif && !record.nif) issues.push("El NIF/NIE/CIF no es válido.");

    const role = roleValue(record.role);
    if (role === null) issues.push(`Tipo de tercero no reconocido: ${record.role}.`);
    else record.role = role;

    const method = crmPaymentMethod(record.paymentMethod);
    if (method === null) issues.push(`Forma de pago no reconocida: ${record.paymentMethod}.`);
    else record.paymentMethod = method;

    const days = parseDays(record.paymentTermDays);
    if (Number.isNaN(days)) issues.push("El plazo debe ser un número de días entre 0 y 3650.");
    else record.paymentTermDays = days;

    if (issues.length) errors.push({ row: index + 2, name: record.name || record.nif || `Fila ${index + 2}`, issues });
    else records.push({ ...record, sourceRow: index + 2 });
  }
  return { records, errors };
}

export function crmPaymentMethodLabel(value) {
  return ({
    CAJA: "Efectivo",
    BANCO: "Pago bancario",
    TRANSFERENCIA: "Transferencia",
    DOMICILIACION: "Domiciliación bancaria",
    TARJETA: "Tarjeta",
    CHEQUE: "Cheque",
    OTRO: "Otro",
  })[value] || "Sin especificar";
}
