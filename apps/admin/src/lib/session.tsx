'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { can, type Capability } from './permissions';
import type { SessionExtras, SessionUser } from './types';
import { Loading } from '@/components/ui';

type SessionState = {
  user: SessionUser | null;
  loading: boolean;
};

const SessionContext = createContext<SessionState>({ user: null, loading: true });

/**
 * What `/admin/auth/me` answers. The scope fields were added beside `user`
 * rather than inside it in the plan's wording, and older builds return only
 * `user` — so both shapes are read and folded into one `SessionUser`.
 */
type MeResponse = { user: SessionUser } & Partial<SessionExtras>;

const EXTRAS: (keyof SessionExtras)[] = [
  'scope', 'orgId', 'orgName', 'orgStatus', 'joinPolicy', 'capabilities', 'mustChangePassword',
];

function fold(d: MeResponse): SessionUser {
  const user: SessionUser = { ...d.user };
  for (const k of EXTRAS) {
    if (d[k] !== undefined) (user as Record<string, unknown>)[k] = d[k];
  }
  if (!user.scope) user.scope = user.role === 'org_admin' ? 'org' : 'global';
  return user;
}

/**
 * Everything inside the provider assumes a session. Until `/admin/auth/me`
 * answers, nothing renders; if it answers with no user, the visitor is sent to
 * /login instead of being shown an app shell whose every fetch would 401.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SessionState>({ user: null, loading: true });

  useEffect(() => {
    let live = true;
    api<MeResponse>('/admin/auth/me')
      .then((d) => { if (live) setState({ user: fold(d), loading: false }); })
      .catch(() => { if (live) setState({ user: null, loading: false }); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!state.loading && !state.user) router.replace('/login');
  }, [state.loading, state.user, router]);

  if (state.loading || !state.user) return <Loading what="Signing you in" />;

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

/**
 * `useCan('license.manage')` — false while the session is still loading, so
 * privileged controls never flash into view before the role is known.
 *
 * The server's `capabilities[]` wins when present; the local matrix is the
 * fallback for a session that predates it.
 */
export function useCan(capability: Capability): boolean {
  const { user } = useSession();
  if (!user) return false;
  if (Array.isArray(user.capabilities)) return user.capabilities.includes(capability);
  return can(user.role, capability);
}

/** Render children only when the role allows it. Hidden, not disabled. */
export function Can({ do: capability, children }: { do: Capability; children: ReactNode }) {
  return useCan(capability) ? <>{children}</> : null;
}

export type Scope =
  | { kind: 'global' }
  | { kind: 'org'; orgId: string; orgName: string };

/**
 * Which persona is signed in. An organisation admin sees one organisation
 * under `/org/*`; everyone else sees the whole estate.
 */
export function useScope(): Scope {
  const { user } = useSession();
  const org = Boolean(user && (user.scope === 'org' || user.role === 'org_admin') && user.orgId);
  const orgId = user?.orgId ?? null;
  const orgName = user?.orgName ?? null;
  // Memoised, so effects keyed on the scope run once per session rather than
  // once per render — the bell count is one request, not one per navigation.
  return useMemo<Scope>(
    () => (org && orgId ? { kind: 'org', orgId, orgName: orgName ?? 'Your organisation' } : { kind: 'global' }),
    [org, orgId, orgName],
  );
}
