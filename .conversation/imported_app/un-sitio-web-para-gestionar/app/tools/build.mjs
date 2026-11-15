// Copia la fuente `site` a `dist` (lo que se publica) y deja también el sitio
// servible en la raíz de app/. No hay compilación: son ficheros estáticos tal
// cual, listos para servir con cualquier servidor web.
import { cp, mkdir, rm, readdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "site");
const out = join(root, "dist");

if (!existsSync(join(src, "index.html"))) {
  console.error("No encuentro site/index.html con el sitio.");
  process.exit(1);
}

// 1. La copia publicable.
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(src, out, { recursive: true });

// 2. El sitio en la raíz de app/ (index.html + assets/), para poder servirlo
//    directamente desde ahí sin depender del paso de copia.
await copyFile(join(src, "index.html"), join(root, "index.html"));
await rm(join(root, "assets"), { recursive: true, force: true });
await cp(join(src, "assets"), join(root, "assets"), { recursive: true });

const entries = await readdir(out);
console.log("Sitio copiado a dist/ y a la raíz de app/:", entries.join(", "));
