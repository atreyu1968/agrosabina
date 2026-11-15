import "./_group.css";
import {
  ArrowRight, BarChart3, Boxes, BriefcaseBusiness, ClipboardList, FileText,
  FolderClosed, LayoutDashboard, Mail, Search, ShoppingCart, Truck, Upload,
} from "lucide-react";

const sections = [
  { label: "Resumen", icon: LayoutDashboard, active: true },
  { label: "Ventas", icon: BarChart3 },
  { label: "Control de fruta", icon: BarChart3 },
  { label: "Compras", icon: ShoppingCart },
  { label: "Proveedores", icon: Truck },
  { label: "Nóminas", icon: ClipboardList },
  { label: "Contabilidad", icon: FileText },
  { label: "Documentos", icon: FolderClosed },
  { label: "Correo", icon: Mail },
  { label: "Importar", icon: Upload },
  { label: "Probar lectura", icon: Search },
];

export function Current() {
  return (
    <div className="ag-current">
      <aside className="ag-sidebar">
        <div className="ag-brand">
          <img src="/__mockup/images/agrosabina.png" alt="Agrosabina" />
          <span>Compras, liquidaciones e IGIC</span>
        </div>
        <nav>
          {sections.map(({ label, icon: Icon, active }) => (
            <a className={active ? "active" : ""} href="#" key={label}>
              <Icon size={18} strokeWidth={1.7} /><span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="ag-sidebar-note">
          <strong>Agrosabina SL</strong>
          <p>Programa contable de la empresa.</p>
          <small>Los datos se guardan en este navegador</small>
        </div>
      </aside>
      <main className="ag-main">
        <header className="ag-topbar">
          <div><h1>Resumen</h1><p>Agrosabina SL · Todo al día. Nada pendiente de pago.</p></div>
          <div className="ag-top-actions"><button>Ajustes</button><button className="primary"><Upload size={16}/>Importar factura</button></div>
        </header>
        <div className="ag-content">
          <section className="ag-welcome">
            <div className="ag-welcome-icon"><Boxes size={26}/></div>
            <h2>Empieza con tu primera factura</h2>
            <p>Sube una foto o un PDF de una factura y la leo yo: proveedor, número, fecha, base, IGIC y total. Después solo tienes que comprobar que está bien.</p>
            <div className="ag-welcome-actions">
              <button className="primary"><Upload size={17}/>Subir una factura</button>
              <button>Escribirla a mano</button>
              <button className="text-button">Ver con datos de ejemplo</button>
            </div>
          </section>
          <section className="ag-howto">
            <div className="ag-howto-head"><strong>Cómo funciona</strong><span>Tres pasos y la factura queda guardada</span></div>
            <div className="ag-steps">
              <article><b>1</b><h3>Sube la factura</h3><p>Una foto del móvil, un escaneo o el PDF que te ha mandado el proveedor.</p></article>
              <article><b>2</b><h3>Revisa lo que he leído</h3><p>Relleno proveedor, número, fechas, base, IGIC y total.</p></article>
              <article><b>3</b><h3>Marca pagado o pendiente</h3><p>El resumen te dice cuánto debes y cuánto IGIC llevas.</p></article>
            </div>
          </section>
          <p className="ag-sample-note"><BriefcaseBusiness size={14}/> Captura del inicio actual de la aplicación</p>
        </div>
      </main>
    </div>
  );
}

export function Friendly() {
  return <Current />;
}
