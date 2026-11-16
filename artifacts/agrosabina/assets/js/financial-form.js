import { esc, fmtNum, parseAmount } from "./util.js";
import { isFinancial, normalizeFinancial, FINANCIAL_OPERATIONS } from "./financial-documents.js";

export function financialFormHtml(doc, invoices = []) {
  if (!isFinancial(doc.kind)) return "";
  const f = normalizeFinancial(doc.financial, doc.kind);
  const amount = (key, label, operations) => `<label class="field" data-fin-operations="${operations}"><span>${label} (€)</span><input data-fin="${key}" inputmode="decimal" value="${f[key] == null ? "" : esc(fmtNum(f[key]))}" placeholder="Importe impreso o 0 si no existe"></label>`;
  const text = (key, label, operations) => `<label class="field" data-fin-operations="${operations}"><span>${label}</span><input data-fin="${key}" value="${esc(f[key] || "")}"></label>`;
  return `<fieldset class="span-2" id="financial-form">
    <legend>Desglose y tratamiento contable</legend>
    <div class="form-grid">
      <label class="field span-2"><span>Operación</span><select data-fin="operation">${FINANCIAL_OPERATIONS[doc.kind].map(([key, label]) => `<option value="${key}" ${key === f.operation ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      ${["PRESTAMO", "POLIZA_CREDITO"].includes(doc.kind) ? text("reference", "Contrato / referencia de la financiación", "*") : ""}
      ${doc.kind === "PRESTAMO" ? `
        ${text("shortAccount", "Cuenta a corto plazo · 5200xx", "*")}
        ${text("longAccount", "Cuenta a largo plazo · 170xxx", "*")}
        ${amount("capitalShort", "Principal a corto plazo", "CUOTA ALTA")}
        ${amount("capitalLong", "Principal a largo plazo", "CUOTA ALTA")}
        ${amount("interest", "Intereses de la cuota · 662000", "CUOTA")}
        ${amount("fees", "Comisiones · 626000", "CUOTA")}
        ${amount("reclassAmount", "Capital a trasladar de largo a corto plazo", "RECLASIFICACION")}
        <p class="hint span-2">Usa una pareja de subcuentas distinta para cada préstamo (por ejemplo 170001 y 520001). Corto plazo: principal exigible dentro de los doce meses siguientes a la fecha de referencia. Largo plazo: resto del principal. La cuota no vuelve a dar de alta la deuda. Para préstamos antiguos, registra primero el saldo inicial en el asiento de apertura o un asiento manual, sin simular un desembolso nuevo.</p>` : ""}
      ${doc.kind === "POLIZA_CREDITO" ? `
        ${text("creditAccount", "Subcuenta de crédito dispuesto · 5201xx", "*")}
        ${amount("capitalShort", "Capital dispuesto o reembolsado", "DISPOSICION REEMBOLSO")}
         ${amount("interest", "Intereses · 662000", "LIQUIDACION")}
         ${amount("fees", "Comisiones · 626000", "LIQUIDACION")}` : ""}
      ${doc.kind === "IGIC" ? `
         ${amount("taxOutput", "IGIC repercutido a liquidar · 477000", "DECLARACION")}
         ${amount("taxInput", "IGIC soportado deducible a liquidar · 472000", "DECLARACION")}
        <p class="hint span-2">Solo liquidación simple: diferencia entre cuotas repercutidas y soportadas. Para modelos informativos, compensaciones previas, prorrata, sanciones u otros ajustes, elige «Informativo o ajustes»: conserva el original sin asiento automático (puedes indicar total 0). Registra aparte el asiento revisado manualmente. No dar de alta una segunda declaración por su justificante de pago.</p>` : ""}
      ${doc.kind === "RECIBO_BANCARIO" ? `
        <label class="field span-2" data-fin-operations="JUSTIFICANTE"><span>Documento que justifica</span><select data-fin="linkedDocumentId"><option value="">Seleccionar documento registrado…</option>${invoices.filter((inv) => inv.id !== doc.id && inv.kind !== "RECIBO_BANCARIO").map((inv) => `<option value="${esc(inv.id)}" ${inv.id === f.linkedDocumentId ? "selected" : ""}>${esc(`${inv.issueDate} · ${inv.number || inv.id} · ${fmtNum(inv.total || 0)} €`)}</option>`).join("")}</select></label>
        ${text("counterAccount", "Cuenta del gasto nuevo (grupo 6)", "GASTO")}
        <p class="hint span-2">Un justificante vinculado conserva el original sin repetir el asiento ni marcar pagado el documento automáticamente. Registra o concilia el pago desde el documento original o el extracto bancario. Si el recibo contiene IGIC deducible, usa su factura, no «gasto bancario nuevo».</p>` : ""}
    </div>
  </fieldset>`;
}

export function bindFinancialForm(root) {
  const box = root.querySelector("#financial-form");
  if (!box) return;
  const select = box.querySelector('[data-fin="operation"]');
  const show = () => {
    for (const field of box.querySelectorAll("[data-fin-operations]")) {
      const operations = field.dataset.finOperations.split(" ");
      field.hidden = !operations.includes("*") && !operations.includes(select.value);
    }
  };
  select.addEventListener("change", show);
  show();
}

export function readFinancialForm(root, kind) {
  if (!isFinancial(kind)) return null;
  const data = {};
  const numbers = ["capitalShort", "capitalLong", "interest", "fees", "reclassAmount", "taxOutput", "taxInput"];
  for (const field of root.querySelectorAll("[data-fin]")) {
    data[field.dataset.fin] = numbers.includes(field.dataset.fin) ? parseAmount(field.value) : field.value;
  }
  return normalizeFinancial(data, kind);
}
