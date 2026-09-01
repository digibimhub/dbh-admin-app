'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { can, type Capability } from './permissions';
import type { SessionUser } from './types';

type SessionState = {
  user: SessionUser | null;
  loading: boolean;
};

const SessionContext = createContext<SessionState>({ user: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ user: null, loading: true });

  useEffect(() => {
    let live = true;
    api<{ user: SessionUser }>('/admin/auth/me')
      .then((d) => { if (live) setState({ user: d.user, loading: false }); })
      .catch(() => { if (live) setState({ user: null, loading: false }); });
    return () => { live = false; };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

/**
 * `useCan('license.manage')` — false while the session is still loading, so
 * privileged controls never flash into view before the role is known.
 */
export function useCan(capability: Capability): boolean {
  const { user } = useSession();
  return can(user?.role, capability);
}

/** Render children only when the role allows it. Hidden, not disabled. */
export function Can({ do: capability, children }: { do: Capability; children: ReactNode }) {
  return useCan(capability) ? <>{children}</> : null;
}
