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
import type { FeedbackAttachment, FeedbackDraft, FeedbackSubmissionResult } from '../types';
import type { UploadAttachmentOptions } from '../client/FeedbackClient';
import { formatFileSize } from '../utils/formatters';

/**
 * Props for configuring the {@link FeedbackComposer} form sheet or embedded component.
 *
 * @example
 * ```tsx
 * <FeedbackComposer
 *   visible={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   onSubmitSuccess={(result) => {
 *     console.log('Submitted:', result.submissionId);
 *     setIsOpen(false);
 *   }}
 *   initialDraft={{ title: 'Report issue' }}
 *   onPickAttachment={async () => {
 *     const file = await pickImage();
 *     return file ? { file: { uri: file.uri }, filename: file.name, mimeType: 'image/jpeg' } : null;
 *   }}
 *   isModal={true}
 * />
 * ```
 */
export interface FeedbackComposerProps {
  /**
   * Whether the modal dialog is currently visible (when `isModal` is `true`).
   *
   * @defaultValue `true`
   */
  visible?: boolean;

  /**
   * Callback invoked when the user dismisses the composer without submitting.
   */
  onClose?: () => void;

  /**
   * Callback invoked when feedback is successfully submitted to the server.
   */
  onSubmitSuccess?: (result: FeedbackSubmissionResult) => void;

  /**
   * Pre-filled feedback fields (e.g. category, metadata, or screenshot attachments).
   */
  initialDraft?: Partial<FeedbackDraft>;

  /**
   * Custom attachment picker handler.
   * Allows host applications to trigger their preferred file/image picker (e.g. Expo ImagePicker,
   * react-native-document-picker) and return either pre-uploaded {@link FeedbackAttachment} descriptors
   * or raw {@link UploadAttachmentOptions} which will automatically be uploaded via `client.uploadAttachment()`.
   */
  onPickAttachment?: () => Promise<
    | FeedbackAttachment
    | FeedbackAttachment[]
    | UploadAttachmentOptions
    | UploadAttachmentOptions[]
    | null
    | undefined
  >;

  /**
   * Whether to wrap the form in a native React Native full-screen `<Modal>`.
   * Set to `false` when embedding directly in an existing screen layout.
   *
   * @defaultValue `true`
   */
  isModal?: boolean;
}

/**
 * In-app feedback and bug report composer component supporting title, description, contact email, attachments, and metadata submission.
 *
 * @param props - {@link FeedbackComposerProps} configuring visibility, callbacks, and initial values.
 *
 * @example
 * ```tsx
 * import React, { useState } from 'react';
 * import { Button } from 'react-native';
 * import { FeedbackComposer } from '@cupthread/react-native';
 *
 * export function HelpMenu() {
 *   const [showFeedback, setShowFeedback] = useState(false);
 *
 *   return (
 *     <>
 *       <Button title="Send Feedback" onPress={() => setShowFeedback(true)} />
 *       <FeedbackComposer
 *         visible={showFeedback}
 *         onClose={() => setShowFeedback(false)}
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export function FeedbackComposer({
  visible = true,
  onClose,
  onSubmitSuccess,
  initialDraft,
  onPickAttachment,
  isModal = true,
}: FeedbackComposerProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();
  const isTokenReady = useCupThreadTokenReadiness();
  const strings = useCupThreadStrings();

  const [title, setTitle] = useState(initialDraft?.title || '');
  const [description, setDescription] = useState(initialDraft?.description || '');
  const [reporterName, setReporterName] = useState(initialDraft?.reporterName || '');
  const [reporterEmail, setReporterEmail] = useState(initialDraft?.reporterEmail || '');
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>(initialDraft?.attachments || []);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePickAttachment = async () => {
    if (!onPickAttachment) return;
    try {
      setIsUploadingAttachment(true);
      const picked = await onPickAttachment();
      if (!picked) {
        return;
      }

      const items = Array.isArray(picked) ? picked : [picked];
      const newlyAdded: FeedbackAttachment[] = [];

      for (const item of items) {
        if ('url' in item && 'key' in item) {
          newlyAdded.push(item as FeedbackAttachment);
        } else if ('file' in item && 'filename' in item) {
          const effectiveToken = userToken || (await UserTokenStore.shared.getToken());
          const uploaded = await client.uploadAttachment({
            ...(item as UploadAttachmentOptions),
            userToken: effectiveToken,
          });
          newlyAdded.push(uploaded);
        }
      }

      if (newlyAdded.length > 0) {
        setAttachments((prev) => [...prev, ...newlyAdded]);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || strings.feedbackComposer.uploadFailed);
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const handleRemoveAttachment = (indexToRemove: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSubmit = async () => {
    if (title.trim().length < 3) {
      setErrorMessage(strings.feedbackComposer.titleMinLengthError);
      return;
    }
    if (description.trim().length < 5) {
      setErrorMessage(strings.feedbackComposer.descriptionMinLengthError);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const draft: FeedbackDraft = {
        title: title.trim(),
        description: description.trim(),
        reporterName: reporterName.trim() || undefined,
        reporterEmail: reporterEmail.trim() || undefined,
        attachments,
        metadata: initialDraft?.metadata,
      };

      const effectiveToken = userToken || (await UserTokenStore.shared.getToken());
      const result = await client.submit(draft, effectiveToken);
      setIsSubmitting(false);

      if (onSubmitSuccess) {
        onSubmitSuccess(result);
      } else {
        Alert.alert(strings.feedbackComposer.successTitle, strings.feedbackComposer.successMessage);
        if (onClose) onClose();
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMessage(err?.message || strings.feedbackComposer.submitFailed);
    }
  };

  const content = (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {strings.feedbackComposer.title}
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
        {strings.feedbackComposer.titleLabel}
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
        placeholder={strings.feedbackComposer.titlePlaceholder}
        placeholderTextColor={colors.textMuted}
        value={title}
        onChangeText={setTitle}
        maxLength={100}
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {strings.feedbackComposer.detailsLabel}
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
        placeholder={strings.feedbackComposer.detailsPlaceholder}
        placeholderTextColor={colors.textMuted}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {strings.feedbackComposer.nameLabel}
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
        placeholder={strings.feedbackComposer.namePlaceholder}
        placeholderTextColor={colors.textMuted}
        value={reporterName}
        onChangeText={setReporterName}
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {strings.feedbackComposer.emailLabel}
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
        placeholder={strings.feedbackComposer.emailPlaceholder}
        placeholderTextColor={colors.textMuted}
        value={reporterEmail}
        onChangeText={setReporterEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      {/* Attachments Section */}
      <View style={styles.attachmentSection}>
        <View style={styles.attachmentSectionHeader}>
          <Text style={[styles.label, { color: colors.textSecondary, marginBottom: 0 }]}>
            {strings.feedbackComposer.attachmentsHeader}
          </Text>
          {onPickAttachment && (
            <TouchableOpacity
              onPress={handlePickAttachment}
              disabled={isUploadingAttachment}
              style={[
                styles.addAttachmentBtn,
                { borderColor: colors.primary, opacity: isUploadingAttachment ? 0.6 : 1 },
              ]}
            >
              {isUploadingAttachment ? (
                <View style={styles.uploadingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[styles.addAttachmentText, { color: colors.primary, marginLeft: 6 }]}>
                    {strings.feedbackComposer.uploadingAttachment}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.addAttachmentText, { color: colors.primary }]}>
                  + {strings.feedbackComposer.addAttachment}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {attachments.length > 0 && (
          <View style={styles.attachmentsList}>
            {attachments.map((att, idx) => (
              <View
                key={`${att.key || idx}`}
                style={[
                  styles.attachmentItem,
                  { backgroundColor: colors.card, borderColor: colors.cardBorder },
                ]}
              >
                <View style={styles.attachmentInfo}>
                  <Text style={styles.attachmentIcon}>
                    {att.kind === 'image' ? '🖼️' : '📄'}
                  </Text>
                  <View style={styles.attachmentDetails}>
                    <Text
                      numberOfLines={1}
                      style={[styles.attachmentName, { color: colors.textPrimary }]}
                    >
                      {att.filename || 'attachment'}
                    </Text>
                    {att.size ? (
                      <Text style={[styles.attachmentSize, { color: colors.textMuted }]}>
                        {formatFileSize(att.size)}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => handleRemoveAttachment(idx)}
                  style={styles.removeAttachmentBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ color: colors.textMuted, fontSize: 16 }}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      <TouchableOpacity
        activeOpacity={0.8}
        disabled={isSubmitting || isUploadingAttachment || !isTokenReady}
        onPress={handleSubmit}
        style={[
          styles.submitBtn,
          {
            backgroundColor: colors.primary,
            opacity: isSubmitting || isUploadingAttachment || !isTokenReady ? 0.6 : 1,
          },
        ]}
      >
        {isSubmitting ? (
          <ActivityIndicator color={colors.primaryText} size="small" />
        ) : (
          <Text style={[styles.submitText, { color: colors.primaryText }]}>
            {strings.feedbackComposer.submitButton}
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
    minHeight: 110,
  },
  attachmentSection: {
    marginTop: 12,
  },
  attachmentSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  addAttachmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  addAttachmentText: {
    fontSize: 12,
    fontWeight: '600',
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attachmentsList: {
    marginTop: 4,
    gap: 8,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  attachmentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 8,
  },
  attachmentIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  attachmentDetails: {
    flex: 1,
  },
  attachmentName: {
    fontSize: 13,
    fontWeight: '500',
  },
  attachmentSize: {
    fontSize: 11,
    marginTop: 2,
  },
  removeAttachmentBtn: {
    padding: 4,
  },
  submitBtn: {
    marginTop: 22,
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
