#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
let version = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--version') version = args[++i];
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/release.mjs --version <semver>');
  process.exit(1);
}

console.log(`\n⚛️ Releasing @cupthread/react-native v${version}`);

// Bump package.json
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// Build
run('npm', ['run', 'build']);

// Commit & Tag
run('git', ['add', 'package.json']);
run('git', ['commit', '-m', `release: react-native SDK v${version}`]);
run('git', ['tag', '-a', `v${version}`, '-m', `Release v${version}`]);
run('git', ['push', 'origin', 'HEAD', `v${version}`]);

console.log(`\n✓ React Native SDK v${version} released!`);
