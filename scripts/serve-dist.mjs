// Serves `dist/` the way Azure Static Web Apps does for the headers that matter here (the CSP above all), so that
// the built app can be tried locally under its production policy. Not part of the app: it never ships.
//
// The access control is NOT reproduced (no login, no roles). `/.auth/me` answers with a made-up local identity so
// that the identity bar has something to show; on Azure that route is answered by the platform.
//
// Usage: node scripts/serve-dist.mjs [port]   (default 4173; `npm run build` first)
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../dist', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../public/staticwebapp.config.json', import.meta.url), 'utf8'));

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const localIdentity = {
  clientPrincipal: {
    identityProvider: 'github',
    userId: 'local-preview',
    userDetails: 'utilisateur-local',
    userRoles: ['anonymous', 'authenticated', 'invited'],
  },
};

/** Creates (without starting) the server for `dist/`. */
export function createDistServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/.auth/me') {
      response.writeHead(200, { ...config.globalHeaders, 'Content-Type': 'application/json' });
      response.end(JSON.stringify(localIdentity));
      return;
    }
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (path !== root && !path.startsWith(root + sep)) {
      response.writeHead(403, config.globalHeaders).end();
      return;
    }
    if (existsSync(path) && statSync(path).isDirectory()) {
      path = join(path, 'index.html');
    }
    if (!existsSync(path)) {
      response.writeHead(404, config.globalHeaders).end('not found');
      return;
    }
    response.writeHead(200, { ...config.globalHeaders, 'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream' });
    response.end(readFileSync(path));
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!existsSync(join(root, 'index.html'))) {
    console.error('dist/ est absent : lancez d’abord « npm run build ».');
    process.exit(1);
  }
  const port = Number(process.argv[2] ?? 4173);
  createDistServer().listen(port, '127.0.0.1', () => {
    console.log(`Sherlog (dist/, en-têtes de production) : http://127.0.0.1:${port}/`);
    console.log('Identité simulée : « utilisateur-local ». Le contrôle d’accès d’Azure n’est pas reproduit. Ctrl+C pour arrêter.');
  });
}
