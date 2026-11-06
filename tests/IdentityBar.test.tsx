import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PrincipalState } from '../src/auth/clientPrincipal';
import { IdentityBar } from '../src/ui/IdentityBar';

function authenticatedState(identityProvider: string, userDetails: string): PrincipalState {
  return {
    status: 'authenticated',
    principal: { identityProvider, userId: 'user-1', userDetails, userRoles: ['invited'] },
  };
}

describe('IdentityBar', () => {
  it('should announce the verification when the identity is loading', () => {
    // Arrange & Act
    render(<IdentityBar state={{ status: 'loading' }} />);

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('Vérification');
  });

  it('should show the user name and the provider label when the user is authenticated', () => {
    // Arrange & Act
    render(<IdentityBar state={authenticatedState('github', 'octocat')} />);

    // Assert
    expect(screen.getByText('octocat')).toBeInTheDocument();
    expect(screen.getByText(/GitHub/)).toBeInTheDocument();
  });

  it('should show the capitalised first letter of the user name as avatar', () => {
    // Arrange & Act
    render(<IdentityBar state={authenticatedState('github', 'octocat')} />);

    // Assert
    expect(screen.getByText('O')).toBeInTheDocument();
  });

  it('should still offer the sign-out link when the user name is empty', () => {
    // Arrange & Act
    render(<IdentityBar state={authenticatedState('github', '')} />);

    // Assert
    expect(screen.getByRole('link', { name: 'Se déconnecter' })).toBeInTheDocument();
  });

  it('should label the Microsoft provider when the identity provider is aad', () => {
    // Arrange & Act
    render(<IdentityBar state={authenticatedState('aad', 'alice@exemple.com')} />);

    // Assert
    expect(screen.getByText(/Microsoft/)).toBeInTheDocument();
  });

  it('should offer a sign-out link that returns to the login page when the user is authenticated', () => {
    // Arrange & Act
    render(<IdentityBar state={authenticatedState('github', 'octocat')} />);

    // Assert
    expect(screen.getByRole('link', { name: 'Se déconnecter' })).toHaveAttribute(
      'href',
      '/.auth/logout?post_logout_redirect_uri=/login/',
    );
  });

  it('should offer a sign-in link when the visitor is anonymous', () => {
    // Arrange & Act
    render(<IdentityBar state={{ status: 'anonymous' }} />);

    // Assert
    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/login/');
  });

  it('should explain why the identity is unavailable when the platform endpoint cannot be read', () => {
    // Arrange & Act
    render(<IdentityBar state={{ status: 'unavailable', reason: 'réponse inattendue' }} />);

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('Identité indisponible : réponse inattendue');
  });
});
