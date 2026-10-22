import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — Edit Template Modal
 *
 * Implements Section 1.2: Edit Day Metadata (name, instructions/notes).
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { WorkoutTemplate } from '../../core/types';

export interface EditTemplateModalProps {
  visible: boolean;
  template: WorkoutTemplate | null;
  onSave: (name: string, notes: string | null) => void;
  onClose: () => void;
}

export const EditTemplateModal: React.FC<EditTemplateModalProps> = ({
  visible,
  template,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (template) {
      setName(template.name);
      setNotes(template.notes || '');
    }
  }, [template]);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave(name.trim(), notes.trim() || null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View testID="edit-template-modal" style={styles.content}>
          <Text style={styles.title}>Edit Workout Day</Text>

          <Text style={styles.inputLabel}>Template Name</Text>
          <TextInput
            testID="edit-template-name-input"
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Day 1 — Upper Push"
            placeholderTextColor={uiColors.subtle}
          />

          <Text style={[styles.inputLabel, { marginTop: 12 }]}>Day Notes / Instructions</Text>
          <TextInput
            testID="edit-template-notes-input"
            style={[styles.textInput, { height: 70 }]}
            multiline
            value={notes}
            onChangeText={setNotes}
            placeholder="Warmup notes, movement focus, rest cues..."
            placeholderTextColor={uiColors.subtle}
          />

          <View style={styles.actionRow}>
            <TouchableOpacity
              testID="cancel-edit-template-btn"
              style={styles.cancelBtn}
              onPress={onClose}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="save-edit-template-btn"
              style={styles.saveBtn}
              onPress={handleSave}
            >
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    backgroundColor: uiColors.surface,
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  title: {
    lineHeight: 28,
    flexShrink: 1,
    color: uiColors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 14,
  },
  inputLabel: {
    color: uiColors.secondaryText,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    color: uiColors.text,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelBtnText: {
    color: uiColors.subtle,
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: uiColors.accent,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: uiRadius.control,
  },
  saveBtnText: {
    color: uiColors.background,
    fontSize: 13,
    fontWeight: '700',
  },
});
