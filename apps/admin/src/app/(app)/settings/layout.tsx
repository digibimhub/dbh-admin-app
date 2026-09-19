'use client';

import type { ReactNode } from 'react';
import { useCan } from '@/lib/session';
import { Tabs } from '@/components/AppShell';
import { PageHeader } from '@/components/ui';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const canPortalUsers = useCan('portal_user.manage');
  const canRoles = useCan('role.manage');

  // Tabs a role cannot use are absent, not disabled. Panels is read-only for
  // everyone and gated per control inside.
  const tabs = [
    ...(canRoles ? [{ href: '/settings/roles', label: 'Roles' }] : []),
    { href: '/settings/panels', label: 'Panels' },
    ...(canPortalUsers ? [{ href: '/settings/portal-users', label: 'Portal users' }] : []),
    { href: '/settings/audit', label: 'Audit log' },
  ];

  return (
    <div>
      <PageHeader title="Settings" />
      <Tabs items={tabs} />
      {children}
    </div>
  );
}
