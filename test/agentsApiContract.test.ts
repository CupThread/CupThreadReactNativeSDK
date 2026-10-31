import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Contract-drift guard (issue #148): AGENTS.md is the first file every agent
// and contributor loads, and Quality Rule 3 demands strict contract consistency
// with the CupThread Public API. Every request path the client actually sends
// (the `path:` literals in FeedbackClient) must therefore appear in AGENTS.md's
// "Architecture & API Contract" list — otherwise the documented contract and
// the shipping client drift apart again.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Normalizes one request-path literal into a comparable route shape:
 * template expressions become `{param}` and query strings are dropped.
 *
 * A path parameter always directly follows a `/` (e.g. `uploads/${id}`), so a
 * template expression glued to a literal segment (e.g. `profile${query...}`)
 * is an appended query string and truncates the route there.
 */
function normalizeRouteLiteral(raw: string): string {
  let cut = raw.length;
  let searchFrom = 0;
  for (;;) {
    const idx = raw.indexOf('${', searchFrom);
    if (idx === -1) break;
    if (idx > 0 && raw[idx - 1] !== '/') {
      cut = idx;
      break;
    }
    searchFrom = idx + 2;
  }
  let route = raw.slice(0, cut);
  let prev: string;
  do {
    prev = route;
    route = route.replace(/\$\{[^}]*\}/g, '{param}');
  } while (route !== prev);
  return route.replace(/\?.*$/, '').trim();
}

function extractClientRoutes(): string[] {
  const source = readFileSync(path.join(ROOT, 'src', 'client', 'FeedbackClient.ts'), 'utf8');
  const routes = new Set<string>();
  const pathRegex = /path:\s*(?:'([^']+)'|`([^`]+)`)/g;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(source)) !== null) {
    const route = normalizeRouteLiteral(match[1] ?? match[2]);
    if (route.startsWith('/api/')) {
      routes.add(route);
    }
  }
  return [...routes].sort();
}

function extractDocumentedRoutes(): Set<string> {
  const agents = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const routes = new Set<string>();
  const lineRegex = /`(?:GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(agents)) !== null) {
    routes.add(
      match[1]
        .replace(/:[A-Za-z0-9]+/g, '{param}')
        .replace(/\?.*$/, '')
        .trim()
    );
  }
  return routes;
}

test('AGENTS.md API contract lists every route the client requests', () => {
  const clientRoutes = extractClientRoutes();
  assert.ok(clientRoutes.length > 0, 'must find request paths in FeedbackClient');
  const documented = extractDocumentedRoutes();

  const missing = clientRoutes.filter((route) => !documented.has(route));
  assert.deepEqual(
    missing,
    [],
    `AGENTS.md's "Architecture & API Contract" section is missing routes the client actually requests: ${missing.join(', ')}`
  );
});

test('AGENTS.md API contract no longer presents the retired direct-upload pair as the upload path', () => {
  const agents = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  // The retired bullet documented `POST /api/v1/uploads/images` &
  // `POST /api/v1/uploads/r2` as the live media/log upload path; inline
  // historical mentions inside the session-flow bullets are fine.
  assert.doesNotMatch(
    agents,
    /uploads\/images` & `POST \/api\/v1\/uploads\/r2/,
    'the retired direct-upload bullet must be replaced by the governed upload-session flow'
  );
});
