// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PrincipalState } from '../src/auth/clientPrincipal';
import { storageScopeOf } from '../src/auth/storageScope';

const authenticated = (identityProvider: string, userId: string): PrincipalState => ({
  status: 'authenticated',
  principal: { identityProvider, userId, userDetails: 'someone', userRoles: ['authenticated', 'invited'] },
});

describe('storageScopeOf', () => {
  it('should wait while the identity is being read', () => {
    // Act & Assert
    expect(storageScopeOf({ status: 'loading' })).toBeNull();
  });

  it('should name the scope after the provider and the id of the signed-in user, so that it is theirs alone', () => {
    // Act & Assert
    expect(storageScopeOf(authenticated('github', 'abc123'))).toEqual({ name: 'github/abc123', identified: true });
  });

  it('should give two users of the same provider two scopes', () => {
    // Act
    const first = storageScopeOf(authenticated('github', 'one'));
    const second = storageScopeOf(authenticated('github', 'two'));

    // Assert
    expect(first?.name).not.toBe(second?.name);
  });

  it('should give one user of two providers two scopes', () => {
    // Act
    const github = storageScopeOf(authenticated('github', 'same'));
    const microsoft = storageScopeOf(authenticated('aad', 'same'));

    // Assert
    expect(github?.name).not.toBe(microsoft?.name);
  });

  it.each([
    ['anonymous', { status: 'anonymous' } as const],
    ['unavailable', { status: 'unavailable', reason: 'down' } as const],
  ])('should not tell users apart when the identity is %s', (_name, state) => {
    // Act
    const scope = storageScopeOf(state);

    // Assert
    expect(scope?.identified).toBe(false);
  });
});
