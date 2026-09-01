import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useCupThreadTheme, useCupThreadClient } from '../theme/CupThreadThemeProvider.tsx';
import type { ChangelogEntry, ChangelogOverlayConfig } from '../types/index.ts';
import { Badge } from './Badge.tsx';
import { MarkdownText } from './MarkdownText.tsx';

export interface ChangelogOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export function ChangelogOverlay({ visible, onClose }: ChangelogOverlayProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();

  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [config, setConfig] = useState<ChangelogOverlayConfig>({
    title: "What's New",
    subtitle: '',
    entryCount: 3,
    primaryButton: 'Continue',
    closeButton: 'Close',
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!visible) return;

    let isMounted = true;
    setIsLoading(true);

    client
      .prepareChangelogOverlay()
      .then((res) => {
        if (!isMounted) return;
        if (res) {
          setEntries(res.entries);
          if (res.appearance.changelogOverlay) {
            setConfig(res.appearance.changelogOverlay);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [client, visible]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{config.title}</Text>
            {config.subtitle ? (
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                {config.subtitle}
              </Text>
            ) : null}
          </View>

          {isLoading ? (
            <View style={styles.loadingArea}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.content}>
              {entries.map((item) => (
                <View
                  key={item.id}
                  style={[styles.entryCard, { borderColor: colors.border }]}
                >
                  <View style={styles.entryHeader}>
                    <Text style={[styles.entryTitle, { color: colors.textPrimary }]}>
                      {item.title}
                    </Text>
                    {item.versionLabel && (
                      <Badge label={`v${item.versionLabel}`} variant="outline" />
                    )}
                  </View>
                  <MarkdownText content={item.body} />
                </View>
              ))}
            </ScrollView>
          )}

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.8}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryText }]}>
                {config.primaryButton || 'Continue'}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  entryCard: {
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  entryTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    paddingRight: 8,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  loadingArea: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
