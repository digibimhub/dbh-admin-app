import { redirect } from 'next/navigation';

/** Roles are the first thing to configure, and the screen most often wanted. */
export default function SettingsIndex() {
  redirect('/settings/roles');
}
