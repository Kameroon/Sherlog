import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface RouteRule {
  route: string;
  allowedRoles?: string[];
  statusCode?: number;
}

interface ResponseOverride {
  redirect?: string;
  rewrite?: string;
  statusCode?: number;
}

interface StaticWebAppConfig {
  routes: RouteRule[];
  responseOverrides: Record<string, ResponseOverride>;
  globalHeaders: Record<string, string>;
  navigationFallback?: unknown;
}

const publicDirectory = resolve(import.meta.dirname, '../public');
const configPath = resolve(publicDirectory, 'staticwebapp.config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8')) as StaticWebAppConfig;
const contentSecurityPolicy = config.globalHeaders['Content-Security-Policy'] ?? '';

function indexOfRoute(route: string): number {
  return config.routes.findIndex((rule) => rule.route === route);
}

// These tests guard the only access control of the application: it lives in this file, never in client code.
describe('staticwebapp.config.json access rules', () => {
  it('should require the invited role on the catch-all rule placed last', () => {
    // Arrange
    const lastRule = config.routes.at(-1);

    // Act & Assert
    expect(lastRule).toEqual(expect.objectContaining({ route: '/*', allowedRoles: ['invited'] }));
  });

  it('should evaluate the public login and forbidden pages before the catch-all rule', () => {
    // Arrange
    const catchAll = indexOfRoute('/*');

    // Act & Assert
    expect(indexOfRoute('/login/*')).toBeGreaterThanOrEqual(0);
    expect(indexOfRoute('/login/*')).toBeLessThan(catchAll);
    expect(indexOfRoute('/forbidden/*')).toBeGreaterThanOrEqual(0);
    expect(indexOfRoute('/forbidden/*')).toBeLessThan(catchAll);
  });

  // The folder URL (/login/) is only guaranteed to match a rule written on its index.html file, not a wildcard.
  // A miss would send every visitor into an endless 401 redirect to the login page.
  it.each([
    ['/login/index.html', 'anonymous'],
    ['/forbidden/index.html', 'authenticated'],
  ])('should declare an exact rule for %s so that its folder URL matches', (route, role) => {
    // Arrange
    const rule = config.routes.find((candidate) => candidate.route === route);

    // Act & Assert
    expect(rule?.allowedRoles).toEqual([role]);
    expect(indexOfRoute(route)).toBeLessThan(indexOfRoute('/*'));
  });

  it('should open the login page to anonymous visitors only', () => {
    // Arrange
    const loginRule = config.routes.find((rule) => rule.route === '/login/*');

    // Act & Assert
    expect(loginRule?.allowedRoles).toEqual(['anonymous']);
  });

  it('should show the forbidden page to signed-in users only', () => {
    // Arrange
    const forbiddenRule = config.routes.find((rule) => rule.route === '/forbidden/*');

    // Act & Assert
    expect(forbiddenRule?.allowedRoles).toEqual(['authenticated']);
  });

  it('should not define a navigation fallback, which would skip the route rules', () => {
    // Arrange & Act & Assert
    expect(config.navigationFallback).toBeUndefined();
  });

  it('should not block a sign-in provider route, which would make invitations fail', () => {
    // Arrange
    const blockedProviderRoutes = config.routes.filter(
      (rule) => rule.route.startsWith('/.auth') && rule.statusCode === 404,
    );

    // Act & Assert
    expect(blockedProviderRoutes).toEqual([]);
  });

  it('should redirect unauthenticated requests to the login page when the platform answers 401', () => {
    // Arrange & Act & Assert
    expect(config.responseOverrides['401']).toEqual({ redirect: '/login/', statusCode: 302 });
  });

  it('should serve the forbidden page with a 403 status when the user lacks the invited role', () => {
    // Arrange & Act & Assert
    expect(config.responseOverrides['403']).toEqual({ rewrite: '/forbidden/index.html', statusCode: 403 });
  });

  it.each(["default-src 'self'", "script-src 'self'", "style-src 'self'", "worker-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"])(
    'should declare %s in the Content-Security-Policy',
    (directive) => {
      // Arrange & Act & Assert
      expect(contentSecurityPolicy).toContain(directive);
    },
  );

  // The only places the page may send anything to are the two providers (ADR-002): a new destination is a decision, not a side effect.
  it('should let the page reach only itself, Anthropic and the local Ollama', () => {
    // Arrange
    const connectSources = contentSecurityPolicy
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .find(([name]) => name === 'connect-src')
      ?.slice(1);

    // Act & Assert
    expect(connectSources).toEqual(["'self'", 'https://api.anthropic.com', 'http://localhost:11434']);
  });

  it.each(['*', 'https:', 'http:', 'ws:', 'wss:'])('should never allow the wildcard source %s to be reached', (source) => {
    // Arrange
    const sources = contentSecurityPolicy.split(/[;\s]+/);

    // Act & Assert
    expect(sources).not.toContain(source);
  });

  it.each(["'unsafe-inline'", "'unsafe-eval'"])('should never allow %s in the Content-Security-Policy', (keyword) => {
    // Arrange & Act & Assert
    expect(contentSecurityPolicy).not.toContain(keyword);
  });

  it('should disable content-type sniffing and referrer leaks with global headers', () => {
    // Arrange & Act & Assert
    expect(config.globalHeaders['X-Content-Type-Options']).toBe('nosniff');
    expect(config.globalHeaders['Referrer-Policy']).toBe('no-referrer');
  });

  it('should stay under the 20 KB platform limit for the configuration file', () => {
    // Arrange
    const sizeInBytes = statSync(configPath).size;

    // Act & Assert
    expect(sizeInBytes).toBeLessThan(20 * 1024);
  });
});

describe('static public pages', () => {
  const loginPage = readFileSync(resolve(publicDirectory, 'login/index.html'), 'utf8');
  const forbiddenPage = readFileSync(resolve(publicDirectory, 'forbidden/index.html'), 'utf8');

  it('should offer both GitHub and Microsoft sign-in on the login page', () => {
    // Arrange & Act & Assert
    expect(loginPage).toContain('/.auth/login/github?post_login_redirect_uri=/');
    expect(loginPage).toContain('/.auth/login/aad?post_login_redirect_uri=/');
  });

  it('should offer a sign-out link on the forbidden page', () => {
    // Arrange & Act & Assert
    expect(forbiddenPage).toContain('/.auth/logout?post_logout_redirect_uri=/login/');
  });

  it.each([
    ['login', loginPage],
    ['forbidden', forbiddenPage],
  ])('should contain no inline script or style on the %s page', (_name, page) => {
    // Arrange
    const inlineCode = /<script(?![^>]*\ssrc=)|<style|\sstyle=/i;

    // Act & Assert
    expect(page).not.toMatch(inlineCode);
  });
});

// Only /login/* is reachable before signing in: a stylesheet served from anywhere else (the application bundle,
// for instance) would be answered with a redirect to the login page and leave the page unstyled.
describe('stylesheets of the pages shown before sign-in', () => {
  const pages = {
    login: readFileSync(resolve(publicDirectory, 'login/index.html'), 'utf8'),
    forbidden: readFileSync(resolve(publicDirectory, 'forbidden/index.html'), 'utf8'),
  };

  function stylesheetsOf(page: string): string[] {
    return [...page.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((match) => match[1] ?? '');
  }

  it.each(Object.entries(pages))('should load only existing stylesheets under /login/ on the %s page', (_name, page) => {
    // Arrange
    const stylesheets = stylesheetsOf(page);

    // Act & Assert
    expect(stylesheets.length).toBeGreaterThan(0);
    for (const stylesheet of stylesheets) {
      expect(stylesheet.startsWith('/login/')).toBe(true);
      expect(() => statSync(resolve(publicDirectory, stylesheet.slice(1)))).not.toThrow();
    }
  });

  it('should let the application load the shared design tokens from the public path', () => {
    // Arrange
    const applicationPage = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');

    // Act & Assert
    expect(stylesheetsOf(applicationPage)).toContain('/login/base.css');
  });

  it.each([
    ['login', pages.login],
    ['forbidden', pages.forbidden],
    ['application', readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8')],
  ])('should declare light and dark colour schemes on the %s page', (_name, page) => {
    // Arrange & Act & Assert
    expect(page).toContain('<meta name="color-scheme" content="light dark" />');
  });
});
