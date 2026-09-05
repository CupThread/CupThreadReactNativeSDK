import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('package.json packaging configuration and manifest integrity', () => {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  // Ensure scripts support both git dependency installs (prepare) and npm pack/publish (prepack)
  assert.equal(pkg.scripts?.prepare, 'npm run build', 'prepare script must build dist for git dependencies');
  assert.equal(pkg.scripts?.prepack, 'npm run build', 'prepack script must build dist before pack/publish');

  // Bundler tree-shaking hint
  assert.equal(pkg.sideEffects, false, 'sideEffects must be false for bundler tree-shaking');

  // Exports map must export package.json and root entry points
  assert.ok(pkg.exports, 'package.json must define exports map');
  assert.equal(pkg.exports['./package.json'], './package.json', 'exports map must include ./package.json');

  const rootExport = pkg.exports['.'];
  assert.ok(rootExport, 'exports must include root "." entry');
  assert.equal(rootExport.types, './dist/types/index.d.ts');
  assert.equal(rootExport['react-native'], './src/index.ts');
  assert.equal(rootExport.import, './dist/esm/index.js');
  assert.equal(rootExport.require, './dist/cjs/index.js');

  // Package entry points
  assert.equal(pkg.main, './dist/cjs/index.js');
  assert.equal(pkg.module, './dist/esm/index.js');
  assert.equal(pkg.types, './dist/types/index.d.ts');
  assert.equal(pkg['react-native'], './src/index.ts');

  // Files inclusion list
  assert.ok(Array.isArray(pkg.files), 'files must be an array');
  assert.ok(pkg.files.includes('dist'), 'files must include dist');
  assert.ok(pkg.files.includes('src'), 'files must include src');
});

test('build output artifacts exist and have correct formats', () => {
  const distCjs = path.join(ROOT, 'dist', 'cjs', 'index.js');
  const distEsm = path.join(ROOT, 'dist', 'esm', 'index.js');
  const distTypes = path.join(ROOT, 'dist', 'types', 'index.d.ts');
  const cjsPkg = path.join(ROOT, 'dist', 'cjs', 'package.json');
  const esmPkg = path.join(ROOT, 'dist', 'esm', 'package.json');

  assert.ok(existsSync(distCjs), 'dist/cjs/index.js must exist');
  assert.ok(existsSync(distEsm), 'dist/esm/index.js must exist');
  assert.ok(existsSync(distTypes), 'dist/types/index.d.ts must exist');
  assert.ok(existsSync(cjsPkg), 'dist/cjs/package.json must exist');
  assert.ok(existsSync(esmPkg), 'dist/esm/package.json must exist');

  const cjsJson = JSON.parse(readFileSync(cjsPkg, 'utf8'));
  assert.equal(cjsJson.type, 'commonjs');

  const esmJson = JSON.parse(readFileSync(esmPkg, 'utf8'));
  assert.equal(esmJson.type, 'module');
});
