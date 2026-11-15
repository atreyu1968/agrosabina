export const DOCUMENT_REVIEW_SPECS = Object.freeze({
  FACTURA: Object.freeze({
    title: "factura recibida",
    party: "Proveedor",
    number: "Número de factura",
    issueDate: "Fecha de factura",
    dueDate: "Vencimiento",
    total: "Total de la factura",
    description: "Revisa proveedor, fecha, desglose de IGIC e importe antes de guardar el gasto.",
  }),
  LIQUIDACION: Object.freeze({
    title: "liquidación de fruta",
    party: "Cliente o comprador",
    number: "Número de liquidación",
    issueDate: "Fecha de liquidación",
    dueDate: "Fecha prevista de cobro",
    total: "Líquido de la liquidación",
    description: "Es una venta e ingreso. Comprueba kilos, categorías, precio por kilo y descuentos.",
  }),
  SUBVENCION: Object.freeze({
    title: "subvención o ayuda",
    party: "Organismo concedente",
    number: "Referencia o expediente",
    issueDate: "Fecha de concesión",
    dueDate: "Fecha prevista de cobro",
    total: "Importe de la ayuda",
    description: "Es un ingreso. Comprueba el organismo, la referencia y el importe concedido.",
  }),
  COBRO: Object.freeze({
    title: "cobro o abono recibido",
    party: "Cliente o pagador",
    number: "Referencia del cobro",
    issueDate: "Fecha del cobro",
    dueDate: "Fecha del abono",
    total: "Importe cobrado",
    description: "Es un ingreso recibido. Comprueba quién paga, la fecha y el importe.",
  }),
  NOMINA: Object.freeze({
    title: "nómina",
    party: "Trabajador",
    number: "Referencia de la nómina",
    issueDate: "Fecha de la nómina",
    dueDate: "Fecha de pago",
    total: "Líquido a percibir",
    description: "Es un gasto laboral, no lleva IGIC. Revisa bruto, deducciones, líquido y trabajador.",
  }),
  OTRO: Object.freeze({
    title: "otro documento",
    party: "Emisor o tercero",
    number: "Número del documento",
    issueDate: "Fecha del documento",
    dueDate: "Vencimiento",
    total: "Importe total",
    description: "Tipo genérico: revisa el emisor, el concepto y el sentido antes de guardarlo.",
  }),
});

export function documentReviewSpec(kind) {
  const key = String(kind || "OTRO").toUpperCase();
  return DOCUMENT_REVIEW_SPECS[key] || DOCUMENT_REVIEW_SPECS.OTRO;
}
