import {
  ArrowDownLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  ChevronRight,
  CircleHelp,
  FileText,
  FolderOpen,
  Inbox,
  Mail,
  MoreHorizontal,
  Search,
  Settings2,
  ShoppingBasket,
  Sprout,
  Truck,
  Upload,
  UsersRound,
} from "lucide-react";

const groups = [
  {
    eyebrow: "ENTRADAS",
    title: "Dinero que entra",
    description: "Ventas, liquidaciones y seguimiento de la fruta.",
    icon: ArrowDownLeft,
    tone: "income",
    items: [
      { name: "Ventas y liquidaciones", detail: "Ingresos por comprador", icon: BarChart3 },
      { name: "Control de fruta", detail: "Categorías, kilos y precios", icon: Boxes },
    ],
  },
  {
    eyebrow: "SALIDAS Y PERSONAS",
    title: "Gastos y equipo",
    description: "Compras, proveedores y nóminas en un mismo sitio.",
    icon: ShoppingBasket,
    tone: "costs",
    items: [
      { name: "Compras", detail: "Facturas y pagos pendientes", icon: ShoppingBasket },
      { name: "Proveedores", detail: "Contactos y datos de facturación", icon: Truck },
      { name: "Nóminas", detail: "Documentación del equipo", icon: UsersRound },
    ],
  },
  {
    eyebrow: "ORDEN Y CONSULTA",
    title: "Papeles y cuentas",
    description: "Todo lo que necesitas consultar o archivar.",
    icon: BookOpen,
    tone: "records",
    items: [
      { name: "Contabilidad", detail: "Asientos e informes", icon: BookOpen },
      { name: "Documentos", detail: "Facturas y archivos guardados", icon: FolderOpen },
      { name: "Correo", detail: "Documentos recibidos por email", icon: Mail },
    ],
  },
];

function ModuleRow({
  name,
  detail,
  icon: Icon,
}: {
  name: string;
  detail: string;
  icon: typeof BarChart3;
}) {
  return (
    <div className="fa-module" aria-label={`${name}: ${detail}`}>
      <span className="fa-module-icon"><Icon size={18} strokeWidth={1.8} /></span>
      <span className="fa-module-copy">
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>
      <ChevronRight className="fa-chevron" size={17} />
    </div>
  );
}

export function Friendly() {
  return (
    <div className="friendly-ag">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap');
        .friendly-ag {
          --fa-bg: #f4f3eb;
          --fa-paper: #fffefa;
          --fa-paper-soft: #faf9f3;
          --fa-ink: #20332b;
          --fa-muted: #617067;
          --fa-soft-muted: #748077;
          --fa-line: #e4e4d8;
          --fa-green: #17634f;
          --fa-green-deep: #124b3d;
          --fa-green-pale: #e8f1e9;
          --fa-amber: #a76332;
          --fa-amber-pale: #f7eee3;
          --fa-bluegray: #4d6864;
          min-height: 100vh;
          color: var(--fa-ink);
          background:
            radial-gradient(ellipse at 77% 0%, rgba(222, 230, 210, .48), transparent 31rem),
            var(--fa-bg);
          font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
          font-size: 14px;
          line-height: 1.45;
        }
        .friendly-ag * { box-sizing: border-box; }
        .fa-shell { display: flex; min-height: 100vh; }
        .fa-sidebar {
          width: 248px;
          flex: 0 0 248px;
          display: flex;
          flex-direction: column;
          padding: 26px 17px 18px;
          background: #fbfaf5;
          border-right: 1px solid var(--fa-line);
        }
        .fa-brand { padding: 0 10px 25px; }
        .fa-brand img {
          width: 158px;
          height: 66px;
          display: block;
          object-fit: contain;
          object-position: left center;
          mix-blend-mode: multiply;
        }
        .fa-brand-caption {
          display: flex;
          align-items: center;
          gap: 7px;
          margin-top: 4px;
          color: var(--fa-muted);
          font-size: 11px;
          letter-spacing: .01em;
        }
        .fa-brand-caption svg { color: var(--fa-green); }
        .fa-nav-label {
          margin: 0 10px 8px;
          color: #879087;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: .13em;
        }
        .fa-overview {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 43px;
          margin-bottom: 21px;
          padding: 0 11px;
          color: var(--fa-green-deep);
          background: var(--fa-green-pale);
          border-radius: 9px;
          font-weight: 700;
        }
        .fa-sidebar-group { margin-bottom: 17px; }
        .fa-sidebar-group-title {
          margin: 0 10px 6px;
          color: var(--fa-soft-muted);
          font-size: 11px;
          font-weight: 700;
        }
        .fa-side-item {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 34px;
          padding: 6px 11px;
          color: #526157;
          font-size: 12px;
        }
        .fa-side-item svg { color: #77837a; }
        .fa-sidebar-bottom { margin-top: auto; }
        .fa-help {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 12px 10px;
          color: #56685d;
          border-top: 1px solid var(--fa-line);
          font-size: 12px;
        }
        .fa-help svg { color: var(--fa-green); }
        .fa-company {
          padding: 13px 12px 11px;
          border: 1px solid var(--fa-line);
          border-radius: 11px;
          background: #f7f6ef;
        }
        .fa-company-mark {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .fa-company strong { font-size: 12px; }
        .fa-company p {
          margin: 5px 0 0;
          color: var(--fa-muted);
          font-size: 10px;
          line-height: 1.5;
        }
        .fa-main { min-width: 0; flex: 1; }
        .fa-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          min-height: 83px;
          padding: 17px clamp(24px, 4vw, 58px);
          border-bottom: 1px solid rgba(222, 224, 213, .9);
          background: rgba(249, 248, 241, .75);
        }
        .fa-breadcrumb {
          color: var(--fa-muted);
          font-size: 11px;
        }
        .fa-breadcrumb b { color: var(--fa-ink); font-weight: 700; }
        .fa-top-right { display: flex; align-items: center; gap: 17px; }
        .fa-context {
          color: var(--fa-muted);
          font-size: 11px;
        }
        .fa-avatar {
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          border: 1px solid #d3ddcf;
          border-radius: 50%;
          background: #e8eee4;
          color: var(--fa-green-deep);
          font-size: 11px;
          font-weight: 700;
        }
        .fa-content {
          width: min(100%, 1260px);
          margin: 0 auto;
          padding: 34px clamp(24px, 4vw, 58px) 58px;
        }
        .fa-greeting {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 22px;
          margin-bottom: 23px;
        }
        .fa-kicker {
          display: flex;
          align-items: center;
          gap: 7px;
          margin: 0 0 7px;
          color: var(--fa-green);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .12em;
          text-transform: uppercase;
        }
        .fa-greeting h1 {
          margin: 0;
          font-family: 'Newsreader', Georgia, serif;
          font-size: clamp(29px, 3vw, 38px);
          font-weight: 500;
          letter-spacing: -.035em;
          line-height: 1.12;
        }
        .fa-greeting p {
          margin: 8px 0 0;
          color: var(--fa-muted);
          font-size: 13px;
        }
        .fa-date {
          flex: 0 0 auto;
          padding-bottom: 5px;
          color: #657269;
          font-size: 11px;
        }
        .fa-hero {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1.25fr) minmax(220px, .75fr);
          align-items: center;
          gap: 24px;
          min-height: 213px;
          overflow: hidden;
          padding: 27px 31px;
          border: 1px solid #d2dfd2;
          border-radius: 15px;
          background:
            linear-gradient(112deg, rgba(235, 243, 231, .97) 0%, rgba(235, 243, 231, .97) 57%, rgba(224, 235, 219, .7) 100%);
        }
        .fa-hero::after {
          position: absolute;
          right: -60px;
          bottom: -126px;
          width: 310px;
          height: 310px;
          border: 1px solid rgba(44, 105, 76, .12);
          border-radius: 50%;
          content: "";
          box-shadow: 0 0 0 26px rgba(44, 105, 76, .035), 0 0 0 54px rgba(44, 105, 76, .025);
          pointer-events: none;
        }
        .fa-hero-copy { position: relative; z-index: 1; max-width: 560px; }
        .fa-hero-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 9px;
          border: 1px solid #d4e0d2;
          border-radius: 999px;
          background: rgba(255, 255, 250, .62);
          color: #4f6c56;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: .1em;
          text-transform: uppercase;
        }
        .fa-hero h2 {
          margin: 12px 0 7px;
          color: #214335;
          font-family: 'Newsreader', Georgia, serif;
          font-size: clamp(22px, 2.5vw, 29px);
          font-weight: 500;
          letter-spacing: -.025em;
          line-height: 1.16;
        }
        .fa-hero p {
          max-width: 480px;
          margin: 0;
          color: #52695a;
          font-size: 12px;
          line-height: 1.6;
        }
        .fa-hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 17px; }
        .fa-button {
          display: inline-flex;
          justify-content: center;
          align-items: center;
          gap: 9px;
          min-height: 43px;
          padding: 0 16px;
          border: 1px solid transparent;
          border-radius: 9px;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
        }
        .fa-button:disabled { cursor: not-allowed; }
        .fa-button-primary {
          background: var(--fa-green);
          color: #fffefa;
          box-shadow: 0 2px 4px rgba(22, 75, 58, .13);
        }
        .fa-button-secondary {
          border-color: #ced9ca;
          background: rgba(255, 254, 250, .68);
          color: #315544;
        }
        .fa-hero-art {
          position: relative;
          z-index: 1;
          display: grid;
          place-items: center;
          min-height: 150px;
          color: #47785a;
        }
        .fa-illustration {
          position: relative;
          display: grid;
          place-items: center;
          width: 138px;
          height: 138px;
          border: 1px solid rgba(47, 111, 75, .16);
          border-radius: 50%;
          background: rgba(250, 252, 242, .43);
        }
        .fa-illustration::before, .fa-illustration::after {
          position: absolute;
          border: 1px solid rgba(47, 111, 75, .15);
          border-radius: 50%;
          content: "";
        }
        .fa-illustration::before { inset: 13px; }
        .fa-illustration::after { inset: 27px; }
        .fa-illustration svg { position: relative; z-index: 1; }
        .fa-upload-tag {
          position: absolute;
          right: -30px;
          bottom: 9px;
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 9px 11px;
          border: 1px solid #e1e4d8;
          border-radius: 9px;
          background: #fffefa;
          color: #44584b;
          box-shadow: 0 6px 16px rgba(38, 65, 45, .08);
          font-size: 10px;
          font-weight: 600;
        }
        .fa-upload-tag svg { color: var(--fa-green); }
        .fa-preview-note {
          margin: 10px 0 0;
          color: #7a847b;
          font-size: 10px;
        }
        .fa-section-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          margin: 34px 0 14px;
        }
        .fa-section-head h2 {
          margin: 0;
          font-family: 'Newsreader', Georgia, serif;
          font-size: 23px;
          font-weight: 500;
          letter-spacing: -.02em;
        }
        .fa-section-head p { margin: 4px 0 0; color: var(--fa-muted); font-size: 11px; }
        .fa-key-hint { color: #7b857d; font-size: 10px; }
        .fa-group-list { display: grid; gap: 12px; }
        .fa-group {
          display: grid;
          grid-template-columns: minmax(180px, .78fr) minmax(0, 1.55fr);
          gap: 20px;
          padding: 18px 20px;
          border: 1px solid var(--fa-line);
          border-radius: 12px;
          background: rgba(255, 254, 250, .83);
          box-shadow: 0 1px 1px rgba(29, 47, 35, .025);
        }
        .fa-group-intro { display: flex; gap: 12px; align-items: flex-start; }
        .fa-group-symbol {
          display: grid;
          place-items: center;
          width: 36px;
          height: 36px;
          flex: 0 0 36px;
          border-radius: 10px;
        }
        .fa-group.income .fa-group-symbol { background: #e8f1e9; color: #316a4e; }
        .fa-group.costs .fa-group-symbol { background: var(--fa-amber-pale); color: #9a6338; }
        .fa-group.records .fa-group-symbol { background: #e9efed; color: var(--fa-bluegray); }
        .fa-group-eyebrow {
          margin: 0 0 3px;
          color: #879087;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: .12em;
        }
        .fa-group h3 { margin: 0; font-size: 13px; font-weight: 700; }
        .fa-group-description {
          max-width: 230px;
          margin: 5px 0 0;
          color: var(--fa-muted);
          font-size: 10px;
          line-height: 1.5;
        }
        .fa-module-list {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-content: center;
          gap: 4px 12px;
        }
        .fa-module {
          display: flex;
          align-items: center;
          min-width: 0;
          min-height: 49px;
          gap: 10px;
          padding: 6px 9px;
          border-radius: 8px;
          color: var(--fa-ink);
        }
        .fa-module-icon { display: grid; place-items: center; flex: 0 0 24px; color: #698074; }
        .fa-module-copy { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
        .fa-module-copy strong { font-size: 11px; font-weight: 700; }
        .fa-module-copy small {
          overflow: hidden;
          color: var(--fa-muted);
          font-size: 9px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fa-chevron { flex: 0 0 auto; margin-left: auto; color: #9aa39a; }
        .fa-tools {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-top: 22px;
          padding: 14px 16px;
          border: 1px dashed #d7d9ce;
          border-radius: 10px;
          background: rgba(247, 247, 239, .66);
        }
        .fa-tools-copy { display: flex; align-items: center; gap: 11px; }
        .fa-tools-icon {
          display: grid;
          place-items: center;
          width: 33px;
          height: 33px;
          flex: 0 0 33px;
          border-radius: 9px;
          background: #eeeee6;
          color: #64736a;
        }
        .fa-tools strong { display: block; font-size: 11px; }
        .fa-tools p { margin: 2px 0 0; color: var(--fa-muted); font-size: 10px; }
        .fa-tools-button {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 10px;
          border: 1px solid #d8d9d0;
          border-radius: 8px;
          background: #fbfaf5;
          color: #5e6d62;
          font: inherit;
          font-size: 10px;
          font-weight: 600;
        }
        .fa-tools-button:disabled { cursor: not-allowed; }
        .fa-footer {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-top: 24px;
          padding-top: 13px;
          border-top: 1px solid var(--fa-line);
          color: #7c867e;
          font-size: 9px;
        }
        .fa-footer-brand { display: flex; align-items: center; gap: 6px; }
        @media (max-width: 900px) {
          .fa-sidebar { width: 210px; flex-basis: 210px; }
          .fa-hero { grid-template-columns: minmax(0, 1fr) 180px; padding: 24px; }
          .fa-illustration { width: 122px; height: 122px; }
          .fa-upload-tag { right: -20px; }
          .fa-group { grid-template-columns: minmax(155px, .7fr) minmax(0, 1.5fr); gap: 10px; padding: 16px; }
          .fa-module-list { grid-template-columns: 1fr; }
        }
        @media (max-width: 680px) {
          .fa-shell { display: block; }
          .fa-sidebar {
            width: auto;
            padding: 12px 18px 11px;
            border-right: 0;
            border-bottom: 1px solid var(--fa-line);
          }
          .fa-brand { display: flex; align-items: center; gap: 13px; padding: 0; }
          .fa-brand img { width: 112px; height: 48px; }
          .fa-brand-caption { margin: 0; padding-left: 12px; border-left: 1px solid var(--fa-line); font-size: 10px; }
          .fa-nav-label, .fa-overview, .fa-sidebar-group, .fa-sidebar-bottom { display: none; }
          .fa-topbar { min-height: 54px; padding: 11px 18px; }
          .fa-breadcrumb { font-size: 10px; }
          .fa-top-right { gap: 10px; }
          .fa-context { font-size: 9px; }
          .fa-avatar { width: 29px; height: 29px; }
          .fa-content { padding: 25px 18px 35px; }
          .fa-greeting { align-items: flex-start; margin-bottom: 18px; }
          .fa-greeting h1 { font-size: 31px; }
          .fa-greeting p { max-width: 290px; font-size: 12px; }
          .fa-date { display: none; }
          .fa-hero {
            display: block;
            min-height: auto;
            padding: 21px 18px;
            border-radius: 13px;
          }
          .fa-hero h2 { max-width: 340px; font-size: 24px; }
          .fa-hero p { font-size: 11px; }
          .fa-hero-art {
            position: absolute;
            top: -31px;
            right: -28px;
            min-height: 0;
            opacity: .26;
            transform: scale(.72);
            transform-origin: top right;
          }
          .fa-illustration { width: 125px; height: 125px; }
          .fa-upload-tag { display: none; }
          .fa-hero-copy { max-width: 100%; }
          .fa-hero-actions { position: relative; z-index: 2; align-items: stretch; flex-direction: column; max-width: 270px; }
          .fa-button { min-height: 44px; }
          .fa-preview-note { max-width: 280px; font-size: 9px; }
          .fa-section-head { align-items: flex-start; margin: 28px 0 12px; }
          .fa-section-head h2 { font-size: 21px; }
          .fa-key-hint { display: none; }
          .fa-group-list { gap: 10px; }
          .fa-group { display: block; padding: 15px 14px 10px; }
          .fa-group-intro { gap: 10px; }
          .fa-group-description { max-width: none; }
          .fa-module-list {
            grid-template-columns: 1fr;
            gap: 0;
            margin-top: 10px;
            padding-top: 7px;
            border-top: 1px solid #eeeee6;
          }
          .fa-module { min-height: 47px; padding: 5px 2px; }
          .fa-module + .fa-module { border-top: 1px solid #f0f0e9; }
          .fa-module-copy strong { font-size: 11px; }
          .fa-module-copy small { font-size: 9px; }
          .fa-tools { align-items: flex-start; flex-direction: column; gap: 12px; margin-top: 15px; padding: 13px; }
          .fa-tools-button { margin-left: 44px; }
          .fa-footer { flex-direction: column; gap: 5px; margin-top: 18px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .friendly-ag *, .friendly-ag *::before, .friendly-ag *::after { scroll-behavior: auto !important; }
        }
      `}</style>
      <div className="fa-shell">
        <aside className="fa-sidebar" aria-label="Navegación principal">
          <div className="fa-brand">
            <img src="/__mockup/images/agrosabina.png" alt="Agrosabina" />
            <span className="fa-brand-caption"><Sprout size={14} /> Compras, liquidaciones e IGIC</span>
          </div>
          <p className="fa-nav-label">TU ESPACIO</p>
          <div className="fa-overview"><BarChart3 size={17} /> Inicio</div>
          {groups.map((group) => (
            <div className="fa-sidebar-group" key={group.title}>
              <p className="fa-sidebar-group-title">{group.title}</p>
              {group.items.map(({ name, icon: Icon }) => (
                <div className="fa-side-item" key={name}><Icon size={15} /><span>{name}</span></div>
              ))}
            </div>
          ))}
          <div className="fa-sidebar-bottom">
            <div className="fa-help"><CircleHelp size={16} /> Ayuda y orientación</div>
            <div className="fa-company">
              <div className="fa-company-mark"><strong>Agrosabina SL</strong><MoreHorizontal size={17} /></div>
              <p>Gestión de la actividad agrícola</p>
            </div>
          </div>
        </aside>

        <main className="fa-main">
          <header className="fa-topbar">
            <div className="fa-breadcrumb">Agrosabina SL <span aria-hidden="true">/</span> <b>Inicio</b></div>
            <div className="fa-top-right">
              <span className="fa-context">Vista de propuesta</span>
              <span className="fa-avatar" aria-label="Cuenta Agrosabina">AS</span>
            </div>
          </header>
          <div className="fa-content">
            <div className="fa-greeting">
              <div>
                <p className="fa-kicker"><Sprout size={13} /> Panel de trabajo</p>
                <h1>Buenos días, Agrosabina</h1>
                <p>Tu actividad, ordenada para que encuentres cada cosa a la primera.</p>
              </div>
              <span className="fa-date">Resumen de la empresa</span>
            </div>

            <section className="fa-hero" aria-labelledby="fa-hero-title">
              <div className="fa-hero-copy">
                <span className="fa-hero-label"><Inbox size={13} /> Añadir documento</span>
                <h2 id="fa-hero-title">¿Tienes una factura o liquidación?</h2>
                <p>Sube una foto o un PDF. Después podrás revisar los datos y guardarlos en el apartado que corresponda.</p>
                <div className="fa-hero-actions">
                  <button className="fa-button fa-button-primary" type="button" disabled title="Acción visual; no conectada en esta vista">
                    <Upload size={16} /> Subir factura o liquidación
                  </button>
                  <button className="fa-button fa-button-secondary" type="button" disabled title="Acción visual; no conectada en esta vista">
                    Importar datos <ArrowRight size={15} />
                  </button>
                </div>
                <p className="fa-preview-note">Acciones de muestra: esta vista previa no procesa archivos.</p>
              </div>
              <div className="fa-hero-art" aria-hidden="true">
                <div className="fa-illustration"><FileText size={39} strokeWidth={1.25} /></div>
                <div className="fa-upload-tag"><Upload size={14} /> Foto o PDF</div>
              </div>
            </section>

            <div className="fa-section-head">
              <div>
                <h2>Encuentra lo que necesitas</h2>
                <p>Las tareas están agrupadas por cómo se mueve el dinero y el trabajo.</p>
              </div>
              <span className="fa-key-hint">10 apartados · organizados en 3 grupos</span>
            </div>

            <div className="fa-group-list">
              {groups.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <section className={`fa-group ${group.tone}`} key={group.title}>
                    <div className="fa-group-intro">
                      <span className="fa-group-symbol"><GroupIcon size={18} strokeWidth={1.8} /></span>
                      <div>
                        <p className="fa-group-eyebrow">{group.eyebrow}</p>
                        <h3>{group.title}</h3>
                        <p className="fa-group-description">{group.description}</p>
                      </div>
                    </div>
                    <div className="fa-module-list">
                      {group.items.map((item) => <ModuleRow key={item.name} {...item} />)}
                    </div>
                  </section>
                );
              })}
            </div>

            <section className="fa-tools" aria-label="Administración">
              <div className="fa-tools-copy">
                <span className="fa-tools-icon"><Settings2 size={17} /></span>
                <div>
                  <strong>Administración y herramientas</strong>
                  <p>Opciones técnicas para revisar cómo se leen los documentos.</p>
                </div>
              </div>
              <button className="fa-tools-button" type="button" disabled title="Acción visual; no conectada en esta vista">
                <Search size={14} /> Probar lectura
              </button>
            </section>
            <footer className="fa-footer">
              <span className="fa-footer-brand"><BriefcaseBusiness size={12} /> Agrosabina SL · Espacio de gestión</span>
              <span>Los documentos se conservan en su apartado correspondiente.</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
