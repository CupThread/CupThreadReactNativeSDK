import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import {
  InactiveSubscriptionException,
  PaymentRequiredException,
  QuotaExceededException,
  TurnstileRequiredException,
} from '../client/FeedbackException';
import type { FeatureRequestDraft, FeatureRequestSubmissionResult } from '../types';
import {
  createFeatureRequestComposeState,
  resetFeatureRequestComposeState,
} from '../utils/composer-state';
import { userFacingErrorMessage } from '../utils/errors';
import { resolveEffectiveUserToken } from '../utils/userToken';

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

  /**
   * Whether the sheet itself surfaces the localized success / moderation
   * notice after a successful submission (the notice reflects
   * `result.pending`). Defaults to `true` so submissions are never silent;
   * set to `false` when the host fully owns post-submit feedback.
   *
   * @defaultValue `true`
   */
  showSuccessFeedback?: boolean;

  /**
   * Whether to preserve entered draft state when the sheet is closed without submitting.
   * When `false` (default), dismissing or reopening the sheet resets the form to `initialDraft`.
   *
   * @defaultValue `false`
   */
  preserveDraftOnClose?: boolean;
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
  showSuccessFeedback = true,
  preserveDraftOnClose = false,
}: FeatureRequestComposeSheetProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();
  const isTokenReady = useCupThreadTokenReadiness();
  const strings = useCupThreadStrings();

  const initialState = createFeatureRequestComposeState(initialDraft);
  const [title, setTitle] = useState(initialState.title);
  const [description, setDescription] = useState(initialState.description);
  const [requesterName, setRequesterName] = useState(initialState.requesterName);
  const [isSubmitting, setIsSubmitting] = useState(initialState.isSubmitting);
  const isSubmittingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialState.errorMessage);

  const resetForm = useCallback((draft?: Partial<FeatureRequestDraft>) => {
    const fresh = resetFeatureRequestComposeState(draft);
    setTitle(fresh.title);
    setDescription(fresh.description);
    setRequesterName(fresh.requesterName);
    setIsSubmitting(fresh.isSubmitting);
    setErrorMessage(fresh.errorMessage);
  }, []);

  const prevVisibleRef = useRef(visible);
  const prevInitialDraftRef = useRef(initialDraft);
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    if (!wasVisible && visible) {
      const draftChanged = initialDraft !== prevInitialDraftRef.current;
      const shouldReset = !preserveDraftOnClose || hasSubmittedRef.current || draftChanged;
      if (shouldReset) {
        resetForm(initialDraft);
        hasSubmittedRef.current = false;
      } else {
        setErrorMessage(null);
        setIsSubmitting(false);
      }
      prevInitialDraftRef.current = initialDraft;
    }
    prevVisibleRef.current = visible;
  }, [visible, preserveDraftOnClose, initialDraft, resetForm]);

  const handleClose = useCallback(() => {
    if (!preserveDraftOnClose) {
      resetForm(initialDraft);
    }
    if (onClose) onClose();
  }, [preserveDraftOnClose, initialDraft, resetForm, onClose]);

  const handleSubmit = async () => {
    if (isSubmittingRef.current) return;
    if (!isTokenReady) return;
    if (title.trim().length < 3) {
      setErrorMessage(strings.featureRequestCompose.titleMinLengthError);
      return;
    }
    if (description.trim().length < 5) {
      setErrorMessage(strings.featureRequestCompose.descriptionMinLengthError);
      return;
    }

    isSubmittingRef.current = true;
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const draft: FeatureRequestDraft = {
        title: title.trim(),
        description: description.trim(),
        requesterName: requesterName.trim() || undefined,
      };

      const effectiveToken = await resolveEffectiveUserToken(userToken);
      const result = await client.submitFeatureRequest(draft, effectiveToken);
      hasSubmittedRef.current = true;
      resetForm(initialDraft);

      // Surface the outcome even when a host provides `onSubmitSuccess`:
      // pending-moderation submissions are absent from the reloaded list, so
      // a silent close reads as a failed submission. Hosts opt out via
      // `showSuccessFeedback={false}`.
      if (showSuccessFeedback) {
        const msg = result.pending
          ? strings.featureRequestCompose.moderationNotice
          : strings.featureRequestCompose.successMessage;
        Alert.alert(strings.featureRequestCompose.successTitle, msg);
      }

      if (onSubmitSuccess) {
        onSubmitSuccess(result);
      } else if (onClose) {
        onClose();
      }
    } catch (err: any) {
      if (err instanceof TurnstileRequiredException) {
        // The draft stays intact so the user can retry after the host's
        // verification flow resolves a fresh token.
        setErrorMessage(strings.common.verificationRequired);
      } else if (err instanceof QuotaExceededException) {
        setErrorMessage(strings.common.quotaExceeded || err.message);
      } else if (err instanceof InactiveSubscriptionException) {
        setErrorMessage(strings.common.subscriptionInactive || err.message);
      } else if (err instanceof PaymentRequiredException) {
        setErrorMessage(err.message || strings.featureRequestCompose.submitFailed);
      } else {
        setErrorMessage(
          userFacingErrorMessage(err, strings.featureRequestCompose.submitFailed, strings.common)
        );
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const content = (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {strings.featureRequestCompose.modalTitle}
        </Text>
        {onClose && (
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={strings.common.close}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {errorMessage && (
        <View
          style={[
            styles.errorBox,
            { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
          ]}
        >
          <Text style={{ color: colors.danger, fontSize: 13 }}>{errorMessage}</Text>
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
        accessibilityRole="button"
        accessibilityState={{ disabled: isSubmitting || !isTokenReady }}
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
      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={handleClose}
        accessibilityViewIsModal={true}
      >
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
