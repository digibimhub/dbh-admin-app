'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { OrgDetail } from '@/lib/types';

type OrgContextValue = { detail: OrgDetail; reload: () => void };

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ value, children }: { value: OrgContextValue; children: ReactNode }) {
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

/** The org header is fetched once in the section layout; every tab reads it from here. */
export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used inside the organisation layout');
  return ctx;
}
