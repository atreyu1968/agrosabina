---
name: Ejercicios contables naturales
description: Alcance anual y criterio de asignación de documentos y pagos por ejercicio.
---

La aplicación usa ejercicios de año natural (1 de enero a 31 de diciembre). La fecha de emisión asigna una factura al ejercicio; no se debe aceptar una factura nueva fuera del ejercicio activo. Una fecha de vencimiento o un pago sí pueden caer en otro año: el gasto o ingreso se registra por emisión y el movimiento de tesorería por la fecha real.

**Why:** el usuario eligió años naturales y necesita evitar que se mezclen documentos de ejercicios distintos sin perder pagos realizados en un ejercicio posterior.

**How to apply:** mantener la validación de emisión al crear o cambiar documentos; permitir que los pagos y conciliaciones usen su fecha efectiva y conservar documentos históricos al cambiar de ejercicio.
