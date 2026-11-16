/*
 * Las cuentas del Plan General de Contabilidad (adaptación para PYMES).
 *
 * El código que usa la aplicación siempre tiene seis dígitos. Las cuentas
 * oficiales de tres dígitos se muestran con tres ceros finales: 430000,
 * 400000, 572000. Las subcuentas conservan el prefijo y sus tres cifras propias:
 * 430001, 430002, 400001, 572001…
 *
 * La lista es una selección de las cuentas que usa una empresa agraria
 * canaria. Si hace falta otra, se puede dar de alta a mano en la pestaña
 * «Cuentas» de Contabilidad: no hace falta tocar el programa.
 */

/** El primer dígito de la cuenta, que es el grupo del plan. */
export const PGC_GRUPOS = Object.freeze({
  "1": "1 · Financiación básica",
  "2": "2 · Activo no corriente",
  "3": "3 · Existencias",
  "4": "4 · Acreedores y deudores por operaciones comerciales",
  "5": "5 · Cuentas financieras",
  "6": "6 · Compras y gastos",
  "7": "7 · Ventas e ingresos",
});

const LISTA = [
  ["100", "Capital social"],
  ["101", "Fondo social"],
  ["102", "Capital"],
  ["103", "Socios por desembolsos no exigidos"],
  ["104", "Socios por aportaciones no dinerarias pendientes"],
  ["108", "Acciones o participaciones propias en situaciones especiales"],
  ["110", "Prima de emisión de acciones"],
  ["112", "Reserva legal"],
  ["113", "Reservas voluntarias"],
  ["114", "Reservas especiales"],
  ["115", "Reservas por pérdidas y ganancias actuando por cobertura de flujos de efectivo"],
  ["118", "Aportaciones de socios o propietarios"],
  ["120", "Remanente"],
  ["121", "Resultados negativos de ejercicios anteriores"],
  ["129", "Resultado del ejercicio"],
  ["130", "Subvenciones oficiales de capital"],
  ["131", "Donaciones y legados de capital"],
  ["132", "Otras subvenciones, donaciones y legados"],
  ["140", "Provisión por retribuciones a largo plazo al personal"],
  ["141", "Provisión para impuestos"],
  ["142", "Provisión para otras responsabilidades"],
  ["143", "Provisión por desmantelamiento, retiro o rehabilitación del inmovilizado"],
  ["150", "Acciones o participaciones emitidas"],
  ["153", "Desembolsos no exigidos"],
  ["160", "Deudas a largo plazo con partes vinculadas"],
  ["170", "Deudas a largo plazo con entidades de crédito"],
  ["170000", "Préstamos bancarios a largo plazo"],
  ["171", "Deudas a largo plazo"],
  ["172", "Deudas a largo plazo transformables en subvenciones"],
  ["173", "Proveedores de inmovilizado a largo plazo"],
  ["174", "Acreedores por arrendamiento financiero a largo plazo"],
  ["175", "Efectos a pagar a largo plazo"],
  ["180", "Fianzas recibidas a largo plazo"],
  ["185", "Depósitos recibidos a largo plazo"],

  ["200", "Investigación"],
  ["201", "Desarrollo"],
  ["202", "Concesiones administrativas"],
  ["203", "Propiedad industrial"],
  ["204", "Fondo de comercio"],
  ["205", "Derechos de traspaso"],
  ["206", "Aplicaciones informáticas"],
  ["209", "Anticipos para inmovilizaciones intangibles"],
  ["210", "Terrenos y bienes naturales"],
  ["211", "Construcciones"],
  ["212", "Instalaciones técnicas"],
  ["213", "Maquinaria"],
  ["214", "Utillaje"],
  ["215", "Otras instalaciones"],
  ["216", "Mobiliario"],
  ["217", "Equipos para procesos de información"],
  ["218", "Elementos de transporte"],
  ["219", "Otro inmovilizado material"],
  ["220", "Inversiones en terrenos y bienes naturales"],
  ["221", "Inversiones en construcciones"],
  ["231", "Construcciones en curso"],
  ["232", "Instalaciones técnicas en montaje"],
  ["233", "Maquinaria en montaje"],
  ["239", "Anticipos para inmovilizaciones materiales"],
  ["250", "Inversiones financieras a largo plazo en instrumentos de patrimonio"],
  ["251", "Valores representativos de deuda a largo plazo"],
  ["252", "Créditos a largo plazo"],
  ["253", "Créditos a largo plazo por enajenación de inmovilizado"],
  ["254", "Créditos a largo plazo al personal"],
  ["258", "Imposiciones a largo plazo"],
  ["259", "Desembolsos pendientes sobre participaciones en el patrimonio neto a largo plazo"],
  ["260", "Fianzas constituidas a largo plazo"],
  ["265", "Depósitos constituidos a largo plazo"],
  ["270", "Gastos de formalización de deudas"],
  ["280", "Amortización acumulada del inmovilizado intangible"],
  ["281", "Amortización acumulada del inmovilizado material"],
  ["282", "Amortización acumulada de las inversiones inmobiliarias"],
  ["290", "Deterioro de valor del inmovilizado intangible"],
  ["291", "Deterioro de valor del inmovilizado material"],
  ["292", "Deterioro de valor de las inversiones inmobiliarias"],
  ["293", "Deterioro de valor de participaciones a largo plazo"],
  ["294", "Deterioro de valor de valores representativos de deuda a largo plazo"],
  ["295", "Deterioro de valor de créditos a largo plazo"],

  ["300", "Mercaderías A"],
  ["301", "Mercaderías B"],
  ["310", "Materias primas A"],
  ["311", "Materias primas B"],
  ["321", "Combustibles"],
  ["322", "Repuestos"],
  ["325", "Materiales diversos"],
  ["326", "Embalajes"],
  ["327", "Envases"],
  ["328", "Material de oficina"],
  ["330", "Productos en curso A"],
  ["340", "Productos semiterminados"],
  ["350", "Productos terminados"],
  ["360", "Subproductos"],
  ["390", "Deterioro de valor de las mercaderías"],
  ["391", "Deterioro de valor de las materias primas"],
  ["395", "Deterioro de valor de los productos terminados"],

  ["400", "Proveedores"],
  ["401", "Proveedores, efectos comerciales a pagar"],
  ["406", "Envases y embalajes a devolver a proveedores"],
  ["407", "Anticipos a proveedores"],
  ["410", "Acreedores por prestaciones de servicios"],
  ["411", "Acreedores, efectos comerciales a pagar"],
  ["419", "Acreedores por operaciones en común"],
  ["430", "Clientes"],
  ["431", "Clientes, efectos comerciales a cobrar"],
  ["435", "Clientes de dudoso cobro"],
  ["437", "Anticipos de clientes"],
  ["440", "Deudores varios"],
  ["441", "Deudores, efectos comerciales a cobrar"],
  ["460", "Anticipos de remuneraciones"],
  ["465", "Remuneraciones pendientes de pago"],
  ["470", "Hacienda Pública, deudora por diversos conceptos"],
  ["470000", "Hacienda Pública, deudora por IGIC"],
  ["471", "Organismos de la Seguridad Social, deudores"],
  ["472", "Hacienda Pública, IGIC soportado"],
  ["473", "Hacienda Pública, retenciones y pagos a cuenta"],
  ["475", "Hacienda Pública, acreedora por conceptos fiscales"],
  ["475000", "Hacienda Pública, acreedora por IGIC"],
  ["475100", "Hacienda Pública, acreedora por retenciones practicadas"],
  ["476", "Organismos de la Seguridad Social, acreedores"],
  ["477", "Hacienda Pública, IGIC repercutido"],
  ["480", "Gastos anticipados"],
  ["485", "Ingresos anticipados"],
  ["490", "Deterioro de valor de créditos por operaciones comerciales"],
  ["493", "Deterioro de valor de créditos por operaciones comerciales con partes vinculadas"],
  ["499", "Provisiones por operaciones comerciales"],

  ["500", "Obligaciones y bonos"],
  ["520", "Deudas a corto plazo por préstamos recibidos y otros conceptos"],
  ["520000", "Préstamos bancarios a corto plazo"],
  ["520100", "Deudas por crédito dispuesto en pólizas"],
  ["523", "Proveedores de inmovilizado a corto plazo"],
  ["525", "Efectos a pagar a corto plazo"],
  ["526", "Acreedores por arrendamiento financiero a corto plazo"],
  ["527", "Intereses a corto plazo de deudas con entidades de crédito"],
  ["551", "Cuenta corriente con socios y administradores"],
  ["552", "Cuenta corriente con otras partes vinculadas"],
  ["555", "Partidas pendientes de aplicación"],
  ["560", "Fianzas recibidas a corto plazo"],
  ["561", "Depósitos recibidos a corto plazo"],
  ["565", "Fianzas constituidas a corto plazo"],
  ["566", "Depósitos constituidos a corto plazo"],
  ["567", "Intereses pagados por anticipado"],
  ["568", "Intereses cobrados por anticipado"],
  ["570", "Caja"],
  ["572", "Bancos e instituciones de crédito c/c vista, euros"],
  ["574", "Bancos e instituciones de crédito, cuentas de ahorro, euros"],
  ["575", "Caja, moneda extranjera"],

  ["600", "Compras de mercaderías"],
  ["601", "Compras de materias primas"],
  ["602", "Compras de otros aprovisionamientos"],
  ["606", "Descuentos sobre compras por pronto pago"],
  ["607", "Trabajos realizados por otras empresas"],
  ["608", "Devoluciones de compras y operaciones similares"],
  ["609", "Rappels por compras"],
  ["610", "Variación de existencias de mercaderías"],
  ["611", "Variación de existencias de materias primas"],
  ["612", "Variación de existencias de otros aprovisionamientos"],
  ["620", "Gastos en investigación y desarrollo del ejercicio"],
  ["621", "Arrendamientos y cánones"],
  ["622", "Reparaciones y conservación"],
  ["623", "Servicios de profesionales independientes"],
  ["624", "Transportes"],
  ["625", "Primas de seguros"],
  ["626", "Servicios bancarios y similares"],
  ["627", "Publicidad, propaganda y relaciones públicas"],
  ["628", "Suministros"],
  ["629", "Otros servicios"],
  ["630", "Impuesto sobre beneficios"],
  ["631", "Otros tributos"],
  ["633", "Ajustes positivos en la imposición sobre beneficios"],
  ["634", "Ajustes negativos en la imposición sobre beneficios"],
  ["640", "Sueldos y salarios"],
  ["641", "Indemnizaciones"],
  ["642", "Seguridad Social a cargo de la empresa"],
  ["649", "Otros gastos sociales"],
  ["650", "Pérdidas de créditos comerciales incobrables"],
  ["659", "Otras pérdidas en gestión corriente"],
  ["660", "Gastos financieros por actualización de provisiones"],
  ["662", "Intereses de deudas"],
  ["663", "Pérdidas por valoración de instrumentos financieros por su valor razonable"],
  ["665", "Intereses por descuento de efectos"],
  ["669", "Otros gastos financieros"],
  ["670", "Pérdidas procedentes del inmovilizado intangible"],
  ["671", "Pérdidas procedentes del inmovilizado material"],
  ["672", "Pérdidas procedentes de las inversiones inmobiliarias"],
  ["678", "Gastos excepcionales"],
  ["680", "Amortización del inmovilizado intangible"],
  ["681", "Amortización del inmovilizado material"],
  ["682", "Amortización de las inversiones inmobiliarias"],
  ["690", "Pérdidas por deterioro del inmovilizado intangible"],
  ["691", "Pérdidas por deterioro del inmovilizado material"],
  ["692", "Pérdidas por deterioro de las inversiones inmobiliarias"],
  ["693", "Pérdidas por deterioro de existencias"],
  ["694", "Pérdidas por deterioro de créditos por operaciones comerciales"],
  ["695", "Dotación a la provisión para otras responsabilidades"],
  ["696", "Pérdidas por deterioro de participaciones"],

  ["700", "Ventas de mercaderías"],
  ["701", "Ventas de productos terminados"],
  ["702", "Ventas de productos semiterminados"],
  ["703", "Ventas de subproductos y residuos"],
  ["704", "Ventas de envases y embalajes"],
  ["705", "Prestaciones de servicios"],
  ["706", "Descuentos sobre ventas por pronto pago"],
  ["708", "Devoluciones de ventas y operaciones similares"],
  ["709", "Rappels sobre ventas"],
  ["710", "Variación de existencias de productos terminados y en curso de fabricación"],
  ["730", "Trabajos realizados para el inmovilizado intangible"],
  ["731", "Trabajos realizados para el inmovilizado material"],
  ["732", "Trabajos realizados en inversiones inmobiliarias"],
  ["733", "Trabajos realizados para el inmovilizado material en curso"],
  ["740", "Subvenciones, donaciones y legados a la explotación"],
  ["746", "Subvenciones, donaciones y legados de capital transferidos al resultado del ejercicio"],
  ["747", "Otras subvenciones, donaciones y legados transferidos al resultado del ejercicio"],
  ["752", "Ingresos por arrendamientos"],
  ["755", "Ingresos de servicios al personal"],
  ["759", "Ingresos por servicios diversos"],
  ["760", "Ingresos de participaciones en instrumentos de patrimonio"],
  ["761", "Ingresos de valores representativos de deuda"],
  ["762", "Ingresos de créditos"],
  ["768", "Diferencias de cambio"],
  ["769", "Otros ingresos financieros"],
  ["770", "Beneficios procedentes del inmovilizado intangible"],
  ["771", "Beneficios procedentes del inmovilizado material"],
  ["772", "Beneficios procedentes de las inversiones inmobiliarias"],
  ["778", "Ingresos excepcionales"],
];

/** Convierte los códigos antiguos del PGC a la representación de seis cifras. */
export function normalizarCodigoCuenta(value) {
  const code = String(value == null ? "" : value).trim();
  if (!/^\d{3,6}$/.test(code)) return "";
  return code.padEnd(6, "0");
}

const catalogoSeisCifras = new Map();
for (const [rawCode, name] of LISTA) {
  const code = normalizarCodigoCuenta(rawCode);
  if (!catalogoSeisCifras.has(code) || rawCode.length === 6) catalogoSeisCifras.set(code, name);
}

/** Cuentas del PGC presentadas siempre con seis cifras. */
export const PGC_CUENTAS = Object.freeze(
  [...catalogoSeisCifras].map(([code, name]) => ({ code, name }))
);

const POR_CODIGO = new Map(PGC_CUENTAS.map(({ code, name }) => [code, name]));

/**
 * El nombre de una cuenta según el plan. Si le pasan una subcuenta de seis
 * dígitos, devuelve el nombre de su cuenta madre (430001 → «Clientes»).
 */
export function pgcNombre(code) {
  const c = normalizarCodigoCuenta(code);
  if (!c) return "";
  return POR_CODIGO.get(c) || POR_CODIGO.get(`${c.slice(0, 3)}000`) || "";
}

/** ¿Está esa cuenta en el plan? */
export function pgcTiene(code) {
  const c = normalizarCodigoCuenta(code);
  return Boolean(c && (POR_CODIGO.has(c) || POR_CODIGO.has(`${c.slice(0, 3)}000`)));
}

/**
 * El primer número libre para abrir una subcuenta de un prefijo:
 * siguienteSubcuenta("430", ["430001", "430002"]) → "430003".
 */
export function siguienteSubcuenta(prefijo, usados = []) {
  const pre = String(prefijo || "").slice(0, 3);
  let max = 0;
  for (const code of usados || []) {
    const c = String(code || "");
    if (c.slice(0, 3) !== pre || c.length <= 3) continue;
    const n = parseInt(c.slice(3), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${pre}${String(max + 1).padStart(3, "0")}`;
}
