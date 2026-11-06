import type { PrincipalState } from '../auth/clientPrincipal';

interface IdentityBarProps {
  state: PrincipalState;
}

// `aad` is the platform name of the Microsoft provider.
const PROVIDER_LABELS: Record<string, string> = { github: 'GitHub', aad: 'Microsoft' };

// After signing out, land on the public login page: the root would answer with a 401 redirect anyway.
const SIGN_OUT_HREF = '/.auth/logout?post_logout_redirect_uri=/login/';

/**
 * First letter of the name, shown instead of the account photo: the Content-Security-Policy allows no external image.
 * `Array.from` splits by code point so an emoji or an accented capital is not cut in half.
 */
function initialOf(name: string): string | undefined {
  return Array.from(name.trim())[0]?.toUpperCase();
}

/**
 * Shows who is signed in. Display only: access is enforced by the platform routes.
 *
 * Every state is explicit (loading, authenticated, anonymous, unavailable) so the user is never left guessing.
 */
export function IdentityBar({ state }: IdentityBarProps) {
  switch (state.status) {
    case 'loading':
      return (
        <p className="identity-message" role="status">
          Vérification de l’identité…
        </p>
      );
    case 'authenticated': {
      const { identityProvider, userDetails } = state.principal;
      const initial = initialOf(userDetails);
      return (
        <div className="identity">
          {initial !== undefined && (
            <span className="avatar" aria-hidden="true">
              {initial}
            </span>
          )}
          <p className="identity-text">
            <span>{userDetails}</span>
            <span className="identity-provider">via {PROVIDER_LABELS[identityProvider] ?? identityProvider}</span>
          </p>
          <a className="signout" href={SIGN_OUT_HREF}>
            Se déconnecter
          </a>
        </div>
      );
    }
    case 'anonymous':
      return (
        <p className="identity-message">
          Non connecté. <a href="/login/">Se connecter</a>
        </p>
      );
    case 'unavailable':
      return (
        <p className="identity-message" role="alert">
          Identité indisponible : {state.reason}
        </p>
      );
  }
}
