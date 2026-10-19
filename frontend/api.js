const defaultBase = "http://localhost:3000/api/v1";
const configuredBase = document.querySelector('meta[name="api-base"]')?.content;
const API_BASE = (configuredBase || defaultBase).replace(/\/$/, "");
const SESSION_KEY = "hydrojimma.session";

let session = readSession();

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(next) {
  session = next;
  if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  else sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event("hydro:session"));
}

export function getSession() {
  return session;
}

export function clearSession() {
  saveSession(null);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const rawMessage = payload?.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join(". ")
      : typeof rawMessage === "string"
        ? rawMessage
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload;
}

async function refreshSession() {
  if (!session?.refreshToken) return false;
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    const next = await parseResponse(response);
    saveSession(next);
    return true;
  } catch {
    clearSession();
    return false;
  }
}

export async function request(path, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (session?.accessToken) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(
      "Cannot reach the HydroJimma API. Check that the backend is running.",
      0,
    );
  }
  if (
    response.status === 401 &&
    retry &&
    session?.refreshToken &&
    (await refreshSession())
  ) {
    return request(path, options, false);
  }
  return parseResponse(response);
}

export async function login(phone, password) {
  const next = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });
  saveSession(next);
  return next;
}

export async function register(displayName, phone, password) {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ displayName, phone, password }),
  });
}

export async function requestPhoneVerification(phone) {
  return request("/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ phone, purpose: "PHONE_VERIFICATION" }),
  });
}

export async function verifyPhone(challengeId, code) {
  const result = await request("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId, code, purpose: "PHONE_VERIFICATION" }),
  });
  if (result.tokens) saveSession(result.tokens);
  return result;
}

export async function logout() {
  const refreshToken = session?.refreshToken;
  try {
    if (refreshToken) {
      await request("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
    }
  } finally {
    clearSession();
  }
}

export async function uploadPhoto(file) {
  const signed = await request("/storage/uploads", {
    method: "POST",
    body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
  });

  if (signed.multipart) {
    const partSize = 5 * 1024 * 1024;
    const parts = [];
    try {
      for (const part of signed.multipart.parts) {
        const start = (part.partNumber - 1) * partSize;
        const response = await fetch(part.url, {
          method: "PUT",
          body: file.slice(start, start + partSize),
        });
        if (!response.ok)
          throw new ApiError("Photo upload failed.", response.status);
        const etag = response.headers.get("etag");
        if (!etag)
          throw new ApiError("Photo upload did not return an ETag.", 0);
        parts.push({ partNumber: part.partNumber, etag });
      }
      await request("/storage/uploads/complete", {
        method: "POST",
        body: JSON.stringify({
          objectKey: signed.objectKey,
          uploadId: signed.multipart.uploadId,
          parts,
        }),
      });
    } catch (error) {
      await request("/storage/uploads/abort", {
        method: "POST",
        body: JSON.stringify({
          objectKey: signed.objectKey,
          uploadId: signed.multipart.uploadId,
        }),
      }).catch(() => undefined);
      throw error;
    }
  } else {
    const response = await fetch(signed.uploadUrl, {
      method: signed.method,
      headers: signed.headers,
      body: file,
    });
    if (!response.ok)
      throw new ApiError("Photo upload failed.", response.status);
  }
  return signed.objectKey;
}
