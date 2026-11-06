import { render, screen, within } from '@testing-library/react';
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

  it('should show the brand in the header and a welcoming title in the main area', async () => {
    // Arrange
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ clientPrincipal: null }))),
    );

    // Act
    render(<App />);

    // Assert
    expect(within(screen.getByRole('banner')).getByText('Sherlog')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1, name: /enquêter/ })).toBeInTheDocument();
    await screen.findByRole('link', { name: 'Se connecter' });
  });

  it('should say that no log source is loaded yet', async () => {
    // Arrange
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ clientPrincipal: null }))),
    );

    // Act
    render(<App />);

    // Assert
    expect(within(screen.getByRole('main')).getByText(/Aucune source de logs chargée/)).toBeInTheDocument();
    await screen.findByRole('link', { name: 'Se connecter' });
  });
});
