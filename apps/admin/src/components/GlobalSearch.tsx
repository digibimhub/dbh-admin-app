'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Scope } from '@/lib/session';

/**
 * The search box in the black bar. Enter sends the query to the list that can
 * answer it: an address or a name with a space is a person, anything else is
 * an organisation. An organisation admin only has members to search.
 */
export function GlobalSearch({ scope }: { scope: Scope }) {
  const router = useRouter();
  const [q, setQ] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    const enc = encodeURIComponent(query);
    if (scope.kind === 'org') router.push(`/org/members?q=${enc}`);
    else if (query.includes('@') || /\s/.test(query)) router.push(`/users?q=${enc}`);
    else router.push(`/orgs?q=${enc}`);
    setQ('');
  }

  return (
    <form
      role="search"
      onSubmit={submit}
      className="hidden md:flex items-center gap-2 h-9 w-[360px] max-w-[30vw] px-3 rounded-sm bg-nav-active text-card/70"
    >
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search"
        placeholder={scope.kind === 'org' ? 'Search members' : 'Search organisations and people'}
        className="flex-1 min-w-0 bg-transparent border-0 outline-none text-small text-card placeholder:text-card/60 focus:outline-none"
      />
    </form>
  );
}
