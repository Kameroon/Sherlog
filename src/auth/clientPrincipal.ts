/** Identity of the signed-in user, as exposed by the Azure Static Web Apps `/.auth/me` endpoint. */
export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  readonly userRoles: readonly string[];
}

/** Outcome of reading the platform identity; `unavailable` always carries a user-facing reason. */
export type PrincipalState =
  | { status: 'loading' }
  | { status: 'authenticated'; principal: ClientPrincipal }
  | { status: 'anonymous' }
  | { status: 'unavailable'; reason: string };

export type SettledPrincipalState = Exclude<PrincipalState, { status: 'loading' }>;

const IDENTITY_ENDPOINT = '/.auth/me';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isClientPrincipal(value: unknown): value is ClientPrincipal {
  return (
    isRecord(value) &&
    typeof value['identityProvider'] === 'string' &&
    typeof value['userId'] === 'string' &&
    typeof value['userDetails'] === 'string' &&
    Array.isArray(value['userRoles']) &&
    value['userRoles'].every((role) => typeof role === 'string')
  );
}

/**
 * Reads the identity of the current user from the platform endpoint.
 *
 * Never throws: every failure becomes an `unavailable` state with a reason, so the UI can say
 * why the identity is missing instead of silently showing nothing. The identity is display-only;
 * access control is enforced by the platform routes, never by this value.
 *
 * @param fetchImpl - Injected so tests do not depend on a global stub.
 * @returns `authenticated`, `anonymous` (endpoint answers `null`) or `unavailable`.
 */
export async function fetchClientPrincipal(fetchImpl: typeof fetch = fetch): Promise<SettledPrincipalState> {
  let response: Response;
  try {
    response = await fetchImpl(IDENTITY_ENDPOINT, { credentials: 'same-origin' });
  } catch {
    return { status: 'unavailable', reason: 'le point de terminaison d’identité est injoignable' };
  }

  if (!response.ok) {
    return { status: 'unavailable', reason: `réponse HTTP ${response.status} du point de terminaison d’identité` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // Outside Azure Static Web Apps (e.g. `npm run dev`) the dev server answers with the HTML shell.
    return { status: 'unavailable', reason: 'réponse inattendue, application probablement hors Azure Static Web Apps' };
  }

  const clientPrincipal = isRecord(payload) ? payload['clientPrincipal'] : undefined;
  if (clientPrincipal === null) {
    return { status: 'anonymous' };
  }
  if (isClientPrincipal(clientPrincipal)) {
    return { status: 'authenticated', principal: clientPrincipal };
  }
  return { status: 'unavailable', reason: 'format d’identité inattendu' };
}
