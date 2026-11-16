import test from "node:test";
import assert from "node:assert/strict";
import { invoiceExerciseYear, isIssuedInExercise, isPendingCarryover, isVisibleInExercise } from "../assets/js/model.js";

test("el ejercicio muestra sus documentos y conserva pendientes anteriores, no históricos pagados", () => {
  const year = 2026;
  const currentPaid = { issueDate: "2026-03-12", status: "PAGADO" };
  const previousOpen = { issueDate: "2025-12-20", status: "PENDIENTE" };
  const previousPaid = { issueDate: "2025-06-01", status: "PAGADO" };
  const futureOpen = { issueDate: "2027-01-02", status: "PENDIENTE" };
  const undated = { status: "PENDIENTE" };

  assert.equal(invoiceExerciseYear(currentPaid), 2026);
  assert.equal(isIssuedInExercise(currentPaid, year), true);
  assert.equal(isPendingCarryover(previousOpen, year), true);
  assert.equal(isVisibleInExercise(previousOpen, year), true);
  assert.equal(isVisibleInExercise(previousPaid, year), false);
  assert.equal(isVisibleInExercise(futureOpen, year), false);
  assert.equal(isVisibleInExercise(undated, year), true);
});
