const API_PREFIX = "/api";

export async function sharedRequest(path, options = {}) {
  const response = await fetch(`${API_PREFIX}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : options.body instanceof Blob ? {} : options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("agrosabina:session-expired"));
  }
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || `La solicitud falló (HTTP ${response.status}).`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function sharedFileRequest(id, options = {}) {
  const response = await fetch(`${API_PREFIX}/files/${encodeURIComponent(id)}`, {
    credentials: "include",
    ...options,
    headers: options.headers,
  });
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("agrosabina:session-expired"));
  }
  if (!response.ok) {
    let message = `No se pudo leer el original (HTTP ${response.status}).`;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {}
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response;
}
