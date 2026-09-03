import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  ChangelogOverlay,
  CupThreadProvider,
  FeatureRequestsScreen,
  FeedbackClient,
  FeedbackComposer,
  RoadmapBoardScreen,
  WhatsNewScreen,
} from '@cupthread/react-native';
import { installDemoFetch } from './demoFetch';

installDemoFetch();

type Screen = 'roadmap' | 'requests' | 'whats-new' | 'feedback';

function screenFromUrl(url: string | null): { screen: Screen; overlay: boolean; compose: boolean } {
  const params = new URL(url ?? 'cupthread-showcase://?screen=roadmap').searchParams;
  const requested = params.get('screen');
  return {
    screen: requested === 'requests' || requested === 'whats-new' || requested === 'feedback'
      ? requested
      : 'roadmap',
    overlay: params.get('overlay') === 'changelog',
    compose: params.get('compose') === 'feature-request',
  };
}

export default function App() {
  const client = useMemo(
    () => new FeedbackClient({ baseUrl: 'https://demo.cupthread.invalid', appKey: 'app_showcase' }),
    []
  );
  const initial = screenFromUrl(Linking.useURL());
  const [screen, setScreen] = useState<Screen>(initial.screen);
  const [showOverlay, setShowOverlay] = useState(initial.overlay);
  const [showFeedback, setShowFeedback] = useState(initial.screen === 'feedback');
  const [composeKey, setComposeKey] = useState(initial.compose ? 1 : 0);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const next = screenFromUrl(url);
      setScreen(next.screen);
      setShowOverlay(next.overlay);
      setShowFeedback(next.screen === 'feedback');
      if (next.compose) setComposeKey((key) => key + 1);
    });
    return () => subscription.remove();
  }, []);

  return (
    <CupThreadProvider client={client} theme="ocean" userToken="showcase-user">
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.content}>
          {screen === 'roadmap' && <RoadmapBoardScreen />}
          {screen === 'requests' && (
            <FeatureRequestsScreen key={composeKey} />
          )}
          {screen === 'whats-new' && <WhatsNewScreen />}
          {screen === 'feedback' && (
            <View style={styles.feedbackPrompt}>
              <Text style={styles.feedbackTitle}>Help us improve</Text>
              <Text style={styles.feedbackBody}>Share feedback, report a problem, or suggest an improvement.</Text>
              <Pressable style={styles.feedbackButton} onPress={() => setShowFeedback(true)}>
                <Text style={styles.feedbackButtonText}>Send feedback</Text>
              </Pressable>
            </View>
          )}
        </View>
        <View style={styles.tabBar}>
          {([
            ['roadmap', 'Roadmap'],
            ['requests', 'Requests'],
            ['whats-new', "What's New"],
            ['feedback', 'Feedback'],
          ] as const).map(([value, label]) => (
            <Pressable key={value} onPress={() => setScreen(value)} style={styles.tab}>
              <Text style={[styles.tabLabel, screen === value && styles.activeTabLabel]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ChangelogOverlay visible={showOverlay} onClose={() => setShowOverlay(false)} autoMarkSeen={false} />
      <FeedbackComposer
        visible={showFeedback}
        onClose={() => setShowFeedback(false)}
        initialDraft={{
          title: 'Export roadmap updates',
          description: 'A weekly CSV or PDF export would make it easier to share customer feedback with the team.',
          reporterName: 'Alex Developer',
          reporterEmail: 'alex@example.com',
        }}
      />
    </CupThreadProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7fbff' },
  content: { flex: 1 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#dbeafe', backgroundColor: '#ffffff' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabLabel: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  activeTabLabel: { color: '#0d9488' },
  feedbackPrompt: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  feedbackTitle: { color: '#0f172a', fontSize: 26, fontWeight: '700' },
  feedbackBody: { color: '#475569', fontSize: 16, lineHeight: 24, marginTop: 12, textAlign: 'center' },
  feedbackButton: { backgroundColor: '#0d9488', borderRadius: 10, marginTop: 24, paddingHorizontal: 20, paddingVertical: 13 },
  feedbackButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
