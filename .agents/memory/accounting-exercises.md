---
name: Ejercicios contables naturales
description: Alcance anual y criterio de asignación de documentos y pagos por ejercicio.
---

La aplicación usa ejercicios de año natural (1 de enero a 31 de diciembre). La fecha de emisión asigna una factura al ejercicio; no se debe aceptar una factura nueva fuera del ejercicio activo. Una fecha de vencimiento o un pago sí pueden caer en otro año: el gasto o ingreso se registra por emisión y el movimiento de tesorería por la fecha real.

Al consultar cualquier sección con un ejercicio activo, deben seguir visibles las facturas pendientes emitidas en ejercicios anteriores. Sus saldos permanecen en cobros o pagos pendientes, sin duplicar ingresos o gastos del ejercicio activo. Se permite registrar su cobro o pago en el ejercicio activo aunque el ejercicio de emisión esté cerrado, pero solo actualizando estado, fecha y medio/cuenta de pago; no se pueden cambiar la fecha de emisión ni los importes originales.

**Why:** el usuario eligió años naturales, pidió un selector común con facturas anteriores pendientes visibles sin duplicar resultados y autorizó liquidarlas desde el ejercicio activo.

**How to apply:** mantener la validación de emisión al crear o cambiar documentos; permitir que los pagos y conciliaciones usen su fecha efectiva en el ejercicio activo; en una factura de ejercicio cerrado, permitir solo el cambio de pago descrito; conservar documentos históricos al cambiar de ejercicio y distinguir su arrastre de los resultados del ejercicio activo.
