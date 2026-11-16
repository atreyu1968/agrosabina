/*
 * El correo: leer un mensaje guardado como fichero .eml.
 *
 * Un navegador no puede conectarse por su cuenta a un buzón IMAP/POP (el
 * propio navegador lo impide, por seguridad). Lo que sí puede hacer —y hace
 * esto— es leer los correos exportados desde cualquier programa de correo
 * (Outlook, Gmail, Thunderbird…): el .eml trae las cabeceras, el texto y los
 * adjuntos dentro, y de aquí salen las facturas y las liquidaciones.
 *
 * Todo ocurre en el navegador: el correo no se sube a ningún sitio.
 */

const TEXTUAL = /^text\//i;
const READABLE_ATTACHMENT = /^(application\/pdf|image\/)/i;

export function isEmailFile(file) {
  const name = String((file && file.name) || "").toLowerCase();
  const type = String((file && file.type) || "").toLowerCase();
  return name.endsWith(".eml") || name.endsWith(".emlx") || type === "message/rfc822";
}

/** Only attachment bytes are eligible for document import; never the mail body. */
export function emailDocumentFiles(message) {
  return (message?.attachments || []).flatMap((attachment, index) => {
    if (!attachment?.readable || !attachment.bytes?.length) return [];
    const name = String(attachment.name || `adjunto-${index + 1}.pdf`);
    if (!/\.(pdf|jpe?g|png|webp)$/i.test(name) &&
        !/^(application\/pdf|image\/(jpeg|png|webp))$/i.test(attachment.type || "")) return [];
    return [new File([attachment.bytes], name, { type: attachment.type || "application/pdf" })];
  });
}

/* ---------------- bytes y texto ---------------- */

function normCharset(cs) {
  const s = String(cs || "").trim().toLowerCase().replace(/^"|"$/g, "");
  if (!s) return "utf-8";
  if (s === "utf8") return "utf-8";
  if (s === "latin1" || s === "latin-1" || s === "iso8859-1") return "iso-8859-1";
  if (s === "windows1252" || s === "cp1252" || s === "ansi") return "windows-1252";
  return s;
}

function bytesToText(bytes, charset) {
  if (!bytes || !bytes.length) return "";
  const cs = normCharset(charset);
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch (_) {
    /* charset raro: se intenta UTF-8 */
  }
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch (_) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }
}

function b64Bytes(value) {
  const clean = String(value || "").replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean) return new Uint8Array(0);
  try {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (_) {
    return new Uint8Array(0);
  }
}

function qpBytes(value) {
  const s = String(value || "").replace(/=\r?\n/g, "");
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(s.charCodeAt(i) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** =?UTF-8?B?...?= y =?ISO-8859-1?Q?...?= de las cabeceras. */
export function decodeWords(value) {
  return String(value || "")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (all, charset, enc, data) => {
      try {
        if (/^b$/i.test(enc)) return bytesToText(b64Bytes(data), charset);
        return bytesToText(qpBytes(data.replace(/_/g, " ")), charset);
      } catch (_) {
        return all;
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------- partes MIME ---------------- */

function splitHeadersAndBody(raw) {
  const text = String(raw || "");
  const m = /\r?\n\r?\n/.exec(text);
  if (!m) return { head: text, body: "" };
  return { head: text.slice(0, m.index), body: text.slice(m.index + m[0].length) };
}

function parseHeaders(block) {
  const map = {};
  const unfolded = String(block || "").replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    map[key] = map[key] ? `${map[key]} ${value}` : value;
  }
  return map;
}

function headerParam(value, name) {
  const source = String(value || "");
  const star = new RegExp(`${name}\\*\\s*=\\s*([^']*)'[^']*'([^;]+)`, "i").exec(source);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim());
    } catch (_) {
      return decodeWords(star[2].trim());
    }
  }
  const plain = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(source);
  if (plain) return decodeWords(plain[1]);
  const bare = new RegExp(`${name}\\s*=\\s*([^;]+)`, "i").exec(source);
  return bare ? decodeWords(bare[1].trim()) : "";
}

function splitByBoundary(body, boundary) {
  const marker = `--${boundary}`;
  const parts = [];
  const chunks = String(body || "").split(marker);
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (/^--/.test(chunk)) break; // cierre final
    parts.push(chunk.replace(/^\r?\n/, ""));
  }
  return parts;
}

function mimeOf(ct) {
  return String(ct || "").split(";")[0].trim().toLowerCase();
}

function charsetOf(ct) {
  const m = /charset\s*=\s*"?([^";]+)"?/i.exec(String(ct || ""));
  return m ? m[1] : "utf-8";
}

function decodePart(headers, body) {
  const cte = String(headers["content-transfer-encoding"] || "").toLowerCase();
  if (/base64/.test(cte)) return b64Bytes(body);
  if (/quoted-printable/.test(cte)) return qpBytes(body);
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 32))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function walk(headers, body, ctx, depth = 0) {
  if (depth > 8) return;
  const ct = String(headers["content-type"] || "text/plain; charset=utf-8");

  if (/^multipart\//i.test(ct)) {
    const boundary = headerParam(ct, "boundary");
    if (!boundary) return;
    for (const part of splitByBoundary(body, boundary)) {
      const { head, body: content } = splitHeadersAndBody(part);
      walk(parseHeaders(head), content, ctx, depth + 1);
    }
    return;
  }

  const mime = mimeOf(ct) || "text/plain";
  const disposition = String(headers["content-disposition"] || "");
  const fileName = headerParam(disposition, "filename") || headerParam(ct, "name");
  const bytes = decodePart(headers, body);

  if (fileName) {
    ctx.attachments.push({
      name: fileName,
      type: mime,
      bytes,
      readable: READABLE_ATTACHMENT.test(mime) || /\.(pdf|jpe?g|png|webp|heic)$/i.test(fileName),
    });
    return;
  }

  if (TEXTUAL.test(mime)) {
    const text = bytesToText(bytes, charsetOf(ct));
    if (/html/.test(mime)) ctx.html.push(text);
    else ctx.text.push(text);
    return;
  }

  // Una imagen o un PDF sin nombre de fichero también sirve.
  if (READABLE_ATTACHMENT.test(mime) && bytes.length > 200) {
    ctx.attachments.push({
      name: `adjunto-${ctx.attachments.length + 1}.${/pdf/.test(mime) ? "pdf" : "jpg"}`,
      type: mime,
      bytes,
      readable: true,
    });
  }
}

/**
 * Lee un .eml completo.
 * @returns {{from:string, fromName:string, subject:string, date:string, text:string,
 *            attachments:Array<{name:string,type:string,bytes:Uint8Array,readable:boolean}>}}
 */
export function parseEml(raw, fileName = "") {
  const empty = { from: "", fromName: "", subject: "", date: "", text: "", attachments: [] };
  const source = String(raw || "");
  if (!source.trim()) return empty;

  const { head, body } = splitHeadersAndBody(source);
  const headers = parseHeaders(head);
  const ctx = { text: [], html: [], attachments: [] };
  walk(headers, body, ctx);

  const plain = ctx.text.join("\n\n").trim();
  const text = plain || htmlToText(ctx.html.join("\n"));

  return {
    from: decodeWords(headers.from || ""),
    fromName: decodeWords(headers.from || "").replace(/<[^>]*>/, "").replace(/"/g, "").trim(),
    subject: decodeWords(headers.subject || "") || fileName || "(sin asunto)",
    date: decodeWords(headers.date || ""),
    text,
    attachments: ctx.attachments,
  };
}

/** Un .eml que parece traer una factura o una liquidación. */
export function looksLikeInvoiceMail(msg) {
  const blob = `${msg.subject || ""} ${msg.text || ""}`.toLowerCase();
  return /factura|liquidaci[oó]n|subvenci[oó]n|abono|recibo|fra\./.test(blob);
}
