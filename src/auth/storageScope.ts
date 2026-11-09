import type { PrincipalState } from './clientPrincipal';

/** Whose data a browser storage holds: the name goes into every key written, so that identities never share one. */
export interface StorageScope {
  readonly name: string;
  /** `false` when the user could not be told from another: nothing may then be kept for a later visit. */
  readonly identified: boolean;
}

/**
 * The scope of the signed-in user, `null` while the identity is still being read. Without an identity (the endpoint is
 * down, or the app runs outside Static Web Apps) a shared scope is used, and says so: what is kept there must not
 * outlive the tab, since another user of the same browser would read it.
 */
export function storageScopeOf(state: PrincipalState): StorageScope | null {
  switch (state.status) {
    case 'loading':
      return null;
    case 'authenticated':
      return { name: `${state.principal.identityProvider}/${state.principal.userId}`, identified: true };
    case 'anonymous':
    case 'unavailable':
      return { name: 'sans-identite', identified: false };
  }
}
