# Agrosabina · Gestión e IGIC

Aplicación importada del archivo RAR del usuario para gestionar compras, ventas,
proveedores, nóminas, documentos, contabilidad e IGIC.

## Aplicación importada

- `artifacts/agrosabina/index.html` y `artifacts/agrosabina/assets/` contienen la aplicación original.
- `artifacts/agrosabina/README.original.md` documenta sus funciones y limitaciones.
- Se sirve con Vite mediante `pnpm --filter @workspace/agrosabina run dev`.
- Se conserva HTML, CSS y JavaScript original: la petición fue interpretar y cargar la aplicación, no rediseñarla ni reescribirla en React.
- Los registros se guardan en SQLite/IndexedDB en el navegador, con respaldo en localStorage. No migrar a PostgreSQL sin petición expresa.
- Los datos de otros navegadores u orígenes no se transfieren automáticamente; usar las funciones originales de importación/exportación.
- PDF.js, Tesseract y sql.js se descargan desde servicios externos. La IA es opcional y permanece desactivada inicialmente.
- No añadir datos de ejemplo automáticamente.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
