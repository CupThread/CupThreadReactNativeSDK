#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, dryRun = false) {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  if (dryRun) return;
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`❌ Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
let version = null;
let dryRun = false;
let noPush = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--version') version = args[++i];
  if (args[i] === '--dry-run') dryRun = true;
  if (args[i] === '--no-push') noPush = true;
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/release.mjs --version <semver> [--dry-run] [--no-push]');
  process.exit(1);
}

console.log(`\n⚛️ Preparing release for @cupthread/react-native v${version}${dryRun ? ' [DRY RUN]' : ''}`);

// Verify working directory is clean if not dry run
if (!dryRun) {
  const statusRes = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  if (statusRes.stdout && statusRes.stdout.trim().length > 0) {
    console.warn('⚠️ Warning: Git working directory has uncommitted changes.');
  }
}

// 1. Run typecheck & tests
console.log('\n🧪 Running typecheck and tests...');
run('npm', ['run', 'typecheck'], dryRun);
run('npm', ['run', 'test'], dryRun);

// 2. Bump package.json version
console.log('\n📝 Updating package.json version...');
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const prevVersion = pkg.version;
pkg.version = version;

if (!dryRun) {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
console.log(`  Updated version: ${prevVersion} -> ${version}`);

// 3. Build dist artifacts (ESM, CJS, types)
console.log('\n🔨 Building distribution packages...');
run('npm', ['run', 'build'], dryRun);

// 4. Git Commit & Tag
console.log('\n🏷️ Tagging release...');
run('git', ['add', 'package.json'], dryRun);
run('git', ['commit', '-m', `release: react-native SDK v${version}`], dryRun);
run('git', ['tag', '-a', `v${version}`, '-m', `Release v${version}`], dryRun);

if (!noPush && !dryRun) {
  console.log('\n🚀 Pushing commit and tag to remote...');
  run('git', ['push', 'origin', 'HEAD']);
  run('git', ['push', 'origin', `v${version}`]);
} else if (noPush) {
  console.log(`\n💡 Skipped push. When ready, run:\n  git push origin HEAD && git push origin v${version}`);
}

console.log(`\n✅ React Native SDK v${version} release workflow completed successfully!`);
console.log(`\nInstallation command for users:`);
console.log(`  npm install github:CupThread/CupThreadReactNativeSDK#v${version}`);
console.log(`  # or once published to npm:`);
console.log(`  npm install @cupthread/react-native@^${version}\n`);
