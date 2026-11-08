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
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { Badge } = await import('../src/components/Badge');
const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { lightTheme, darkTheme } = await import('../src/theme/SdkTheme');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

function makeClient(): FeedbackClient {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_badge',
  });
  client.fetchAppConfig = (async () => ({})) as any;
  return client;
}

function renderBadge(props: any, theme?: 'light' | 'dark'): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client: makeClient(),
        ...(theme ? { theme } : {}),
        children: React.createElement(Badge, props),
      })
    );
  });
  return renderer;
}

test(
  'Badge: variant="subtle" with 6-digit hex color renders semi-transparent background and colored text (#248)',
  renderTestOptions,
  () => {
    const renderer = renderBadge({
      label: 'Planned',
      color: '#3b82f6',
      variant: 'subtle',
    });

    const view = renderer.root.findByType(ViewStub as any);
    const viewStyle = flattenStyle(view.props.style);
    assert.equal(
      viewStyle.backgroundColor,
      '#3b82f620',
      'subtle variant must append 20 alpha to 6-digit hex'
    );
    assert.equal(viewStyle.borderWidth, 0, 'subtle variant should have borderWidth of 0');

    const text = renderer.root.findByType(TextStub as any);
    const textStyle = flattenStyle(text.props.style);
    assert.equal(textStyle.color, '#3b82f6', 'subtle variant must color text with the hex color');
    assert.equal(text.props.children, 'Planned');

    renderer.unmount();
  }
);

test(
  'Badge: variant="default" with 6-digit hex renders solid background and contrasting text (#248)',
  renderTestOptions,
  () => {
    const renderer = renderBadge({
      label: 'Shipped',
      color: '#3b82f6',
      variant: 'default',
    });

    const view = renderer.root.findByType(ViewStub as any);
    const viewStyle = flattenStyle(view.props.style);
    assert.equal(
      viewStyle.backgroundColor,
      '#3b82f6',
      'default variant must render solid background'
    );
    assert.equal(viewStyle.borderWidth, 0);

    const text = renderer.root.findByType(TextStub as any);
    const textStyle = flattenStyle(text.props.style);
    assert.equal(
      textStyle.color,
      lightTheme.primaryText,
      'default variant on dark background must render contrasting primaryText'
    );
    assert.equal(text.props.children, 'Shipped');

    renderer.unmount();
  }
);

test(
  'Badge: variant="default" with light background renders dark contrasting text (#248)',
  renderTestOptions,
  () => {
    const renderer = renderBadge({
      label: 'Warning',
      color: '#ffff00',
      variant: 'default',
    });

    const view = renderer.root.findByType(ViewStub as any);
    const viewStyle = flattenStyle(view.props.style);
    assert.equal(viewStyle.backgroundColor, '#ffff00');

    const text = renderer.root.findByType(TextStub as any);
    const textStyle = flattenStyle(text.props.style);
    assert.equal(
      textStyle.color,
      '#0f172a',
      'default variant on light background must render dark contrasting text'
    );

    renderer.unmount();
  }
);

test(
  'Badge: variant="default" with light background in dark theme renders dark contrasting text (#248)',
  renderTestOptions,
  () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client: makeClient(),
          theme: 'dark',
          children: React.createElement(Badge, {
            label: 'Warning Dark',
            color: '#ffff00',
            variant: 'default',
          }),
        })
      );
    });

    const view = renderer.root.findByType(ViewStub as any);
    const viewStyle = flattenStyle(view.props.style);
    assert.equal(viewStyle.backgroundColor, '#ffff00');

    const text = renderer.root.findByType(TextStub as any);
    const textStyle = flattenStyle(text.props.style);
    assert.equal(
      textStyle.color,
      '#0f172a',
      'light fill in dark mode must not use light textPrimary (#f8fafc), must remain dark #0f172a'
    );

    renderer.unmount();
  }
);

test(
  'Badge: variant="default" without custom color defaults to primary and primaryText (#248)',
  renderTestOptions,
  () => {
    const renderer = renderBadge({
      label: 'Core',
      variant: 'default',
    });

    const view = renderer.root.findByType(ViewStub as any);
    const viewStyle = flattenStyle(view.props.style);
    assert.equal(
      viewStyle.backgroundColor,
      lightTheme.primary,
      'default variant without color must fall back to theme primary'
    );

    const text = renderer.root.findByType(TextStub as any);
    const textStyle = flattenStyle(text.props.style);
    assert.equal(
      textStyle.color,
      lightTheme.primaryText,
      'default variant without color must use primaryText'
    );

    renderer.unmount();
  }
);

test(
  'Badge: variant="outline" renders transparent background with border (#248)',
  renderTestOptions,
  () => {
    const renderer = renderBadge({
      label: 'v1.4.0',
      color: '#3b82f6',
      variant: 'outline',
    });

    const view = renderer.root.findByType(ViewStub as any);
    const viewStyle = flattenStyle(view.props.style);
    assert.equal(viewStyle.backgroundColor, 'transparent');
    assert.equal(viewStyle.borderColor, '#3b82f6');
    assert.equal(viewStyle.borderWidth, 1);

    const text = renderer.root.findByType(TextStub as any);
    const textStyle = flattenStyle(text.props.style);
    assert.equal(textStyle.color, '#3b82f6');

    renderer.unmount();
  }
);

test(
  'Badge: variant="outline" without custom color uses theme border and chipText (#248)',
  renderTestOptions,
  () => {
    const renderer = renderBadge({
      label: 'v2.0.0',
      variant: 'outline',
    });

    const view = renderer.root.findByType(ViewStub as any);
    const viewStyle = flattenStyle(view.props.style);
    assert.equal(viewStyle.backgroundColor, 'transparent');
    assert.equal(viewStyle.borderColor, lightTheme.border);
    assert.equal(viewStyle.borderWidth, 1);

    const text = renderer.root.findByType(TextStub as any);
    const textStyle = flattenStyle(text.props.style);
    assert.equal(textStyle.color, lightTheme.chipText);

    renderer.unmount();
  }
);

test('Badge: expands 3-digit hex color correctly (#248)', renderTestOptions, () => {
  const renderer = renderBadge({
    label: 'Expanded',
    color: '#09f',
    variant: 'subtle',
  });

  const view = renderer.root.findByType(ViewStub as any);
  const viewStyle = flattenStyle(view.props.style);
  assert.equal(
    viewStyle.backgroundColor,
    '#0099ff20',
    '3-digit hex #09f must expand to #0099ff before appending alpha suffix'
  );

  const text = renderer.root.findByType(TextStub as any);
  const textStyle = flattenStyle(text.props.style);
  assert.equal(textStyle.color, '#0099ff');

  renderer.unmount();
});

test('Badge: expands 3-digit hex color for default variant (#248)', renderTestOptions, () => {
  const renderer = renderBadge({
    label: 'Expanded Solid',
    color: '#09f',
    variant: 'default',
  });

  const view = renderer.root.findByType(ViewStub as any);
  const viewStyle = flattenStyle(view.props.style);
  assert.equal(viewStyle.backgroundColor, '#0099ff');

  const text = renderer.root.findByType(TextStub as any);
  const textStyle = flattenStyle(text.props.style);
  assert.equal(textStyle.color, lightTheme.primaryText);

  renderer.unmount();
});

test(
  'Badge: 8-digit hex color normalizes correctly for subtle variant (#248)',
  renderTestOptions,
  () => {
    const renderer = renderBadge({
      label: 'Hex8',
      color: '#3b82f6ff',
      variant: 'subtle',
    });

    const view = renderer.root.findByType(ViewStub as any);
    const viewStyle = flattenStyle(view.props.style);
    assert.equal(
      viewStyle.backgroundColor,
      '#3b82f620',
      '8-digit hex must not produce 10-digit invalid hex'
    );

    renderer.unmount();
  }
);

test(
  'Badge: named CSS color does not produce invalid color concatenation (#248)',
  renderTestOptions,
  () => {
    const renderer = renderBadge({
      label: 'Named',
      color: 'blue',
      variant: 'subtle',
    });

    const view = renderer.root.findByType(ViewStub as any);
    const viewStyle = flattenStyle(view.props.style);
    assert.equal(
      viewStyle.backgroundColor,
      lightTheme.chipBg,
      'named CSS color must fall back to chipBg rather than appending 20'
    );

    const text = renderer.root.findByType(TextStub as any);
    const textStyle = flattenStyle(text.props.style);
    assert.equal(textStyle.color, 'blue');

    renderer.unmount();
  }
);

test('Badge: whitespace-only color is safely ignored (#248)', renderTestOptions, () => {
  const renderer = renderBadge({
    label: 'Whitespace Color',
    color: '   ',
    variant: 'subtle',
  });

  const view = renderer.root.findByType(ViewStub as any);
  const viewStyle = flattenStyle(view.props.style);
  assert.equal(
    viewStyle.backgroundColor,
    lightTheme.chipBg,
    'whitespace color must not produce "   20"'
  );

  const text = renderer.root.findByType(TextStub as any);
  const textStyle = flattenStyle(text.props.style);
  assert.equal(textStyle.color, lightTheme.chipText);

  renderer.unmount();
});

test('Badge: empty and whitespace-only labels return null (#248)', renderTestOptions, () => {
  const emptyRenderer = renderBadge({ label: '' });
  assert.equal(emptyRenderer.toJSON(), null, 'empty label must render null');

  const whitespaceRenderer = renderBadge({ label: '   ' });
  assert.equal(whitespaceRenderer.toJSON(), null, 'whitespace-only label must render null');

  const trimmedRenderer = renderBadge({ label: '  Trimmed  ' });
  const text = trimmedRenderer.root.findByType(TextStub as any);
  assert.equal(text.props.children, 'Trimmed');
});

test(
  'Badge: handles non-string truthy color prop gracefully without throwing TypeError (#301)',
  renderTestOptions,
  () => {
    const nonStringColors = [12345, 0x3b82f6, true, false, {}, [], () => {}, Symbol('color')];

    for (const invalidColor of nonStringColors) {
      for (const variant of ['subtle', 'outline', 'default'] as const) {
        for (const mode of ['light', 'dark'] as const) {
          const expectedTheme = mode === 'dark' ? darkTheme : lightTheme;
          const renderer = renderBadge(
            {
              label: 'Safe Badge',
              color: invalidColor as any,
              variant,
            },
            mode
          );

          assert.ok(
            renderer.toJSON(),
            `Badge with non-string color (${typeof invalidColor}), variant ${variant}, and theme ${mode} should render`
          );
          const text = renderer.root.findByType(TextStub as any);
          assert.equal(text.props.children, 'Safe Badge');

          const view = renderer.root.findByType(ViewStub as any);
          const viewStyle = flattenStyle(view.props.style);
          const textStyle = flattenStyle(text.props.style);

          if (variant === 'subtle') {
            assert.equal(viewStyle.backgroundColor, expectedTheme.chipBg);
            assert.equal(textStyle.color, expectedTheme.chipText);
          } else if (variant === 'outline') {
            assert.equal(viewStyle.backgroundColor, 'transparent');
            assert.equal(viewStyle.borderColor, expectedTheme.border);
            assert.equal(textStyle.color, expectedTheme.chipText);
          } else if (variant === 'default') {
            assert.equal(viewStyle.backgroundColor, expectedTheme.primary);
            assert.equal(textStyle.color, expectedTheme.primaryText);
          }

          renderer.unmount();
        }
      }
    }
  }
);
