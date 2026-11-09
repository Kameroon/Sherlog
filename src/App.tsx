import { storageScopeOf } from './auth/storageScope';
import { useClientPrincipal } from './auth/useClientPrincipal';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { IdentityBar } from './ui/IdentityBar';
import { LogWorkspace } from './ui/LogWorkspace';
import { Logo } from './ui/Logo';

/** Application shell: the signed-in identity and the working area where a log is chosen, analysed and read. */
export function App() {
  const principalState = useClientPrincipal();

  return (
    <ErrorBoundary>
      <header className="topbar">
        <Logo />
        <IdentityBar state={principalState} />
      </header>
      <main className="content">
        <section className="hero">
          <h1>
            Prêt à <span className="accent">enquêter</span>&nbsp;?
          </h1>
          <p>Sherlog isole les erreurs de vos journaux et vous explique chacune d’elles.</p>
        </section>
        <LogWorkspace storageScope={storageScopeOf(principalState)} />
      </main>
    </ErrorBoundary>
  );
}
