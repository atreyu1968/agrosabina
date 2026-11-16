const API = {
  status: "/api/auth/status",
  setup: "/api/auth/setup",
  login: "/api/auth/login",
  requestPassword: "/api/auth/password/request",
  resetPassword: "/api/auth/password/reset",
};

const stylesheetUrl = new URL("../auth-screen.css", import.meta.url).href;
const logoUrl = new URL("../img/agrosabina.png", import.meta.url).href;

function ensureStylesheet() {
  if (document.querySelector('link[data-agrosabina-auth-styles]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = stylesheetUrl;
  link.dataset.agrosabinaAuthStyles = "";
  document.head.append(link);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload.message || payload.error || "No se ha podido completar la operación. Inténtalo de nuevo.";
    throw new Error(message);
  }
  return payload;
}

function getResetToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get("reset") || params.get("token") || "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function mountAuthScreen(root, onAuthenticated) {
  if (!(root instanceof Element)) throw new TypeError("Se necesita un elemento raíz para mostrar el acceso.");
  ensureStylesheet();

  let state = "loading";
  let busy = false;
  let errorMessage = "";
  let successMessage = "";
  let setupRequired = false;
  let setupTokenRequired = false;
  let setupTokenConfigured = true;
  const resetToken = getResetToken();
  let disposed = false;

  const render = () => {
    if (disposed) return;
    if (state === "loading") {
      root.innerHTML = `
        <section class="ag-auth ag-auth-loading" aria-label="Comprobando acceso">
          <div class="ag-auth-loading-mark" aria-hidden="true"></div>
          <p>Comprobando el acceso seguro…</p>
        </section>`;
      return;
    }

    const isSetup = state === "setup";
    const isLogin = state === "login";
    const isRequest = state === "request-reset";
    const isReset = state === "reset-password";
    const title = isSetup ? "Prepara tu acceso" : isLogin ? "Bienvenido de nuevo" : isRequest ? "Recupera tu acceso" : "Elige una contraseña nueva";
    const subtitle = isSetup
      ? "Crea la cuenta de administración para empezar a llevar las cuentas."
      : isLogin
        ? "Accede a la gestión de Agrosabina SL."
        : isRequest
          ? "Te enviaremos las instrucciones al correo asociado a tu cuenta."
          : "La nueva contraseña protegerá tu cuenta de Agrosabina.";
    const fields = isSetup
      ? `<div class="ag-field"><label for="ag-name">Nombre</label><input id="ag-name" name="name" type="text" autocomplete="name" required maxlength="120" placeholder="Tu nombre"></div>
         <div class="ag-field"><label for="ag-email">Correo electrónico</label><input id="ag-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="nombre@empresa.es"></div>
         ${setupTokenRequired ? `<div class="ag-field"><label for="ag-setup-token">Código de instalación</label><input id="ag-setup-token" name="setupToken" type="password" autocomplete="off" required maxlength="200" placeholder="Código mostrado al instalar Agrosabina"></div>` : ""}
         <div class="ag-field"><label for="ag-password">Contraseña</label><input id="ag-password" name="password" type="password" autocomplete="new-password" required minlength="12" aria-describedby="ag-password-hint" placeholder="Al menos 12 caracteres"><small id="ag-password-hint">Usa al menos 12 caracteres.</small></div>`
      : isLogin
        ? `<div class="ag-field"><label for="ag-email">Correo electrónico</label><input id="ag-email" name="email" type="email" autocomplete="username" required maxlength="254" placeholder="nombre@empresa.es"></div>
           <div class="ag-field"><label for="ag-password">Contraseña</label><input id="ag-password" name="password" type="password" autocomplete="current-password" required placeholder="Tu contraseña"></div>`
        : isRequest
          ? `<div class="ag-field"><label for="ag-email">Correo electrónico</label><input id="ag-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="nombre@empresa.es"></div>`
          : `<div class="ag-field"><label for="ag-password">Nueva contraseña</label><input id="ag-password" name="password" type="password" autocomplete="new-password" required minlength="12" aria-describedby="ag-password-hint" placeholder="Al menos 12 caracteres"><small id="ag-password-hint">Usa al menos 12 caracteres.</small></div>`;

    root.innerHTML = `
      <main class="ag-auth" aria-labelledby="ag-auth-title">
        <section class="ag-auth-card">
          <aside class="ag-auth-aside" aria-label="Agrosabina">
            <a class="ag-auth-logo" href="#" aria-label="Agrosabina SL">
              <img src="${logoUrl}" alt="Agrosabina SL" width="429" height="179">
            </a>
            <div class="ag-auth-story">
              <span class="ag-auth-kicker">Gestión agrícola · Canarias</span>
              <p class="ag-auth-quote">Las cuentas claras,<br>la cosecha en buenas manos.</p>
              <div class="ag-auth-land" aria-hidden="true">
                <span class="ag-row ag-row-one"></span><span class="ag-row ag-row-two"></span><span class="ag-row ag-row-three"></span>
                <span class="ag-sun"></span>
              </div>
              <p class="ag-auth-aside-foot">Agrosabina SL <span>·</span> Gestión e IGIC</p>
            </div>
          </aside>
          <section class="ag-auth-content">
            <div class="ag-auth-mobile-brand"><img src="${logoUrl}" alt="Agrosabina SL" width="429" height="179"></div>
            <div class="ag-auth-heading">
              <span class="ag-auth-eyebrow">${isSetup ? "Primer acceso" : isLogin ? "Área privada" : isRequest ? "Ayuda para acceder" : "Seguridad de la cuenta"}</span>
              <h1 id="ag-auth-title">${title}</h1>
              <p>${subtitle}</p>
            </div>
            ${successMessage ? `<div class="ag-auth-notice ag-auth-notice-success" role="status" tabindex="-1">${escapeHtml(successMessage)}</div>` : ""}
            ${errorMessage ? `<div class="ag-auth-notice ag-auth-notice-error" role="alert" tabindex="-1">${escapeHtml(errorMessage)}</div>` : ""}
            ${successMessage && isRequest ? `<button class="ag-auth-button ag-auth-button-secondary" type="button" data-action="back-login">Volver al acceso</button>` : `
              <form class="ag-auth-form" novalidate>
                ${isReset ? `<input type="hidden" name="token" value="">` : ""}
                ${fields}
                <button class="ag-auth-button" type="submit" ${busy ? "disabled" : ""}>
                  ${busy ? `<span class="ag-auth-button-label"><span class="ag-auth-spinner" aria-hidden="true"></span>${isSetup ? "Creando acceso…" : isLogin ? "Entrando…" : isRequest ? "Enviando…" : "Guardando…"}</span>` : isSetup ? "Crear acceso" : isLogin ? "Entrar" : isRequest ? "Enviar instrucciones" : "Guardar contraseña"}
                  ${!busy ? `<span aria-hidden="true">→</span>` : ""}
                </button>
              </form>
            `}
            ${!successMessage || !isRequest ? `
              <div class="ag-auth-foot">
                ${isSetup ? `<span>Acceso privado para el equipo de Agrosabina.</span>` : isLogin ? `<button type="button" class="ag-auth-text-button" data-action="request-reset">¿Has olvidado tu contraseña?</button>` : isRequest || isReset ? `<button type="button" class="ag-auth-text-button" data-action="back-login">Volver al acceso</button>` : ""}
              </div>` : ""}
            <p class="ag-auth-privacy"><span aria-hidden="true" class="ag-auth-lock">⌑</span> Acceso protegido a la información de tu negocio</p>
          </section>
        </section>
        <footer class="ag-auth-footer">Agrosabina SL <span>·</span> Administración agrícola</footer>
      </main>`;

    const tokenInput = root.querySelector('input[name="token"]');
    if (tokenInput) tokenInput.value = resetToken;
  };

  const submit = async (form) => {
    if (busy) return;
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    let authenticated = false;
    errorMessage = "";
    successMessage = "";
    busy = true;
    render();
    try {
      if (state === "setup") {
        const result = await request(API.setup, { method: "POST", body: JSON.stringify({ name: data.name.trim(), email: data.email.trim(), password: data.password, setupToken: data.setupToken || "" }) });
        authenticated = true;
        if (typeof onAuthenticated === "function") onAuthenticated(result.user);
        return;
      }
      if (state === "login") {
        const result = await request(API.login, { method: "POST", body: JSON.stringify({ email: data.email.trim(), password: data.password }) });
        authenticated = true;
        if (typeof onAuthenticated === "function") onAuthenticated(result.user);
        return;
      }
      if (state === "request-reset") {
        const result = await request(API.requestPassword, { method: "POST", body: JSON.stringify({ email: data.email.trim() }) });
        successMessage = typeof result.message === "string"
          ? result.message
          : typeof result.success === "string"
            ? result.success
            : "Si existe una cuenta con ese correo, recibirás instrucciones para recuperar el acceso.";
        return;
      }
      if (state === "reset-password") {
        await request(API.resetPassword, { method: "POST", body: JSON.stringify({ token: resetToken, password: data.password }) });
        state = "login";
        successMessage = "Contraseña actualizada. Ya puedes entrar con tu nueva contraseña.";
        return;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "No se ha podido completar la operación. Inténtalo de nuevo.";
    } finally {
      busy = false;
      if (!authenticated) render();
      if (!authenticated && !disposed) {
        const focusTarget = root.querySelector(".ag-auth-notice[role='alert'], .ag-auth-notice[role='status'], input");
        focusTarget?.focus?.();
      }
    }
  };

  const onSubmit = (event) => {
    if (!(event.target instanceof HTMLFormElement) || !event.target.matches(".ag-auth-form")) return;
    event.preventDefault();
    submit(event.target);
  };
  const onClick = (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !root.contains(button) || busy) return;
    if (button.dataset.action === "request-reset") {
      state = "request-reset";
      errorMessage = "";
      successMessage = "";
      render();
      root.querySelector("#ag-email")?.focus();
    }
    if (button.dataset.action === "back-login") {
      state = "login";
      errorMessage = "";
      successMessage = "";
      render();
      root.querySelector("#ag-email")?.focus();
    }
  };

  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);
  render();

  const token = resetToken;
  request(API.status)
    .then((result) => {
      if (disposed) return;
      if (result.authenticated) {
        if (typeof onAuthenticated === "function") onAuthenticated(result.user);
        return;
      }
      setupRequired = Boolean(result.setupRequired);
      setupTokenRequired = Boolean(result.setupTokenRequired);
      setupTokenConfigured = Boolean(result.setupTokenConfigured);
      if (setupRequired && setupTokenRequired && !setupTokenConfigured) {
        state = "status-error";
        errorMessage = "Falta configurar el código de instalación en el servidor.";
        renderStatusError();
        return;
      }
      if (token) {
        state = "reset-password";
        errorMessage = "";
      } else {
        state = setupRequired ? "setup" : "login";
      }
      render();
      root.querySelector("input")?.focus();
    })
    .catch((error) => {
      if (disposed) return;
      state = "status-error";
      errorMessage = error instanceof Error ? error.message : "No se ha podido comprobar el acceso.";
      root.innerHTML = `
        <main class="ag-auth">
          <section class="ag-auth-status-error" role="alert">
            <img src="${logoUrl}" alt="Agrosabina SL" width="429" height="179">
            <span class="ag-auth-eyebrow">Área privada</span>
            <h1>No se ha podido comprobar el acceso</h1>
            <p>${escapeHtml(errorMessage)}</p>
            <button type="button" class="ag-auth-button" data-action="retry-status">Intentar de nuevo <span aria-hidden="true">→</span></button>
          </section>
        </main>`;
    });

  const retryStatus = (event) => {
    if (event.target.closest('[data-action="retry-status"]')) {
      state = "loading";
      errorMessage = "";
      render();
      request(API.status).then((result) => {
        if (disposed) return;
        if (result.authenticated) {
          if (typeof onAuthenticated === "function") onAuthenticated(result.user);
          return;
        }
        setupRequired = Boolean(result.setupRequired);
        setupTokenRequired = Boolean(result.setupTokenRequired);
        setupTokenConfigured = Boolean(result.setupTokenConfigured);
        if (setupRequired && setupTokenRequired && !setupTokenConfigured) {
          state = "status-error";
          errorMessage = "Falta configurar el código de instalación en el servidor.";
          renderStatusError();
          return;
        }
        state = resetToken ? "reset-password" : setupRequired ? "setup" : "login";
        render();
        root.querySelector("input")?.focus();
      }).catch((error) => {
        if (disposed) return;
        state = "status-error";
        errorMessage = error instanceof Error ? error.message : "No se ha podido comprobar el acceso.";
        renderStatusError();
      });
    }
  };
  const renderStatusError = () => {
    root.innerHTML = `
      <main class="ag-auth">
        <section class="ag-auth-status-error" role="alert">
          <img src="${logoUrl}" alt="Agrosabina SL" width="429" height="179">
          <span class="ag-auth-eyebrow">Área privada</span>
          <h1>No se ha podido comprobar el acceso</h1>
          <p>${escapeHtml(errorMessage)}</p>
          <button type="button" class="ag-auth-button" data-action="retry-status">Intentar de nuevo <span aria-hidden="true">→</span></button>
        </section>
      </main>`;
  };
  root.addEventListener("click", retryStatus);

  return () => {
    disposed = true;
    root.removeEventListener("submit", onSubmit);
    root.removeEventListener("click", onClick);
    root.removeEventListener("click", retryStatus);
    root.replaceChildren();
  };
}
