import React, { useState, useEffect, useRef } from 'react';
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
import {
  useCupThreadTheme,
  useCupThreadClient,
  useCupThreadStrings,
} from '../theme/CupThreadThemeProvider';
import type { ChangelogEntry, ChangelogOverlayConfig } from '../types';
import { UserTokenStore } from '../client/UserTokenStore';
import { Badge } from './Badge';
import { MarkdownText } from './MarkdownText';

/**
 * Props for configuring the {@link ChangelogOverlay} modal sheet.
 */
export interface ChangelogOverlayProps {
  /**
   * Whether the modal sheet is currently visible.
   */
  visible: boolean;

  /**
   * Callback invoked when the user dismisses the overlay.
   */
  onClose: () => void;

  /**
   * Whether to automatically mark the latest changelog entry as seen when dismissed.
   *
   * @defaultValue `true`
   */
  autoMarkSeen?: boolean;

  /**
   * If `true`, the overlay will not display if the latest version was already seen by the user.
   *
   * @defaultValue `false`
   */
  onlyIfUnseen?: boolean;
}

export function ChangelogOverlay({
  visible,
  onClose,
  autoMarkSeen = true,
  onlyIfUnseen = false,
}: ChangelogOverlayProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const strings = useCupThreadStrings();

  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [latestKey, setLatestKey] = useState<string | null>(null);
  const [config, setConfig] = useState<ChangelogOverlayConfig>({
    title: strings.changelog.overlayTitle,
    subtitle: '',
    entryCount: 3,
    primaryButton: strings.changelog.continueButton,
    closeButton: strings.changelog.closeButton,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // The dismiss callback is read through a ref so parent-supplied inline
  // closures don't re-trigger the changelog fetch on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!visible) return;

    const controller = new AbortController();
    let isMounted = true;
    setIsLoading(true);

    client
      .prepareChangelogOverlay({ onlyIfUnseen, signal: controller.signal })
      .then((res) => {
        if (!isMounted || controller.signal.aborted) return;
        if (!res) {
          if (onlyIfUnseen) {
            onCloseRef.current();
          }
          return;
        }
        setEntries(res.entries);
        setLatestKey(res.latestKey);
        if (res.appearance.changelogOverlay) {
          setConfig(res.appearance.changelogOverlay);
        }
      })
      .catch((err: any) => {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
      })
      .finally(() => {
        if (isMounted && !controller.signal.aborted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [client, visible, onlyIfUnseen]);

  const handleDismiss = async () => {
    if (autoMarkSeen && latestKey) {
      try {
        await UserTokenStore.shared.markChangelogSeen(latestKey);
      } catch {
        // ignore
      }
    }
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <SafeAreaView style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleDismiss} style={styles.closeBtn}>
              <Text style={{ color: colors.textSecondary, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {config.title || strings.changelog.overlayTitle}
            </Text>
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
              onPress={handleDismiss}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.8}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryText }]}>
                {config.primaryButton || strings.changelog.continueButton}
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
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    top: 16,
    zIndex: 1,
    padding: 6,
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
