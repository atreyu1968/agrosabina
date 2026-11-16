import { useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import "./_group.css";
import "./Tabs.css";

type TabKey = "pending" | "upload" | "review" | "account";
type Invoice = { direction: "INGRESO" | "GASTO"; party: string; number: string; date: string; amount: number };
type DocumentFile = { id: number; name: string; detail: string; kind: string };

const initialInvoices: Invoice[] = [
  { direction: "GASTO", party: "Suministros La Vega", number: "FV-2048", date: "18 oct 2026", amount: 486.2 },
  { direction: "INGRESO", party: "Cooperativa del Norte", number: "LF-1582", date: "12 oct 2026", amount: 1240 },
  { direction: "GASTO", party: "Riego y Campo Canarias", number: "RCC-091", date: "9 oct 2026", amount: 172.85 },
];
const initialFiles: DocumentFile[] = [
  { id: 1, name: "Liquidación octubre.pdf", detail: "840 KB · Hoy", kind: "PDF" },
  { id: 2, name: "Factura vivero.jpg", detail: "2,1 MB · Ayer", kind: "IMG" },
];
const money = (amount: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(amount);

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    leaf: <><path d="M20 4c-8 0-14 4-14 11a5 5 0 0 0 5 5c7 0 11-6 9-16Z" /><path d="M4 21c3-5 6-8 12-12" /></>,
    receipt: <><path d="M6 3.5h12v17l-3-1.7-3 1.7-3-1.7-3 1.7v-17Z" /><path d="M9 8h6m-6 4h6m-6 4h3" /></>,
    camera: <><path d="M4 7.5h3l1.4-2h7.2l1.4 2h3A1.5 1.5 0 0 1 21.5 9v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z" /><circle cx="12" cy="13.5" r="3.5" /></>,
    upload: <><path d="M12 15.5V3.8m-4.6 4.6L12 3.8l4.6 4.6" /><path d="M4 14.5v4a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-4" /></>,
    file: <><path d="M6 2.75h7l5 5V21H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z" /><path d="M13 3v5h5M8 13h8M8 16.5h6" /></>,
    person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    check: <path d="m5 12.5 4.5 4L19 7" />,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  };
  return <svg className="ag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.file}</svg>;
}

const tabs: { id: TabKey; label: string; icon: string }[] = [
  { id: "pending", label: "Pendientes", icon: "receipt" },
  { id: "upload", label: "Subir", icon: "camera" },
  { id: "review", label: "Revisar", icon: "file" },
  { id: "account", label: "Cuenta", icon: "person" },
];

export function Tabs() {
  const [tab, setTab] = useState<TabKey>("pending");
  const [filter, setFilter] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [invoices, setInvoices] = useState(initialInvoices);
  const [files, setFiles] = useState(initialFiles);
  const [notice, setNotice] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const shownInvoices = invoices.filter((item) => filter === "ALL" || (filter === "IN" ? item.direction === "INGRESO" : item.direction === "GASTO"));

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;
    setFiles((current) => [...selected.map((file) => ({
      id: Date.now() + Math.random(),
      name: file.name,
      detail: `${file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`} · Ahora`,
      kind: file.type === "application/pdf" ? "PDF" : "IMG",
    })), ...current]);
    setNotice(`${selected.length === 1 ? "Documento guardado" : `${selected.length} documentos guardados`} para revisar.`);
    event.target.value = "";
  };

  const pageTitle = { pending: "Lo pendiente, de un vistazo.", upload: "Guarda el documento.", review: "Tu bandeja de revisión.", account: "Tu cuenta de campo." }[tab];

  return (
    <div className="ag-mobile">
      <header className="ag-header">
        <img className="ag-wordmark" src="/__mockup/images/agrosabina-wordmark.png" alt="Agrosabina" />
        <span className="ag-presence"><i /> En el campo</span>
      </header>
      <main className="ag-main" key={tab}>
        <div className="ag-greeting">
          <p className="ag-kicker"><Icon name="leaf" /> GESTIÓN DE CAMPO <span>·</span> TENERIFE</p>
          <h1>{pageTitle}</h1>
          <p className="ag-subtitle">{tab === "pending" ? "María, esto es lo que queda por cerrar." : tab === "upload" ? "Fotografía o elige un archivo. Lo revisarás después." : tab === "review" ? "Documentos guardados, listos para comprobar." : "Acceso y preferencias de María Hernández."}</p>
        </div>

        {tab === "pending" && <>
          <section className="ag-summary" aria-label="Resumen de facturas pendientes">
            <div><span>POR COBRAR</span><strong>{money(1240)}</strong><small>1 factura</small></div>
            <div className="ag-summary-rule" />
            <div><span>POR PAGAR</span><strong>{money(659.05)}</strong><small>2 facturas</small></div>
          </section>
          <section className="ag-section">
            <div className="ag-heading"><div><p className="ag-kicker">SEGUIMIENTO</p><h2>Facturas abiertas</h2></div><span className="ag-count">{invoices.length}</span></div>
            <div className="ag-filters" role="group" aria-label="Filtrar facturas pendientes">
              {([["ALL", "Todas"], ["IN", "Por cobrar"], ["OUT", "Por pagar"]] as const).map(([key, label]) => <button key={key} type="button" className={filter === key ? "is-selected" : ""} onClick={() => setFilter(key)} aria-pressed={filter === key}>{label}</button>)}
            </div>
            <ul className="ag-invoice-list">{shownInvoices.map((invoice) => <li className="ag-invoice" key={invoice.number}>
              <span className={`ag-invoice-icon ${invoice.direction === "INGRESO" ? "income" : ""}`}><Icon name="receipt" /></span>
              <span className="ag-invoice-copy"><strong>{invoice.party}</strong><small>{invoice.direction === "INGRESO" ? "Ingreso" : "Gasto"} · {invoice.number}</small><small className="ag-date">{invoice.date}</small></span>
              <b>{money(invoice.amount)}</b>
            </li>)}</ul>
            {!shownInvoices.length && <p className="ag-empty">No hay facturas en este filtro.</p>}
            <button className="ag-text-link" type="button" onClick={() => setTab("review")}>Ver documentos por revisar <Icon name="arrow" /></button>
          </section>
          <aside className="ag-tip"><span className="ag-tip-mark"><Icon name="check" /></span><span><strong>Todo guardado con seguridad</strong><small>La revisión no modifica tu contabilidad.</small></span></aside>
        </>}

        {tab === "upload" && <section className="ag-upload-panel">
          <div className="ag-upload-illustration"><span><Icon name="file" /></span><i className="ag-spark">+</i><i className="ag-spark second">·</i></div>
          <p className="ag-kicker">CAPTURA RÁPIDA</p><h2>Un documento cada vez.</h2>
          <p className="ag-panel-copy">Las fotos y archivos se guardan en tu bandeja. No se contabilizan automáticamente.</p>
          <button type="button" className="ag-primary-action" onClick={() => cameraRef.current?.click()}><Icon name="camera" /><span><strong>Hacer una foto</strong><small>Abrir cámara del móvil</small></span><Icon name="arrow" /></button>
          <button type="button" className="ag-secondary-action" onClick={() => pickerRef.current?.click()}><Icon name="upload" /><span><strong>Elegir un archivo</strong><small>Imagen o PDF</small></span><Icon name="arrow" /></button>
          <input ref={cameraRef} className="ag-file-input" type="file" accept="image/*" capture="environment" onChange={addFiles} aria-label="Hacer una foto del documento" />
          <input ref={pickerRef} className="ag-file-input" type="file" accept="image/*,application/pdf,.pdf" multiple onChange={addFiles} aria-label="Elegir imágenes o archivos PDF" />
          <p className="ag-upload-foot"><Icon name="lock" /> Solo tú puedes ver los documentos guardados.</p>
        </section>}

        {tab === "review" && <section className="ag-section ag-review-section">
          <div className="ag-heading"><div><p className="ag-kicker">BANDEJA</p><h2>Por revisar</h2></div><span className="ag-count">{files.length}</span></div>
          {notice && <p className="ag-notice" role="status">{notice}</p>}
          {files.length ? <ul className="ag-file-list">{files.map((file) => <li className="ag-file-row" key={file.id}>
            <span className="ag-file-mark"><Icon name="file" /></span><span className="ag-file-copy"><strong>{file.name}</strong><small>{file.detail}</small></span><span className="ag-file-kind">{file.kind}</span>
            <button type="button" className="ag-file-done" aria-label={`Marcar ${file.name} como revisado`} onClick={() => { setFiles((current) => current.filter((item) => item.id !== file.id)); setNotice("Documento marcado como revisado."); }}><Icon name="check" /></button>
          </li>)}</ul> : <div className="ag-empty-state"><span><Icon name="check" /></span><strong>Bandeja al día</strong><p>Los documentos que fotografíes o subas aparecerán aquí.</p><button type="button" onClick={() => setTab("upload")}>Añadir documento</button></div>}
          <p className="ag-review-note">Al revisar un documento se retira de esta bandeja; el archivo original se conserva.</p>
          <button type="button" className="ag-outline-action" onClick={() => setTab("upload")}><Icon name="upload" /> Añadir otro documento</button>
        </section>}

        {tab === "account" && <section className="ag-account-view">
          <div className="ag-profile"><span className="ag-avatar">MH</span><div><strong>María Hernández</strong><small>Cuenta Agrosabina</small></div><span className="ag-account-check"><Icon name="check" /></span></div>
          <p className="ag-kicker ag-account-kicker">ACCESO Y SEGURIDAD</p>
          <div className="ag-setting"><span className="ag-setting-icon"><Icon name="lock" /></span><span><strong>Acceso biométrico</strong><small>Huella, Face ID o desbloqueo seguro</small></span><button className="ag-toggle" type="button" role="switch" aria-checked="true" aria-label="Acceso biométrico activado" onClick={(event) => { const button = event.currentTarget; const checked = button.getAttribute("aria-checked") === "true"; button.setAttribute("aria-checked", String(!checked)); button.setAttribute("aria-label", `Acceso biométrico ${checked ? "desactivado" : "activado"}`); }}><i /></button></div>
          <p className="ag-kicker ag-account-kicker">PREFERENCIAS</p>
          <button type="button" className="ag-setting ag-setting-button" onClick={() => setNotice("El idioma de la cuenta está configurado en Español.")}><span className="ag-setting-icon ag-language">ES</span><span><strong>Idioma</strong><small>Español</small></span><Icon name="arrow" /></button>
          <button type="button" className="ag-setting ag-setting-button" onClick={() => setNotice("Sincronización activa. Tus cambios están guardados.")}><span className="ag-setting-icon"><Icon name="check" /></span><span><strong>Estado de sincronización</strong><small>Actualizado ahora</small></span><span className="ag-sync-dot" /></button>
          {notice && <p className="ag-notice" role="status">{notice}</p>}
          <button type="button" className="ag-logout" onClick={() => setNotice("La sesión de María Hernández sigue activa en este dispositivo.")}>Cerrar sesión <Icon name="arrow" /></button>
          <p className="ag-version">Agrosabina móvil <span>·</span> Compañera de campo</p>
        </section>}
      </main>
      <nav className="ag-tabbar" aria-label="Navegación principal">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => { setTab(item.id); setNotice(""); }} aria-current={tab === item.id ? "page" : undefined} aria-label={`${item.label}${tab === item.id ? ", seleccionada" : ""}`}><span className="ag-tab-icon"><Icon name={item.icon} /></span><span>{item.label}</span></button>)}</nav>
    </div>
  );
}

export default Tabs;
