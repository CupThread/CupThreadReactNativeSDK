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

const ImageStub = (props: any) => {
  return React.createElement('Image', props, props.children ?? null);
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
      Image: ImageStub,
      StyleSheet: {
        create: (styles: any) => styles,
        flatten: flattenStyle,
      },
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Guard the component imports with the mock-capability check: importing the
// real modules pulls in react-native, which cannot load under plain Node, so
// without the guard an unsupported Node would crash the file instead of
// skipping the render-level tests.
const { Avatar } = supportsModuleMocks ? await import('../src/components/Avatar') : ({} as any);
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
    appKey: 'app_test_avatar',
  });
  client.fetchAppConfig = (async () => ({})) as any;
  return client;
}

function renderAvatar(props: any): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client: makeClient(),
        children: React.createElement(Avatar, props),
      })
    );
  });
  return renderer;
}

function collectTexts(root: TestRenderer.ReactTestRenderer['root']): string[] {
  const out: string[] = [];
  root.findAll((node: any) => {
    if (node.type === TextStub && typeof node.props?.children === 'string') {
      out.push(node.props.children);
    }
    return false;
  });
  return out;
}

test(
  'Avatar: renders "?" fallback placeholder when name is whitespace-only string (#246)',
  renderTestOptions,
  () => {
    const whitespaceCases = ['   ', '\t\n  ', ' '];
    for (const ws of whitespaceCases) {
      const renderer = renderAvatar({ name: ws });
      const texts = collectTexts(renderer.root);
      assert.equal(texts.length, 1, `must render 1 text node for name: ${JSON.stringify(ws)}`);
      assert.equal(
        texts[0],
        '?',
        `whitespace-only name ${JSON.stringify(ws)} must fall back to '?' instead of empty initial`
      );
      renderer.unmount();
    }
  }
);

test(
  'Avatar: trims surrounding whitespace and capitalizes initial letter (#246)',
  renderTestOptions,
  () => {
    const cases: Array<[string, string]> = [
      ['  taylor  ', 'T'],
      ['alex', 'A'],
      ['\tKatherine Johnson ', 'K'],
    ];
    for (const [name, expected] of cases) {
      const renderer = renderAvatar({ name });
      const texts = collectTexts(renderer.root);
      assert.equal(texts.length, 1);
      assert.equal(
        texts[0],
        expected,
        `name ${JSON.stringify(name)} must produce initial ${expected}`
      );
      renderer.unmount();
    }
  }
);

test(
  'Avatar: renders "?" fallback placeholder when name is null, undefined, or empty (#246)',
  renderTestOptions,
  () => {
    const falsyCases = [null, undefined, ''];
    for (const val of falsyCases) {
      const renderer = renderAvatar({ name: val });
      const texts = collectTexts(renderer.root);
      assert.equal(texts.length, 1);
      assert.equal(texts[0], '?', `falsy name ${JSON.stringify(val)} must fall back to '?'`);
      renderer.unmount();
    }
  }
);

test(
  'Avatar: safely handles non-string name gracefully falling back to "?" (#246)',
  renderTestOptions,
  () => {
    const invalidTypes = [123, {}, []];
    for (const val of invalidTypes) {
      const renderer = renderAvatar({ name: val as any });
      const texts = collectTexts(renderer.root);
      assert.equal(texts.length, 1);
      assert.equal(texts[0], '?', `non-string name ${JSON.stringify(val)} must fall back to '?'`);
      renderer.unmount();
    }
  }
);

test('Avatar: renders Image component when url is provided (#246)', renderTestOptions, () => {
  const testUrl = 'https://example.com/avatar.png';
  const renderer = renderAvatar({ url: testUrl, name: 'Taylor' });
  const imageNode = renderer.root.findByType('Image' as any);
  assert.ok(imageNode, 'Image element must be rendered when url is provided');
  assert.deepEqual(imageNode.props.source, { uri: testUrl });
  const texts = collectTexts(renderer.root);
  assert.equal(texts.length, 0, 'no initial text should be rendered when url is present');
  renderer.unmount();
});

test(
  'Avatar: whitespace-only url renders fallback initial instead of an empty Image (#290)',
  renderTestOptions,
  () => {
    const whitespaceUrls = ['   ', '\t\n ', ' '];
    for (const wsUrl of whitespaceUrls) {
      const renderer = renderAvatar({ url: wsUrl, name: 'Taylor Swift' });
      assert.throws(
        () => renderer.root.findByType('Image' as any),
        `no Image must be mounted for whitespace-only url ${JSON.stringify(wsUrl)}`
      );
      const texts = collectTexts(renderer.root);
      assert.equal(
        texts.join(''),
        'T',
        `whitespace-only url ${JSON.stringify(wsUrl)} must fall back to the 'T' initial`
      );
      renderer.unmount();
    }
  }
);

test(
  'Avatar: whitespace-only url with whitespace-only name falls back to "?" (#290)',
  renderTestOptions,
  () => {
    const renderer = renderAvatar({ url: '   ', name: '   ' });
    assert.throws(
      () => renderer.root.findByType('Image' as any),
      'no Image must be mounted for whitespace-only url'
    );
    const texts = collectTexts(renderer.root);
    assert.equal(texts.join(''), '?', 'whitespace-only url and name must fall back to "?"');
    renderer.unmount();
  }
);

test(
  'Avatar: trims surrounding whitespace from a valid url used as the image source (#290)',
  renderTestOptions,
  () => {
    const renderer = renderAvatar({ url: '  https://example.com/avatar.png  ', name: 'Taylor' });
    const imageNode = renderer.root.findByType('Image' as any);
    assert.ok(imageNode, 'Image element must be rendered for a url with surrounding whitespace');
    assert.deepEqual(
      imageNode.props.source,
      { uri: 'https://example.com/avatar.png' },
      'surrounding whitespace must be trimmed from the resolved uri'
    );
    renderer.unmount();
  }
);

test('Avatar: applies custom size and scaled initial font size (#246)', renderTestOptions, () => {
  const customSize = 48;
  const renderer = renderAvatar({ name: 'Taylor', size: customSize });
  const textNode = renderer.root.findByType('Text' as any);
  const textStyle = flattenStyle(textNode.props.style);
  assert.equal(textStyle.fontSize, customSize * 0.45);

  const viewNode = renderer.root.findByType('View' as any);
  const viewStyle = flattenStyle(viewNode.props.style);
  assert.equal(viewStyle.width, customSize);
  assert.equal(viewStyle.height, customSize);
  assert.equal(viewStyle.borderRadius, customSize / 2);
  renderer.unmount();
});

test(
  'Avatar: clamps non-positive, NaN, infinite, or invalid size to default 32 (#358)',
  renderTestOptions,
  () => {
    const invalidSizes = [
      0,
      -10,
      NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '40',
      null,
      {},
    ];
    for (const badSize of invalidSizes) {
      // Test fallback View
      const fallbackRenderer = renderAvatar({ name: 'Taylor', size: badSize as any });
      const viewNode = fallbackRenderer.root.findByType('View' as any);
      const viewStyle = flattenStyle(viewNode.props.style);
      assert.equal(
        viewStyle.width,
        32,
        `bad size ${String(badSize)} must clamp fallback width to 32`
      );
      assert.equal(
        viewStyle.height,
        32,
        `bad size ${String(badSize)} must clamp fallback height to 32`
      );
      assert.equal(
        viewStyle.borderRadius,
        16,
        `bad size ${String(badSize)} must clamp fallback borderRadius to 16`
      );
      fallbackRenderer.unmount();

      // Test Image
      const imageRenderer = renderAvatar({
        url: 'https://example.com/avatar.png',
        name: 'Taylor',
        size: badSize as any,
      });
      const imageNode = imageRenderer.root.findByType('Image' as any);
      const imageStyle = flattenStyle(imageNode.props.style);
      assert.equal(
        imageStyle.width,
        32,
        `bad size ${String(badSize)} must clamp image width to 32`
      );
      assert.equal(
        imageStyle.height,
        32,
        `bad size ${String(badSize)} must clamp image height to 32`
      );
      assert.equal(
        imageStyle.borderRadius,
        16,
        `bad size ${String(badSize)} must clamp image borderRadius to 16`
      );
      imageRenderer.unmount();
    }
  }
);

test(
  'Avatar: exposes accessibilityRole="image" and computed accessibilityLabel (#358)',
  renderTestOptions,
  () => {
    // 1. Fallback view with name
    const namedFallback = renderAvatar({ name: 'Alex Morgan' });
    const viewNode1 = namedFallback.root.findByType('View' as any);
    assert.equal(viewNode1.props.accessible, true);
    assert.equal(viewNode1.props.accessibilityRole, 'image');
    assert.equal(viewNode1.props.accessibilityLabel, "Alex Morgan's avatar");
    namedFallback.unmount();

    // 2. Fallback view without name or with whitespace name
    const anonymousFallback = renderAvatar({ name: '   ' });
    const viewNode2 = anonymousFallback.root.findByType('View' as any);
    assert.equal(viewNode2.props.accessible, true);
    assert.equal(viewNode2.props.accessibilityRole, 'image');
    assert.equal(viewNode2.props.accessibilityLabel, 'User avatar');
    anonymousFallback.unmount();

    // 3. Fallback view with null name
    const nullFallback = renderAvatar({ name: null });
    const viewNode3 = nullFallback.root.findByType('View' as any);
    assert.equal(viewNode3.props.accessible, true);
    assert.equal(viewNode3.props.accessibilityRole, 'image');
    assert.equal(viewNode3.props.accessibilityLabel, 'User avatar');
    nullFallback.unmount();

    // 4. Image with name
    const namedImage = renderAvatar({ url: 'https://example.com/avatar.png', name: 'Jordan' });
    const imageNode1 = namedImage.root.findByType('Image' as any);
    assert.equal(imageNode1.props.accessible, true);
    assert.equal(imageNode1.props.accessibilityRole, 'image');
    assert.equal(imageNode1.props.accessibilityLabel, "Jordan's avatar");
    namedImage.unmount();

    // 5. Image without name
    const anonImage = renderAvatar({ url: 'https://example.com/avatar.png' });
    const imageNode2 = anonImage.root.findByType('Image' as any);
    assert.equal(imageNode2.props.accessible, true);
    assert.equal(imageNode2.props.accessibilityRole, 'image');
    assert.equal(imageNode2.props.accessibilityLabel, 'User avatar');
    anonImage.unmount();

    // 6. Custom accessibilityLabel overrides default
    const customFallback = renderAvatar({
      name: 'Jordan',
      accessibilityLabel: 'Author avatar photo',
    });
    const viewNode4 = customFallback.root.findByType('View' as any);
    assert.equal(viewNode4.props.accessible, true);
    assert.equal(viewNode4.props.accessibilityRole, 'image');
    assert.equal(viewNode4.props.accessibilityLabel, 'Author avatar photo');
    customFallback.unmount();

    const customImage = renderAvatar({
      url: 'https://example.com/avatar.png',
      accessibilityLabel: 'Profile picture of Jordan',
    });
    const imageNode3 = customImage.root.findByType('Image' as any);
    assert.equal(imageNode3.props.accessible, true);
    assert.equal(imageNode3.props.accessibilityRole, 'image');
    assert.equal(imageNode3.props.accessibilityLabel, 'Profile picture of Jordan');
    customImage.unmount();
  }
);
