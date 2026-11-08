import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeMarkdownInline } from '../src/utils/markdownInline';

test('tokenizeMarkdownInline: empty or blank input returns empty array', () => {
  assert.deepEqual(tokenizeMarkdownInline(''), []);
});

test('tokenizeMarkdownInline: handles non-string inputs safely without throwing TypeError (#302)', () => {
  assert.deepEqual(tokenizeMarkdownInline(null as any), []);
  assert.deepEqual(tokenizeMarkdownInline(undefined as any), []);
  assert.deepEqual(tokenizeMarkdownInline(12345 as any), []);
  assert.deepEqual(tokenizeMarkdownInline(true as any), []);
  assert.deepEqual(tokenizeMarkdownInline({} as any), []);
  assert.deepEqual(tokenizeMarkdownInline([] as any), []);
  assert.deepEqual(tokenizeMarkdownInline(Symbol('test') as any), []);
  assert.deepEqual(tokenizeMarkdownInline(['**bold**'] as any), []);
});

test('tokenizeMarkdownInline: plain text without markdown formatting', () => {
  const tokens = tokenizeMarkdownInline('Hello world, this is plain text.');
  assert.deepEqual(tokens, [
    {
      type: 'text',
      content: 'Hello world, this is plain text.',
    },
  ]);
});

test('tokenizeMarkdownInline: parses bold, italic, and inline code tokens', () => {
  const tokens = tokenizeMarkdownInline('A **bold** word, an *italic* word, and `code` block.');
  assert.deepEqual(tokens, [
    { type: 'text', content: 'A ' },
    { type: 'bold', content: 'bold' },
    { type: 'text', content: ' word, an ' },
    { type: 'italic', content: 'italic' },
    { type: 'text', content: ' word, and ' },
    { type: 'code', content: 'code' },
    { type: 'text', content: ' block.' },
  ]);
});

test('tokenizeMarkdownInline: parses link with balanced parentheses in URL (#193)', () => {
  const tokens = tokenizeMarkdownInline(
    'See [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) for details.'
  );
  assert.deepEqual(tokens, [
    { type: 'text', content: 'See ' },
    {
      type: 'link',
      text: 'Foo',
      url: 'https://en.wikipedia.org/wiki/Foo_(bar)',
    },
    { type: 'text', content: ' for details.' },
  ]);
});

test('tokenizeMarkdownInline: parses link with multiple balanced parentheses in URL (#193)', () => {
  const tokens = tokenizeMarkdownInline(
    'Check [Multi](https://example.com/item_(1)_and_(2)) link.'
  );
  assert.deepEqual(tokens, [
    { type: 'text', content: 'Check ' },
    {
      type: 'link',
      text: 'Multi',
      url: 'https://example.com/item_(1)_and_(2)',
    },
    { type: 'text', content: ' link.' },
  ]);
});

test('tokenizeMarkdownInline: discards optional double-quoted title suffix (#193)', () => {
  const tokens = tokenizeMarkdownInline('Visit [Docs](https://cupthread.com "Documentation") now.');
  assert.deepEqual(tokens, [
    { type: 'text', content: 'Visit ' },
    {
      type: 'link',
      text: 'Docs',
      url: 'https://cupthread.com',
      title: 'Documentation',
    },
    { type: 'text', content: ' now.' },
  ]);
});

test('tokenizeMarkdownInline: discards optional single-quoted title suffix (#193)', () => {
  const tokens = tokenizeMarkdownInline(
    "Visit [Portal](https://portal.cupthread.com 'Customer Portal') here."
  );
  assert.deepEqual(tokens, [
    { type: 'text', content: 'Visit ' },
    {
      type: 'link',
      text: 'Portal',
      url: 'https://portal.cupthread.com',
      title: 'Customer Portal',
    },
    { type: 'text', content: ' here.' },
  ]);
});

test('tokenizeMarkdownInline: handles angle-bracketed URLs with optional title (#193)', () => {
  const tokens = tokenizeMarkdownInline(
    '[Angle](<https://example.com/docs/api reference> "API Title")'
  );
  assert.deepEqual(tokens, [
    {
      type: 'link',
      text: 'Angle',
      url: 'https://example.com/docs/api reference',
      title: 'API Title',
    },
  ]);
});

test('tokenizeMarkdownInline: two links on same line parse independently (#193)', () => {
  const tokens = tokenizeMarkdownInline(
    'See [Wiki](https://en.wikipedia.org/wiki/Foo_(bar)) and [Site](https://example.com).'
  );
  assert.deepEqual(tokens, [
    { type: 'text', content: 'See ' },
    {
      type: 'link',
      text: 'Wiki',
      url: 'https://en.wikipedia.org/wiki/Foo_(bar)',
    },
    { type: 'text', content: ' and ' },
    {
      type: 'link',
      text: 'Site',
      url: 'https://example.com',
    },
    { type: 'text', content: '.' },
  ]);
});

test('tokenizeMarkdownInline: unbalanced parenthesis in URL degrades to plain text (#193)', () => {
  const text = 'Broken [bad](https://example.com/(incomplete and trailing text';
  const tokens = tokenizeMarkdownInline(text);
  assert.deepEqual(tokens, [{ type: 'text', content: text }]);
});

test('tokenizeMarkdownInline: preserves unsafe scheme links as link tokens for caller gating', () => {
  const tokens = tokenizeMarkdownInline('[dangerous](javascript:alert(1))');
  assert.deepEqual(tokens, [
    {
      type: 'link',
      text: 'dangerous',
      url: 'javascript:alert(1)',
    },
  ]);
});
