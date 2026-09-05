import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  ScrollView,
  Modal,
  SafeAreaView,
} from 'react-native';
import {
  useCupThreadTheme,
  useCupThreadClient,
  useCupThreadUserToken,
  useCupThreadTokenReadiness,
  useCupThreadStrings,
} from '../theme/CupThreadThemeProvider';
import { UserTokenStore } from '../client/UserTokenStore';
import type { FeatureRequestDraft, FeatureRequestSubmissionResult } from '../types';

/**
 * Props for configuring the {@link FeatureRequestComposeSheet} modal or embedded form.
 */
export interface FeatureRequestComposeSheetProps {
  /**
   * Whether the modal dialog is currently visible (when `isModal` is `true`).
   *
   * @defaultValue `true`
   */
  visible?: boolean;

  /**
   * Callback invoked when the user dismisses the sheet without submitting.
   */
  onClose?: () => void;

  /**
   * Callback invoked when the feature request is successfully submitted to the server.
   */
  onSubmitSuccess?: (result: FeatureRequestSubmissionResult) => void;

  /**
   * Pre-filled initial values for the feature request proposal.
   */
  initialDraft?: Partial<FeatureRequestDraft>;

  /**
   * Whether to wrap the form in a native React Native full-screen `<Modal>`.
   * Set to `false` when embedding directly in an existing screen layout.
   *
   * @defaultValue `true`
   */
  isModal?: boolean;
}

/**
 * Dedicated modal sheet for proposing new public feature requests.
 *
 * @remarks
 * Collects title, description, and optional author name, then correctly
 * dispatches to `client.submitFeatureRequest(draft, userToken)` (POST `/api/v1/feature-requests`).
 */
export function FeatureRequestComposeSheet({
  visible = true,
  onClose,
  onSubmitSuccess,
  initialDraft,
  isModal = true,
}: FeatureRequestComposeSheetProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();
  const isTokenReady = useCupThreadTokenReadiness();
  const strings = useCupThreadStrings();

  const [title, setTitle] = useState(initialDraft?.title || '');
  const [description, setDescription] = useState(initialDraft?.description || '');
  const [requesterName, setRequesterName] = useState(initialDraft?.requesterName || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!isTokenReady) return;
    if (title.trim().length < 3) {
      setErrorMessage(strings.featureRequestCompose.titleMinLengthError);
      return;
    }
    if (description.trim().length < 5) {
      setErrorMessage(strings.featureRequestCompose.descriptionMinLengthError);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const draft: FeatureRequestDraft = {
        title: title.trim(),
        description: description.trim(),
        requesterName: requesterName.trim() || undefined,
      };

      const effectiveToken = userToken || (await UserTokenStore.shared.getToken());
      const result = await client.submitFeatureRequest(draft, effectiveToken);
      setIsSubmitting(false);

      if (onSubmitSuccess) {
        onSubmitSuccess(result);
      } else {
        const msg = result.pending
          ? strings.featureRequestCompose.moderationNotice
          : strings.featureRequestCompose.successMessage;
        Alert.alert(strings.featureRequestCompose.successTitle, msg);
        if (onClose) onClose();
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMessage(err?.message || 'Failed to submit feature proposal. Please try again.');
    }
  };

  const content = (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {strings.featureRequestCompose.modalTitle}
        </Text>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={{ color: colors.textSecondary, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {errorMessage && (
        <View style={[styles.errorBox, { backgroundColor: '#fef2f2', borderColor: '#fca5a5' }]}>
          <Text style={{ color: '#b91c1c', fontSize: 13 }}>{errorMessage}</Text>
        </View>
      )}

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {strings.featureRequestCompose.titleLabel}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
            color: colors.textPrimary,
          },
        ]}
        placeholder={strings.featureRequestCompose.titlePlaceholder}
        placeholderTextColor={colors.textMuted}
        value={title}
        onChangeText={setTitle}
        maxLength={120}
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {strings.featureRequestCompose.descriptionLabel}
      </Text>
      <TextInput
        style={[
          styles.input,
          styles.textArea,
          {
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
            color: colors.textPrimary,
          },
        ]}
        placeholder={strings.featureRequestCompose.descriptionPlaceholder}
        placeholderTextColor={colors.textMuted}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {strings.featureRequestCompose.nameLabel}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
            color: colors.textPrimary,
          },
        ]}
        placeholder={strings.featureRequestCompose.namePlaceholder}
        placeholderTextColor={colors.textMuted}
        value={requesterName}
        onChangeText={setRequesterName}
      />

      <TouchableOpacity
        activeOpacity={0.8}
        disabled={isSubmitting || !isTokenReady}
        onPress={handleSubmit}
        style={[
          styles.submitBtn,
          {
            backgroundColor: colors.primary,
            opacity: isSubmitting || !isTokenReady ? 0.6 : 1,
          },
        ]}
      >
        {isSubmitting ? (
          <ActivityIndicator color={colors.primaryText} size="small" />
        ) : (
          <Text style={[styles.submitText, { color: colors.primaryText }]}>
            {strings.featureRequestCompose.submitButton}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );

  if (isModal) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          {content}
        </SafeAreaView>
      </Modal>
    );
  }

  return <View style={[styles.container, { backgroundColor: colors.background }]}>{content}</View>;
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
  },
  errorBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: {
    minHeight: 120,
  },
  submitBtn: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
