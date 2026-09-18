import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');

export interface GapViolation {
  file: string;
  line: number;
  content: string;
  prop: string;
}

export function findGapViolations(code: string, filename = 'test.tsx'): GapViolation[] {
  const violations: GapViolation[] = [];
  const gapPropertyRegex = /(?:^|\s|\{|,)\s*(gap|rowGap|columnGap)\s*:/;
  const lines = code.split('\n');

  let inBlockComment = false;

  lines.forEach((lineText, idx) => {
    const trimmed = lineText.trim();

    if (inBlockComment) {
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
      return;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) {
        inBlockComment = true;
      }
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
      return;
    }

    const match = trimmed.match(gapPropertyRegex);
    if (match) {
      violations.push({
        file: filename,
        line: idx + 1,
        content: trimmed,
        prop: match[1],
      });
    }
  });

  return violations;
}

function getAllSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllSourceFiles(fullPath));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }

  return files;
}

test('react-native peer dependency declares >=0.70.0 floor', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.peerDependencies, 'peerDependencies must exist');
  assert.equal(
    pkg.peerDependencies['react-native'],
    '>=0.70.0',
    'react-native peer dependency floor must remain >=0.70.0'
  );

  const agents = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(
    agents,
    /React Native 0\.70\+/,
    'AGENTS.md must document React Native 0.70+ compatibility'
  );

  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(
    readme,
    /React Native.*>= 0\.70\.0/,
    'README.md Requirements section must document React Native >= 0.70.0'
  );
});

test('findGapViolations detector accurately flags flexbox gap, rowGap, and columnGap', () => {
  // Flag gap in StyleSheet
  const gapHits = findGapViolations('const styles = StyleSheet.create({ row: { gap: 8 } });');
  assert.equal(gapHits.length, 1);
  assert.equal(gapHits[0].prop, 'gap');

  // Flag rowGap and columnGap
  const rowGapHits = findGapViolations('const styles = { list: { rowGap: 12 } };');
  assert.equal(rowGapHits.length, 1);
  assert.equal(rowGapHits[0].prop, 'rowGap');

  const colGapHits = findGapViolations('const styles = { footer: { columnGap: 16 } };');
  assert.equal(colGapHits.length, 1);
  assert.equal(colGapHits[0].prop, 'columnGap');

  // Flag inline JSX styles
  const inlineHits = findGapViolations('<View style={{ gap: 8, flexDirection: "row" }} />');
  assert.equal(inlineHits.length, 1);
  assert.equal(inlineHits[0].prop, 'gap');

  // Ignore comments and standard margins
  const commentHits = findGapViolations(`
    // gap: 8
    /*
     * gap: 12
     * rowGap: 16
     */
    const styles = StyleSheet.create({
      item: {
        marginBottom: 8,
        marginRight: 12,
      },
    });
  `);
  assert.equal(commentHits.length, 0);
});

test('no src styles use flexbox gap, rowGap, or columnGap on React Native 0.70 floor', () => {
  const sourceFiles = getAllSourceFiles(SRC_DIR);
  assert.ok(sourceFiles.length > 0, 'Must inspect at least one source file');

  const violations: GapViolation[] = [];

  for (const file of sourceFiles) {
    const relativePath = path.relative(ROOT, file);
    const content = readFileSync(file, 'utf8');
    violations.push(...findGapViolations(content, relativePath));
  }

  assert.deepEqual(
    violations,
    [],
    `Found ${violations.length} flexbox gap usage(s) in src/. React Native 0.70 does not support Yoga gap:\n` +
      violations.map((v) => `  - ${v.file}:${v.line} (${v.prop}): ${v.content}`).join('\n')
  );
});
