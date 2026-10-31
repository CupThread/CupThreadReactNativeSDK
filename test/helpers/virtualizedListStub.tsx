import React from 'react';

/**
 * Renders a list-component prop exactly like React Native's VirtualizedList
 * (@react-native/virtualized-lists/Lists/VirtualizedList.js:909-914):
 * an element prop is rendered verbatim, while a component prop is instantiated
 * via `React.createElement(...)`.
 */
export function renderListComponent(prop: unknown): React.ReactElement | null {
  if (!prop) return null;
  return React.isValidElement(prop) ? prop : React.createElement(prop as any);
}

export interface FlatListStubProps {
  data?: any[] | null;
  renderItem?: (info: {
    item: any;
    index: number;
    separators: Record<string, any>;
  }) => React.ReactElement | null;
  keyExtractor?: (item: any, index: number) => string;
  ListHeaderComponent?: any;
  ListFooterComponent?: any;
  ListEmptyComponent?: any;
  [key: string]: any;
}

/**
 * Creates a FlatList stub mirroring VirtualizedList semantics:
 * - ListHeaderComponent: element verbatim, component wrapped via createElement
 * - data items: mapped through renderItem when data is a non-empty array
 * - ListEmptyComponent: element verbatim, component wrapped via createElement when data is absent or empty
 * - ListFooterComponent: element verbatim, component wrapped via createElement
 */
export function createFlatListStub() {
  return function FlatListStub({
    data,
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
  }: FlatListStubProps): React.ReactElement {
    const hasData = Array.isArray(data) && data.length > 0;
    const items =
      hasData && renderItem
        ? data.map((item: any, index: number) =>
            React.createElement(
              React.Fragment,
              { key: keyExtractor ? keyExtractor(item, index) : (item?.id ?? String(index)) },
              renderItem({ item, index, separators: {} })
            )
          )
        : [];

    return React.createElement(
      React.Fragment,
      null,
      renderListComponent(ListHeaderComponent),
      hasData ? items : renderListComponent(ListEmptyComponent),
      renderListComponent(ListFooterComponent)
    );
  };
}
