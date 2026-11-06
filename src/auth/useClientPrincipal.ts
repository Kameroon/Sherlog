import { useEffect, useState } from 'react';
import { fetchClientPrincipal, type PrincipalState } from './clientPrincipal';

/** Loads the platform identity once, when the component mounts. */
export function useClientPrincipal(): PrincipalState {
  const [state, setState] = useState<PrincipalState>({ status: 'loading' });

  useEffect(() => {
    let isCancelled = false;
    void fetchClientPrincipal().then((settled) => {
      // Avoids updating state after unmount (React strict mode mounts effects twice in development).
      if (!isCancelled) {
        setState(settled);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  return state;
}
