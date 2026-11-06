import { useClientPrincipal } from './auth/useClientPrincipal';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { IdentityBar } from './ui/IdentityBar';

/** Application shell. Step 0 only: a protected empty page showing the signed-in identity. */
export function App() {
  const principalState = useClientPrincipal();

  return (
    <ErrorBoundary>
      <header className="app-header">
        <h1>Sherlog</h1>
        <IdentityBar state={principalState} />
      </header>
      <main className="app-main">
        <p>Aucune source de logs chargée pour le moment.</p>
      </main>
    </ErrorBoundary>
  );
}
