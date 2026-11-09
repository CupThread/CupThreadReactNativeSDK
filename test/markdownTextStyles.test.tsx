import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const ViewStub = (props: any) => {
  return React.createElement('View', props, props.children ?? null);
};

const TextStub = (props: any) => {
  return React.createElement('Text', props, props.children ?? null);
};

function flattenStyle(style: any): Record<string, any> {
  if (!style) return {};
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.flat(Infinity).filter(Boolean).map(flattenStyle));
  }
  return style;
}

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ViewStub,
      Text: TextStub,
      StyleSheet: {
        create: (styles: any) => styles,
        flatten: flattenStyle,
      },
      Linking: {
        openURL: async () => {},
      },
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { MarkdownText } = supportsModuleMocks
  ? await import('../src/components/MarkdownText')
  : ({} as any);
const { CupThreadProvider } = supportsModuleMocks
  ? await import('../src/theme/CupThreadThemeProvider')
  : ({} as any);

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

function makeClient(): FeedbackClient {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_markdown_styles',
  });
  client.fetchAppConfig = (async () => ({})) as any;
  return client;
}

function renderMarkdown(props: any): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client: makeClient(),
        children: React.createElement(MarkdownText, props),
      })
    );
  });
  return renderer;
}

test(
  'MarkdownText: inline text, bold, and italic do not override color, allowing paragraph textSecondary inheritance (#245)',
  renderTestOptions,
  () => {
    const renderer = renderMarkdown({
      content: 'This is **bold text** and *italic text* here.',
    });

    const textNodes = renderer.root.findAllByType(TextStub as any);
    assert.ok(textNodes.length >= 4, 'should render paragraph and child inline tokens');

    // Root paragraph text node (first Text node)
    const paragraphNode = textNodes[0];
    const paragraphStyle = flattenStyle(paragraphNode.props.style);
    // Paragraph text has textSecondary color
    assert.equal(
      paragraphStyle.color,
      '#475569',
      'paragraph container should specify textSecondary color'
    );

    // Inner plain text nodes
    const plainToken = textNodes.find(
      (node) => node.props.children === 'This is ' && node !== paragraphNode
    );
    assert.ok(plainToken, 'plain text node should exist');
    assert.equal(
      plainToken.props.style,
      undefined,
      'plain text token should not specify an inline style overriding color'
    );

    // Inner bold text node
    const boldToken = textNodes.find((node) => node.props.children === 'bold text');
    assert.ok(boldToken, 'bold text node should exist');
    assert.deepEqual(
      boldToken.props.style,
      { fontWeight: '700' },
      'bold token should only declare fontWeight and not override color'
    );

    // Inner italic text node
    const italicToken = textNodes.find((node) => node.props.children === 'italic text');
    assert.ok(italicToken, 'italic text node should exist');
    assert.deepEqual(
      italicToken.props.style,
      { fontStyle: 'italic' },
      'italic token should only declare fontStyle and not override color'
    );

    renderer.unmount();
  }
);

test(
  'MarkdownText: custom style color passes down to paragraph and headings without child color collisions (#245)',
  renderTestOptions,
  () => {
    const customColor = '#059669';
    const renderer = renderMarkdown({
      content: '# Heading 1\nCustom colored paragraph text.',
      style: { color: customColor },
    });

    const textNodes = renderer.root.findAllByType(TextStub as any);

    // Heading block
    const headingNode = textNodes[0];
    const headingStyle = flattenStyle(headingNode.props.style);
    assert.equal(headingStyle.color, customColor, 'heading should take caller custom color');

    // Heading child inline text
    const headingChild = textNodes.find((node) => node.props.children === 'Heading 1');
    assert.ok(headingChild);
    assert.equal(
      headingChild.props.style,
      undefined,
      'heading child text should not declare inline color'
    );

    // Paragraph block
    const paragraphBlock = textNodes.find((node) => {
      const flat = flattenStyle(node.props.style);
      return flat.fontSize === 14;
    });
    assert.ok(paragraphBlock, 'paragraph block should exist');
    const paragraphStyle = flattenStyle(paragraphBlock.props.style);
    assert.equal(paragraphStyle.color, customColor, 'paragraph should take caller custom color');

    // Paragraph child inline text
    const paragraphChild = textNodes.find(
      (node) => node.props.children === 'Custom colored paragraph text.'
    );
    assert.ok(paragraphChild);
    assert.equal(
      paragraphChild.props.style,
      undefined,
      'paragraph child text should not declare inline color'
    );

    renderer.unmount();
  }
);

test(
  'MarkdownText: inert / disallowed link inherits parent color without overriding style (#245)',
  renderTestOptions,
  () => {
    const renderer = renderMarkdown({
      content: 'See [Inert Link](javascript:alert(1)) text.',
    });

    const textNodes = renderer.root.findAllByType(TextStub as any);
    const inertLinkNode = textNodes.find((node) => node.props.children === 'Inert Link');
    assert.ok(inertLinkNode, 'inert link node should be rendered');
    assert.equal(
      inertLinkNode.props.style,
      undefined,
      'inert link should have no style and inherit parent color'
    );
    assert.equal(
      inertLinkNode.props.accessibilityRole,
      undefined,
      'inert link should not have link accessibilityRole'
    );

    renderer.unmount();
  }
);

test(
  'MarkdownText: pressable links and inline code preserve their dedicated styling (#245)',
  renderTestOptions,
  () => {
    const renderer = renderMarkdown({
      content: 'Here is `inline code` and a [Valid Link](https://cupthread.com).',
    });

    const textNodes = renderer.root.findAllByType(TextStub as any);

    // Pressable link
    const linkNode = textNodes.find((node) => node.props.children === 'Valid Link');
    assert.ok(linkNode, 'pressable link node should exist');
    assert.deepEqual(linkNode.props.style, {
      color: '#2563eb', // light mode primary color
      textDecorationLine: 'underline',
    });
    assert.equal(linkNode.props.accessibilityRole, 'link');

    // Inline code
    const codeNode = textNodes.find(
      (node) =>
        typeof node.props.children === 'string' && node.props.children.includes('inline code')
    );
    assert.ok(codeNode, 'code node should exist');
    const codeStyle = flattenStyle(codeNode.props.style);
    assert.equal(codeStyle.fontFamily, 'Courier');
    assert.equal(codeStyle.color, '#2563eb');

    renderer.unmount();
  }
);

test(
  'MarkdownText: handles non-string content prop gracefully without throwing TypeError (#302)',
  renderTestOptions,
  () => {
    const nonStringValues = [12345, true, false, {}, [], () => {}];
    for (const val of nonStringValues) {
      const renderer = renderMarkdown({ content: val as any });
      assert.equal(
        renderer.toJSON(),
        null,
        `MarkdownText should return null for non-string content: ${typeof val}`
      );
      renderer.unmount();
    }
  }
);

test(
  'MarkdownText: whitespace-only content returns null without mounting layout container or spacers (#340)',
  renderTestOptions,
  () => {
    const whitespaceValues = ['   ', '\t', '\n\n\n', '  \t \n  \r\n  '];
    for (const val of whitespaceValues) {
      const renderer = renderMarkdown({ content: val });
      assert.equal(
        renderer.toJSON(),
        null,
        `MarkdownText should return null for whitespace-only content: ${JSON.stringify(val)}`
      );
      renderer.unmount();
    }
  }
);
