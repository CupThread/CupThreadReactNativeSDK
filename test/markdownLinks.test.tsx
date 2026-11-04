import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const mockClient = new FeedbackClient({
  baseUrl: 'https://api.cupthread.com',
  appKey: 'app_test_md_links',
});

const openedUrls: string[] = [];
const textProps: Record<string, any>[] = [];

const TextStub = (props: any) => {
  textProps.push(props);
  return props.children ?? null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: TextStub,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Linking: {
        openURL: async (url: string) => {
          openedUrls.push(url);
        },
      },
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { CupThreadProvider } = supportsModuleMocks
  ? await import('../src/theme/CupThreadThemeProvider')
  : ({} as any);
const { MarkdownText } = supportsModuleMocks
  ? await import('../src/components/MarkdownText')
  : ({} as any);

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

test(
  'MarkdownText: URL with balanced parentheses is parsed correctly without truncation (#193)',
  renderTestOptions,
  async () => {
    openedUrls.length = 0;
    textProps.length = 0;

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client: mockClient,
          children: React.createElement(MarkdownText, {
            content: 'See [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) for documentation.',
          }),
        })
      );
    });

    await flush();

    const linkText = textProps.find((t) => t.children === 'Foo');
    assert.ok(linkText, 'link text "Foo" should be rendered');
    assert.equal(linkText.accessibilityRole, 'link');
    assert.equal(typeof linkText.onPress, 'function');

    // Stray ')' node should NOT be present in rendered texts
    const strayParen = textProps.find(
      (t) => t.children === ')' || t.children === ') for documentation.'
    );
    assert.equal(strayParen, undefined, 'no stray trailing parenthesis text node');

    // Trigger press
    act(() => {
      linkText.onPress();
    });
    await flush();

    assert.deepEqual(openedUrls, ['https://en.wikipedia.org/wiki/Foo_(bar)']);
    renderer.unmount();
  }
);

test(
  'MarkdownText: CommonMark link title suffix is stripped from opened URL (#193)',
  renderTestOptions,
  async () => {
    openedUrls.length = 0;
    textProps.length = 0;

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client: mockClient,
          children: React.createElement(MarkdownText, {
            content: 'Read [Docs](https://cupthread.com "Platform Docs") online.',
          }),
        })
      );
    });

    await flush();

    const linkText = textProps.find((t) => t.children === 'Docs');
    assert.ok(linkText, 'link text "Docs" should be rendered');

    act(() => {
      linkText.onPress();
    });
    await flush();

    assert.deepEqual(openedUrls, ['https://cupthread.com']);
    renderer.unmount();
  }
);

test(
  'MarkdownText: angle bracket destination URLs are supported (#193)',
  renderTestOptions,
  async () => {
    openedUrls.length = 0;
    textProps.length = 0;

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client: mockClient,
          children: React.createElement(MarkdownText, {
            content: 'Check [API](<https://api.cupthread.com/v1> "API Title") endpoints.',
          }),
        })
      );
    });

    await flush();

    const linkText = textProps.find((t) => t.children === 'API');
    assert.ok(linkText, 'link text "API" should be rendered');

    act(() => {
      linkText.onPress();
    });
    await flush();

    assert.deepEqual(openedUrls, ['https://api.cupthread.com/v1']);
    renderer.unmount();
  }
);

test(
  'MarkdownText: multiple links on the same line parse independently (#193)',
  renderTestOptions,
  async () => {
    openedUrls.length = 0;
    textProps.length = 0;

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client: mockClient,
          children: React.createElement(MarkdownText, {
            content:
              'Compare [Wiki](https://en.wikipedia.org/wiki/Foo_(bar)) and [Docs](https://cupthread.com).',
          }),
        })
      );
    });

    await flush();

    const wikiLink = textProps.find((t) => t.children === 'Wiki');
    const docsLink = textProps.find((t) => t.children === 'Docs');
    assert.ok(wikiLink, 'Wiki link rendered');
    assert.ok(docsLink, 'Docs link rendered');

    act(() => {
      wikiLink.onPress();
    });
    act(() => {
      docsLink.onPress();
    });
    await flush();

    assert.deepEqual(openedUrls, [
      'https://en.wikipedia.org/wiki/Foo_(bar)',
      'https://cupthread.com',
    ]);
    renderer.unmount();
  }
);

test(
  'MarkdownText: onLinkPress interceptor receives clean URL and can cancel default opener (#193)',
  renderTestOptions,
  async () => {
    openedUrls.length = 0;
    textProps.length = 0;
    const intercepted: string[] = [];

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client: mockClient,
          children: React.createElement(MarkdownText, {
            content: 'See [Custom](https://en.wikipedia.org/wiki/Test_(paren) "Title")',
            onLinkPress: (url: string) => {
              intercepted.push(url);
              return true; // handled
            },
          }),
        })
      );
    });

    await flush();

    const linkText = textProps.find((t) => t.children === 'Custom');
    assert.ok(linkText);

    act(() => {
      linkText.onPress();
    });
    await flush();

    assert.deepEqual(intercepted, ['https://en.wikipedia.org/wiki/Test_(paren)']);
    assert.deepEqual(openedUrls, [], 'default opener should be suppressed');
    renderer.unmount();
  }
);

test(
  'MarkdownText: unbalanced parentheses in URL degrade gracefully to plain text (#193)',
  renderTestOptions,
  async () => {
    openedUrls.length = 0;
    textProps.length = 0;

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client: mockClient,
          children: React.createElement(MarkdownText, {
            content: 'Bad link [Broken](https://cupthread.com/(unbalanced and text',
          }),
        })
      );
    });

    await flush();

    const brokenLink = textProps.find(
      (t) => t.children === 'Broken' && t.accessibilityRole === 'link'
    );
    assert.equal(brokenLink, undefined, 'unbalanced paren link must not render as pressable link');
    renderer.unmount();
  }
);
