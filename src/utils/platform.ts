import type { FeedbackPlatform } from '../types';

export function getRuntimePlatform(): FeedbackPlatform {
  try {
    // Dynamically check React Native Platform if running in RN runtime.
    // A runtime require is deliberate: a static import would make this module
    // (and everything transitively importing it) fail to load in plain Node
    // environments where the react-native peer dependency is absent.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native');
    if (Platform && Platform.OS) {
      switch (Platform.OS) {
        case 'ios':
          return 'ios';
        case 'macos':
          return 'macos';
        case 'android':
          return 'android';
        case 'web':
          return 'web';
        default:
          return 'universal';
      }
    }
  } catch {
    // Ignore runtime resolution failure
  }
  return 'universal';
}

export const FeedbackPlatformUtil = {
  get current(): FeedbackPlatform {
    return getRuntimePlatform();
  },
  fromWire(value: string): FeedbackPlatform | undefined {
    const valid: FeedbackPlatform[] = ['ios', 'macos', 'android', 'universal', 'web'];
    return valid.includes(value as FeedbackPlatform) ? (value as FeedbackPlatform) : undefined;
  },
};
