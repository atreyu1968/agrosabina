import { useEffect, useRef } from "react";
import "./_group.css";
// @ts-expect-error The extracted source is the existing vanilla JS view.
import { renderMobileScreen } from "./mobile-view.js";

export function Current() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    root.current.innerHTML = renderMobileScreen({
      user: { name: "María Hernández" },
      invoices: [
        { id: "invoice-1", direction: "GASTO", party: "Suministros La Vega", number: "FV-2048", issueDate: "2026-10-18", total: 486.2, year: 2026 },
        { id: "invoice-2", direction: "INGRESO", party: "Cooperativa del Norte", number: "LF-1582", issueDate: "2026-10-12", total: 1240, year: 2026 },
      ],
      filter: "ALL",
      inbox: [
        { id: "file-1", name: "Liquidación octubre.pdf", type: "application/pdf", size: 840000, savedAt: "2026-11-15T10:30:00Z" },
      ],
      passkeyCount: 1,
      passkeySupported: true,
    }).replace('src="assets/img/agrosabina.png"', 'src="/__mockup/images/agrosabina-wordmark.png"');
  }, []);

  return <div ref={root} />;
}
