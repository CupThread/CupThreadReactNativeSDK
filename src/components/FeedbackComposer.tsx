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
import { useCupThreadTheme, useCupThreadClient, useCupThreadUserToken } from '../theme/CupThreadThemeProvider.tsx';
import type { FeedbackAttachment, FeedbackDraft, FeedbackSubmissionResult } from '../types/index.ts';

export interface FeedbackComposerProps {
  visible?: boolean;
  onClose?: () => void;
  onSubmitSuccess?: (result: FeedbackSubmissionResult) => void;
  initialDraft?: Partial<FeedbackDraft>;
  isModal?: boolean;
}

export function FeedbackComposer({
  visible = true,
  onClose,
  onSubmitSuccess,
  initialDraft,
  isModal = true,
}: FeedbackComposerProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();

  const [title, setTitle] = useState(initialDraft?.title || '');
  const [description, setDescription] = useState(initialDraft?.description || '');
  const [reporterName, setReporterName] = useState(initialDraft?.reporterName || '');
  const [reporterEmail, setReporterEmail] = useState(initialDraft?.reporterEmail || '');
  const [attachments] = useState<FeedbackAttachment[]>(initialDraft?.attachments || []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (title.trim().length < 3) {
      setErrorMessage('Please provide a title with at least 3 characters.');
      return;
    }
    if (description.trim().length < 5) {
      setErrorMessage('Please provide details with at least 5 characters.');
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

      const result = await client.submit(draft, userToken);
      setIsSubmitting(false);

      if (onSubmitSuccess) {
        onSubmitSuccess(result);
      } else {
        Alert.alert('Feedback Sent', 'Thank you for your feedback!');
        if (onClose) onClose();
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMessage(err?.message || 'Failed to submit feedback. Please try again.');
    }
  };

  const content = (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Send Feedback</Text>
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

      <Text style={[styles.label, { color: colors.textSecondary }]}>Title *</Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
            color: colors.textPrimary,
          },
        ]}
        placeholder="Brief summary..."
        placeholderTextColor={colors.textMuted}
        value={title}
        onChangeText={setTitle}
        maxLength={100}
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>Details *</Text>
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
        placeholder="Describe what happened or what you'd like to improve..."
        placeholderTextColor={colors.textMuted}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>Your Name (optional)</Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
            color: colors.textPrimary,
          },
        ]}
        placeholder="e.g. Alex"
        placeholderTextColor={colors.textMuted}
        value={reporterName}
        onChangeText={setReporterName}
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>Email for replies (optional)</Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
            color: colors.textPrimary,
          },
        ]}
        placeholder="alex@example.com"
        placeholderTextColor={colors.textMuted}
        value={reporterEmail}
        onChangeText={setReporterEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TouchableOpacity
        activeOpacity={0.8}
        disabled={isSubmitting}
        onPress={handleSubmit}
        style={[
          styles.submitBtn,
          {
            backgroundColor: colors.primary,
            opacity: isSubmitting ? 0.6 : 1,
          },
        ]}
      >
        {isSubmitting ? (
          <ActivityIndicator color={colors.primaryText} size="small" />
        ) : (
          <Text style={[styles.submitText, { color: colors.primaryText }]}>Submit Feedback</Text>
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
  submitBtn: {
    marginTop: 20,
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
