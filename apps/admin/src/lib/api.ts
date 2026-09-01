export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) as T & { error?: { code: string; message: string } } : ({} as T);
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string } }).error;
    if (res.status === 401 && typeof window !== 'undefined' && !path.includes('/auth/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? res.statusText);
  }
  return data;
}

/** Build a query string, dropping empty/undefined values so URLs stay short and shareable. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * The API answers 403 `forbidden` with a "Step-up TOTP required" message when a
 * privileged mutation is attempted outside the 5-minute re-auth window.
 */
export function isStepUpRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && /step-up/i.test(err.message);
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** Exchange a fresh TOTP code for a session cookie carrying `last_reauth_at`. */
export async function stepUp(totp: string): Promise<void> {
  await api('/admin/auth/step-up', { method: 'POST', body: JSON.stringify({ totp }) });
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}
