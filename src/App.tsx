import { useClientPrincipal } from './auth/useClientPrincipal';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { IdentityBar } from './ui/IdentityBar';
import { Logo } from './ui/Logo';

/** Application shell. Step 0 only: a protected welcome page showing the signed-in identity. */
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
        <p className="empty">
          Aucune source de logs chargée pour le moment.
          <span className="cursor" aria-hidden="true" />
        </p>
      </main>
    </ErrorBoundary>
  );
}
