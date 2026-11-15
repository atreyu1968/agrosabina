/*
 * La cámara del dispositivo.
 *
 * Abre una ventana a pantalla completa con lo que ve la cámara, un botón para
 * hacer la foto y otro para terminar. Se pueden hacer varias fotos seguidas
 * (una factura de dos hojas, por ejemplo) y luego se le pasan todas a la cola
 * de lectura.
 *
 * Si el navegador no deja usar la cámara (sin permiso, sin cámara, o la página
 * no va por https), se lanza un error con un mensaje en castellano y quien
 * llama decide qué hacer: en views.js se ofrece el selector de archivos, que en
 * un móvil también abre la cámara.
 */

const MAX_SHOTS = 12;

export function cameraSupported() {
  return !!(
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

function mapError(err) {
  const name = (err && err.name) || "";
  const out = new Error("No he podido abrir la cámara.");
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    out.code = "denied";
    out.message =
      "No me has dado permiso para usar la cámara. Puedes permitirlo en el candado de la barra de direcciones, o elegir una foto del carrete.";
  } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    out.code = "unavailable";
    out.message = "No encuentro ninguna cámara en este dispositivo. Elige una foto o un PDF.";
  } else if (name === "NotReadableError" || name === "TrackStartError") {
    out.code = "busy";
    out.message =
      "La cámara está ocupada por otra aplicación. Cierra esa aplicación y vuelve a intentarlo.";
  } else if (name === "OverconstrainedError") {
    out.code = "unavailable";
    out.message = "La cámara no acepta la configuración que le pido. Prueba con el selector de fotos.";
  }
  return out;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function shoot(video) {
  const w = video.videoWidth || 0;
  const h = video.videoHeight || 0;
  if (!w || !h) throw new Error("La cámara todavía no está lista. Espera un segundo y vuelve a pulsar.");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("No he podido guardar la foto."));
        resolve(new File([blob], `foto-${stamp()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  });
}

/**
 * Abre la cámara. Devuelve una promesa con la lista de fotos (File[]).
 * Se resuelve con [] si se cierra sin hacer ninguna.
 */
export function openCamera() {
  return new Promise((resolve, reject) => {
    if (!cameraSupported()) {
      const err = new Error(
        "Este navegador no puede abrir la cámara desde la página. Usa el botón de archivos: en el móvil también te deja hacer la foto."
      );
      err.code = "unsupported";
      reject(err);
      return;
    }

    // Fuera de https (o de localhost) el navegador no deja usar la cámara.
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      const err = new Error(
        "La cámara solo funciona si la página se abre con https:// o en el propio ordenador (localhost). Con el botón de archivos puedes elegir la foto, y en el móvil te deja hacerla igual."
      );
      err.code = "insecure";
      reject(err);
      return;
    }

    const photos = [];
    let stream = null;
    let facing = "environment";
    let deviceId = null;
    let done = false;

    const overlay = document.createElement("div");
    overlay.className = "camera-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Hacer una foto de la factura");
    overlay.innerHTML = `
      <div class="camera-head">
        <div>
          <strong>Hacer una foto</strong>
          <span>Que salga la factura entera y con buena luz</span>
        </div>
        <button class="icon-btn cam-close" type="button" aria-label="Cerrar la cámara">✕</button>
      </div>
      <div class="camera-stage">
        <video playsinline autoplay muted></video>
        <div class="camera-flash" aria-hidden="true"></div>
        <p class="camera-error" hidden></p>
      </div>
      <div class="camera-strip" aria-live="polite"></div>
      <div class="camera-foot">
        <button class="btn ghost cam-flip" type="button">Cambiar cámara</button>
        <button class="btn primary cam-shoot" type="button">Hacer foto</button>
        <button class="btn cam-done" type="button" disabled>Listo (0)</button>
      </div>`;

    const video = overlay.querySelector("video");
    const errorBox = overlay.querySelector(".camera-error");
    const flash = overlay.querySelector(".camera-flash");
    const strip = overlay.querySelector(".camera-strip");
    const shootBtn = overlay.querySelector(".cam-shoot");
    const doneBtn = overlay.querySelector(".cam-done");
    const flipBtn = overlay.querySelector(".cam-flip");

    function showError(message) {
      errorBox.hidden = false;
      errorBox.textContent = message;
      shootBtn.disabled = true;
    }

    function stopStream() {
      if (stream) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch (_) {
            /* nada */
          }
        }
        stream = null;
      }
      video.srcObject = null;
    }

    function finish(result) {
      if (done) return;
      done = true;
      stopStream();
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      if (result) resolve(result);
    }

    function paintStrip() {
      strip.innerHTML = photos
        .map(
          (file, i) =>
            `<figure class="camera-shot"><img src="${URL.createObjectURL(file)}" alt="Foto ${i + 1}"><figcaption>${i + 1}</figcaption></figure>`
        )
        .join("");
      doneBtn.textContent = `Listo (${photos.length})`;
      doneBtn.disabled = photos.length === 0;
    }

    function onKey(ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(photos.slice());
      }
    }

    async function start() {
      stopStream();
      shootBtn.disabled = true;
      errorBox.hidden = true;
      const constraints = {
        audio: false,
        video: {
          width: { ideal: 2560 },
          height: { ideal: 1440 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } }),
        },
      };
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        // Segundo intento sin exigencias: algunos móviles rechazan la resolución.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (err2) {
          const mapped = mapError(err2 || err);
          showError(mapped.message);
          return;
        }
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch (_) {
        /* el navegador lo intentará solo */
      }
      shootBtn.disabled = false;

      // ¿Hay más de una cámara? Entonces tiene sentido el botón de cambiar.
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        flipBtn.hidden = cams.length < 2;
        const track = stream.getVideoTracks()[0];
        const settings = track && track.getSettings ? track.getSettings() : {};
        if (settings.deviceId) deviceId = null; // ya lo tenemos; no lo fijamos al principio
      } catch (_) {
        flipBtn.hidden = true;
      }
    }

    shootBtn.addEventListener("click", async () => {
      if (shootBtn.disabled) return;
      shootBtn.disabled = true;
      try {
        const file = await shoot(video);
        photos.push(file);
        flash.classList.remove("on");
        void flash.offsetWidth; // reinicia la animación
        flash.classList.add("on");
        paintStrip();
        if (photos.length >= MAX_SHOTS) {
          finish(photos.slice());
          return;
        }
      } catch (err) {
        showError((err && err.message) || "No he podido hacer la foto.");
      } finally {
        if (!done) shootBtn.disabled = false;
      }
    });

    doneBtn.addEventListener("click", () => finish(photos.slice()));
    overlay.querySelector(".cam-close").addEventListener("click", () => finish(photos.slice()));

    flipBtn.addEventListener("click", async () => {
      facing = facing === "environment" ? "user" : "environment";
      deviceId = null;
      await start();
    });

    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    paintStrip();
    start().catch((err) => {
      if (!done) {
        const mapped = mapError(err);
        showError(mapped.message);
      }
    });
  });
}
