import test from "node:test";
import assert from "node:assert/strict";
import { asientosDe } from "../assets/js/accounting.js";

const invoice = {
  id: "sin-fecha",
  number: "F-001",
  kind: "FACTURA",
  issueDate: "2026-10-01",
  status: "PAGADO",
  paidDate: "",
  base: 100,
  igic: 7,
  total: 107,
};

test("no asigna al pago sin fecha el día de emisión de la factura", () => {
  const entries = asientosDe([invoice], {
    from: "2026-10-01",
    to: "2026-10-31",
  });

  assert.equal(entries.some((entry) => entry.kind === "pago"), false);
  assert.equal(entries.find((entry) => entry.kind === "devengo").date, "2026-10-01");
});

test("registra el pago cuando existe una fecha de pago indicada", () => {
  const entries = asientosDe([{ ...invoice, paidDate: "2026-10-12" }], {
    from: "2026-10-01",
    to: "2026-10-31",
  });

  assert.equal(entries.find((entry) => entry.kind === "pago").date, "2026-10-12");
});
