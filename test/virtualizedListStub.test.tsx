import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { createFlatListStub, renderListComponent } from './helpers/virtualizedListStub';

test('renderListComponent returns null for falsy props', () => {
  assert.equal(renderListComponent(null), null);
  assert.equal(renderListComponent(undefined), null);
  assert.equal(renderListComponent(false), null);
});

test('renderListComponent returns React elements verbatim', () => {
  const element = React.createElement('div', { id: 'test-el' }, 'Hello Element');
  const result = renderListComponent(element);
  assert.equal(result, element);
});

test('renderListComponent instantiates component functions with React.createElement', () => {
  const Component = () => React.createElement('span', null, 'Hello Component');
  const result = renderListComponent(Component);
  assert.ok(React.isValidElement(result));
  assert.equal(result.type, Component);
});

test('FlatListStub renders element header and component footer with items', () => {
  const FlatList = createFlatListStub();
  const HeaderElement = React.createElement('h1', null, 'Header Title');
  const FooterComponent = () => React.createElement('footer', null, 'Footer Content');

  const renderer = TestRenderer.create(
    React.createElement(FlatList, {
      data: [
        { id: '1', title: 'Row 1' },
        { id: '2', title: 'Row 2' },
      ],
      keyExtractor: (item: any) => item.id,
      renderItem: ({ item }: any) => React.createElement('p', null, item.title),
      ListHeaderComponent: HeaderElement,
      ListFooterComponent: FooterComponent,
      ListEmptyComponent: () => React.createElement('div', null, 'Should Not Render'),
    })
  );

  const json = renderer.toJSON();
  // Header, 2 items, footer
  assert.ok(json);
  const root = renderer.root;
  assert.equal(root.findByType('h1').children[0], 'Header Title');
  assert.equal(root.findByType('footer').children[0], 'Footer Content');
  const paragraphs = root.findAllByType('p');
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].children[0], 'Row 1');
  assert.equal(paragraphs[1].children[0], 'Row 2');
  // ListEmptyComponent must NOT be rendered when data is non-empty
  assert.equal(root.findAllByType('div').length, 0);
});

test('FlatListStub renders component header and ListEmptyComponent when data is empty', () => {
  const FlatList = createFlatListStub();
  const HeaderComponent = () => React.createElement('header', null, 'Component Header');
  const EmptyComponent = () =>
    React.createElement('span', { className: 'empty' }, 'No items found');

  const renderer = TestRenderer.create(
    React.createElement(FlatList, {
      data: [],
      renderItem: ({ item }: any) => React.createElement('p', null, item.title),
      ListHeaderComponent: HeaderComponent,
      ListEmptyComponent: EmptyComponent,
    })
  );

  const root = renderer.root;
  assert.equal(root.findByType('header').children[0], 'Component Header');
  assert.equal(root.findByType('span').children[0], 'No items found');
  assert.equal(root.findAllByType('p').length, 0);
});

test('FlatListStub handles null/undefined data by rendering ListEmptyComponent element', () => {
  const FlatList = createFlatListStub();
  const EmptyElement = React.createElement('span', null, 'Empty fallback');

  const renderer = TestRenderer.create(
    React.createElement(FlatList, {
      data: null,
      ListEmptyComponent: EmptyElement,
    })
  );

  const root = renderer.root;
  assert.equal(root.findByType('span').children[0], 'Empty fallback');
});
