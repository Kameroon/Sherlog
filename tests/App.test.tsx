import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

describe('App', () => {
  it('should show the connected identity once the platform endpoint answers', async () => {
    // Arrange
    const principal = { identityProvider: 'github', userId: 'u1', userDetails: 'octocat', userRoles: ['invited'] };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ clientPrincipal: principal }))),
    );

    // Act
    render(<App />);

    // Assert
    expect(await screen.findByText('octocat')).toBeInTheDocument();
  });

  it('should expose the application title and an empty main area', async () => {
    // Arrange
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ clientPrincipal: null }))),
    );

    // Act
    render(<App />);

    // Assert
    expect(screen.getByRole('heading', { level: 1, name: 'Sherlog' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    await screen.findByRole('link', { name: 'Se connecter' });
  });
});
