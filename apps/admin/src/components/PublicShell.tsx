import type { ReactNode } from 'react';

/**
 * The chrome outside a session: the black bar with the wordmark, and a
 * 400 px card. Sign in, authenticator enrolment and the first-login password
 * change all sit in it.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-nav text-card">
        <div className="mx-auto max-w-[1600px] h-14 px-[18px] lg:px-6 flex items-center">
          <span className="text-control font-extrabold whitespace-nowrap">
            DIGIBIM HUB
            <span className="font-normal text-card/70 ml-2">Licensing</span>
          </span>
        </div>
      </header>
      <main className="flex-1 flex justify-center items-start px-4 pt-12 pb-20">
        <div className="w-full max-w-[400px] bg-card border border-rule rounded-md p-9">{children}</div>
      </main>
    </div>
  );
}
