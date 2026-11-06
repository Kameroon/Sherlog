import type { PrincipalState } from '../auth/clientPrincipal';

interface IdentityBarProps {
  state: PrincipalState;
}

// `aad` is the platform name of the Microsoft provider.
const PROVIDER_LABELS: Record<string, string> = { github: 'GitHub', aad: 'Microsoft' };

// After signing out, land on the public login page: the root would answer with a 401 redirect anyway.
const SIGN_OUT_HREF = '/.auth/logout?post_logout_redirect_uri=/login/';

/**
 * Shows who is signed in. Display only: access is enforced by the platform routes.
 *
 * Every state is explicit (loading, authenticated, anonymous, unavailable) so the user is never left guessing.
 */
export function IdentityBar({ state }: IdentityBarProps) {
  switch (state.status) {
    case 'loading':
      return <p role="status">Vérification de l’identité…</p>;
    case 'authenticated': {
      const { identityProvider, userDetails } = state.principal;
      return (
        <p className="identity">
          <span className="identity-name">{userDetails}</span>
          <span className="identity-provider"> via {PROVIDER_LABELS[identityProvider] ?? identityProvider}</span>
          <a href={SIGN_OUT_HREF}>Se déconnecter</a>
        </p>
      );
    }
    case 'anonymous':
      return (
        <p className="identity">
          Non connecté. <a href="/login/">Se connecter</a>
        </p>
      );
    case 'unavailable':
      return <p role="alert">Identité indisponible : {state.reason}</p>;
  }
}
