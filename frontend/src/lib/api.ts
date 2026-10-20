export type Session = { accessToken: string; refreshToken: string; user: { id: string; displayName: string; role: string; phone?: string } };
const base = '/api/v1';
let session: Session | null = JSON.parse(sessionStorage.getItem('hydrojimma.session') || 'null');
export const getSession = () => session;
export function setSession(value: Session | null) { session = value; if (value) sessionStorage.setItem('hydrojimma.session', JSON.stringify(value)); else sessionStorage.removeItem('hydrojimma.session'); }
async function parse(response: Response) { const data = await response.json().catch(() => null); if (!response.ok) throw new Error(Array.isArray(data?.message) ? data.message.join('. ') : data?.message || `Request failed (${response.status})`); return data; }
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> { const headers = new Headers(options.headers); if (options.body) headers.set('Content-Type', 'application/json'); if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`); return parse(await fetch(`${base}${path}`, { ...options, headers })); }
export async function signIn(phone: string, password: string) { const next = await api<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }) }); setSession(next); return next; }
export async function signOut() { if (session?.refreshToken) await api('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken }) }).catch(() => undefined); setSession(null); }
