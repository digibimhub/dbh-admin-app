'use client';

import type { ReactNode } from 'react';
import { useCan } from '@/lib/session';
import { Tabs } from '@/components/AppShell';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const canPortalUsers = useCan('portal_user.manage');
  const canRoles = useCan('role.manage');
  const canPanels = useCan('panel.manage');

  // Tabs a role cannot use are absent, not disabled.
  const tabs = [
    ...(canRoles ? [{ href: '/settings/roles', label: 'Roles' }] : []),
    ...(canPanels ? [{ href: '/settings/panels', label: 'Scopes' }] : []),
    ...(canPortalUsers ? [{ href: '/settings/portal-users', label: 'Portal users' }] : []),
    { href: '/settings/audit', label: 'Audit log' },
  ];

  return (
    <div>
      <h2 className="font-semibold text-page leading-tight tracking-tight mb-4">Settings</h2>
      <Tabs items={tabs} />
      {children}
    </div>
  );
}
