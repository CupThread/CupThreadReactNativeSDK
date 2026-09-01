import type { FeedbackPlatform } from '../types/index.ts';

export function getRuntimePlatform(): FeedbackPlatform {
  try {
    // Dynamically check React Native Platform if running in RN runtime
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
