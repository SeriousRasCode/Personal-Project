export type Session = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    displayName: string;
    role: string;
    phone?: string;
    status?: string;
  };
};
export const SESSION_CHANGED = "hydrojimma:session-changed";
const base = "/api/v1";
function savedSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem("hydrojimma.session") || "null");
  } catch {
    return null;
  }
}
let session = savedSession();
let refreshing: Promise<boolean> | null = null;
export const getSession = () => session;
export function setSession(value: Session | null) {
  session = value;
  if (value)
    sessionStorage.setItem("hydrojimma.session", JSON.stringify(value));
  else sessionStorage.removeItem("hydrojimma.session");
  window.dispatchEvent(new Event(SESSION_CHANGED));
}
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
async function parse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      Array.isArray(data?.message)
        ? data.message.join(". ")
        : data?.message || `Request failed (${response.status})`,
    );
  return data;
}
function request(path: string, options: RequestInit, token?: string) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${base}${path}`, { ...options, headers });
}
async function refresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  const current = session;
  if (!current?.refreshToken) {
    if (current) setSession(null);
    return false;
  }
  refreshing = (async () => {
    try {
      const next = await parse(
        await request("/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        }),
      );
      if (session?.refreshToken !== current.refreshToken)
        return Boolean(session);
      setSession(next);
      return true;
    } catch (error) {
      if (error instanceof ApiError && [400, 401, 403].includes(error.status)) {
        if (session?.refreshToken === current.refreshToken) setSession(null);
        return false;
      }
      throw error;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = session?.accessToken;
  let response = await request(path, options, token);
  if (
    response.status === 401 &&
    token &&
    (!path.startsWith("/auth/") || path === "/auth/me")
  ) {
    const recovered =
      session?.accessToken !== token ? Boolean(session) : await refresh();
    if (recovered) {
      const retriedToken = session?.accessToken;
      response = await request(path, options, retriedToken);
      if (response.status === 401 && session?.accessToken === retriedToken)
        setSession(null);
    }
  }
  return parse(response);
}
export const apiWithRefresh = api;
export async function signIn(phone: string, password: string) {
  const next = await api<Session>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });
  setSession(next);
  return next;
}
export async function register(
  displayName: string,
  phone: string,
  password: string,
) {
  return api<{ user: unknown }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ displayName, phone, password }),
  });
}
export async function requestOtp(phone: string) {
  return api<{ challengeId: string }>("/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ phone, purpose: "PHONE_VERIFICATION" }),
  });
}
export async function verifyOtp(challengeId: string, code: string) {
  const result = await api<{ tokens?: Session }>("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId, code, purpose: "PHONE_VERIFICATION" }),
  });
  if (result.tokens) setSession(result.tokens);
  return result;
}
export async function signOut() {
  const token = session?.refreshToken;
  setSession(null);
  if (token)
    await api("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken: token }),
    }).catch(() => undefined);
}
