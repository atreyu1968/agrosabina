---
name: Conciliación bancaria segura
description: Reglas de seguridad e integridad para conciliar extractos con documentos y contabilizar movimientos sueltos.
---

Conciliar automáticamente solo documentos pendientes con importe exacto al céntimo y mismo sentido del movimiento. Mostrar las propuestas y pedir confirmación antes de cambiar el documento a pagado o cobrado. Si varios documentos son posibles, exigir selección explícita. Para movimientos sin documento, pedir una cuenta de contrapartida antes de crear el asiento.

No crear un segundo asiento bancario al conciliar un documento: su asiento de pago ya debe reflejar la cuenta 572. Si el extracto no identifica si el medio fue tarjeta o transferencia, conservarlo como no identificado hasta que una persona lo indique.

**Why:** una conciliación errónea puede alterar pagos, cobros y saldos contables; los documentos y el extracto son registros financieros, no una estimación.

**How to apply:** mantener las validaciones de importe, sentido y unicidad al modificar la conciliación; las transacciones sin documento deben quedar fuera del diario hasta que se elija su cuenta de contrapartida.
