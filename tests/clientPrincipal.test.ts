import { describe, expect, it, vi } from 'vitest';
import { fetchClientPrincipal } from '../src/auth/clientPrincipal';

const validPrincipal = {
  identityProvider: 'github',
  userId: 'abcd12345',
  userDetails: 'octocat',
  userRoles: ['anonymous', 'authenticated', 'invited'],
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('fetchClientPrincipal', () => {
  it('should return the authenticated state when the endpoint returns a valid client principal', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ clientPrincipal: validPrincipal }));

    // Act
    const state = await fetchClientPrincipal(fetchMock);

    // Assert
    expect(state).toEqual({ status: 'authenticated', principal: validPrincipal });
  });

  it('should query the platform identity endpoint when fetching the principal', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ clientPrincipal: null }));

    // Act
    await fetchClientPrincipal(fetchMock);

    // Assert
    expect(fetchMock).toHaveBeenCalledWith('/.auth/me', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('should return the anonymous state when the client principal is null', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ clientPrincipal: null }));

    // Act
    const state = await fetchClientPrincipal(fetchMock);

    // Assert
    expect(state).toEqual({ status: 'anonymous' });
  });

  it('should return the unavailable state when the response is not JSON, as in local development', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('<!doctype html><html></html>'));

    // Act
    const state = await fetchClientPrincipal(fetchMock);

    // Assert
    expect(state.status).toBe('unavailable');
  });

  it('should return the unavailable state when the HTTP status is not successful', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('denied', { status: 500 }));

    // Act
    const state = await fetchClientPrincipal(fetchMock);

    // Assert
    expect(state).toEqual({ status: 'unavailable', reason: expect.stringContaining('500') as unknown });
  });

  it('should return the unavailable state when the network request fails', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    // Act
    const state = await fetchClientPrincipal(fetchMock);

    // Assert
    expect(state.status).toBe('unavailable');
  });

  it('should return the unavailable state when the principal has an unexpected shape', async () => {
    // Arrange
    const malformed = { ...validPrincipal, userRoles: 'invited' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ clientPrincipal: malformed }));

    // Act
    const state = await fetchClientPrincipal(fetchMock);

    // Assert
    expect(state.status).toBe('unavailable');
  });
});
