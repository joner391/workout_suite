/**
 * Workout Suite — ImportScreen Wizard
 *
 * Implements Step 2.4:
 * Multi-step training history import wizard supporting Strong CSV, Hevy CSV,
 * and generic CSV files.
 *
 * Features:
 * - Document picker integration via expo-document-picker with file reader fallback
 * - Direct CSV paste input for quick desktop testing / manual imports
 * - Real-time analysis with exercise catalog matching & custom exercise preview
 * - Duplicate session detection with toggleable duplicate skipping
 * - High-contrast OLED dark styling (Pure Utility Mode compliant)
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Switch,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ImportSource } from '../../core/types';
import {
  ImportService,
  WorkoutImportPreview,
  ImportExecutionResult,
} from '../../services/importService';
import {
  parseRawCsv,
  isStrengthLogBodyCompCsv,
} from '../../core/parsers/csvImportParser';
import {
  EvaluationPresetType,
} from './dummyDataPresets';

export interface DocumentAsset {
  name: string;
  uri: string;
  size?: number;
  mimeType?: string;
}

export interface DocumentPickerResult {
  canceled: boolean;
  assets?: DocumentAsset[] | null;
}

export interface ImportScreenProps {
  importService: ImportService;
  onClose: () => void;
  onImportComplete?: (result: ImportExecutionResult) => void;
  documentPicker?: () => Promise<DocumentPickerResult>;
  fileReader?: (uri: string) => Promise<string>;
}

type WizardStep = 'select' | 'analyzing' | 'preview' | 'importing' | 'complete';

export const ImportScreen: React.FC<ImportScreenProps> = ({
  importService,
  onClose,
  onImportComplete,
  documentPicker,
  fileReader,
}) => {
  const [step, setStep] = useState<WizardStep>('select');
  const [sourceFormat, setSourceFormat] = useState<ImportSource | 'auto'>('auto');
  const [pastedText, setPastedText] = useState<string>('');
  const [showPasteBox, setShowPasteBox] = useState<boolean>(false);

  const [basePreview, setBasePreview] = useState<WorkoutImportPreview | null>(null);
  const [preview, setPreview] = useState<WorkoutImportPreview | null>(null);
  const [dateFilter, setDateFilter] = useState<'all' | '3m' | '6m'>('all');
  const [bodyMetricsImportedCount, setBodyMetricsImportedCount] = useState<number>(0);

  const [skipDuplicates, setSkipDuplicates] = useState<boolean>(true);
  const [executionResult, setExecutionResult] = useState<ImportExecutionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // File picker handler
  const handlePickFile = async () => {
    try {
      setErrorMessage(null);
      const pickerFn =
        documentPicker ??
        (async () => {
          return await DocumentPicker.getDocumentAsync({
            type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
            copyToCacheDirectory: true,
          });
        });

      const pickerResult = await pickerFn();
      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const asset = pickerResult.assets[0];
      setStep('analyzing');

      const readFn =
        fileReader ??
        (async (uri: string) => {
          return await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType ? FileSystem.EncodingType.UTF8 : 'utf8',
          });
        });

      const content = await readFn(asset.uri);
      processCsvContent(content);
    } catch (err: any) {
      setErrorMessage(`Failed to read file: ${err?.message || 'Unknown error'}`);
      setStep('select');
    }
  };

  // 1-Tap Evaluation Data Loader for Expo Go
  const handleLoadEvaluationPreset = async (preset: EvaluationPresetType) => {
    try {
      setStep('importing');
      setErrorMessage(null);
      const res = await importService.importEvaluationData(preset);
      setExecutionResult(res.workoutsResult);
      setBodyMetricsImportedCount(res.bodyMetricsResult.importedCount);
      setStep('complete');
      if (onImportComplete) {
        onImportComplete(res.workoutsResult);
      }
    } catch (err: any) {
      setErrorMessage(`Evaluation load error: ${err?.message || 'Unknown error'}`);
      setStep('select');
    }
  };

  // Direct paste handler
  const handleAnalyzePasted = () => {
    if (!pastedText.trim()) {
      setErrorMessage('Please paste valid CSV content to analyze.');
      return;
    }
    setStep('analyzing');
    processCsvContent(pastedText);
  };

  // Process CSV text through ImportService
  const processCsvContent = async (rawCsv: string) => {
    try {
      setErrorMessage(null);

      // Check if this is a body composition CSV export
      const rawRows = parseRawCsv(rawCsv);
      if (rawRows.length > 0 && isStrengthLogBodyCompCsv(rawRows[0])) {
        setStep('importing');
        const res = await importService.importBodyMetrics(rawCsv);
        setBodyMetricsImportedCount(res.importedCount);
        const result: ImportExecutionResult = {
          success: res.errors.length === 0,
          importedWorkoutsCount: 0,
          importedSetsCount: 0,
          skippedDuplicatesCount: 0,
          createdExercisesCount: 0,
          workoutIds: [],
          errors: res.errors,
        };
        setExecutionResult(result);
        setStep('complete');
        if (onImportComplete) {
          onImportComplete(result);
        }
        return;
      }

      const formatHint = sourceFormat === 'auto' ? undefined : sourceFormat;
      const parsed = importService.parseCsv(rawCsv, formatHint);

      if (parsed.workouts.length === 0) {
        setErrorMessage(
          parsed.errors.length > 0
            ? parsed.errors.join(' ')
            : 'No workouts could be parsed from the provided CSV data.'
        );
        setStep('select');
        return;
      }

      const importPreview = await importService.generatePreview(parsed);
      setBasePreview(importPreview);
      setPreview(importPreview);
      setDateFilter('all');
      setStep('preview');
    } catch (err: any) {
      setErrorMessage(`Parsing error: ${err?.message || 'Invalid format'}`);
      setStep('select');
    }
  };

  // Date range filter handler on Preview screen
  const handleDateFilterChange = (filter: 'all' | '3m' | '6m') => {
    setDateFilter(filter);
    if (!basePreview) return;
    if (filter === 'all') {
      setPreview(basePreview);
    } else {
      const dates = basePreview.workouts.map((w) => w.workout.date).sort();
      const latestDateStr = dates.length > 0 ? dates[dates.length - 1] : new Date().toISOString().split('T')[0];
      const latestDate = new Date(latestDateStr);
      const months = filter === '3m' ? 3 : 6;
      latestDate.setMonth(latestDate.getMonth() - months);
      const startDateStr = latestDate.toISOString().split('T')[0];
      const filtered = importService.filterPreviewByDateRange(basePreview, startDateStr);
      setPreview(filtered);
    }
  };

  // Execute import
  const handleExecuteImport = async () => {
    if (!preview) return;

    try {
      setStep('importing');
      setErrorMessage(null);

      const result = await importService.executeImport(preview, {
        skipDuplicates,
      });

      setExecutionResult(result);
      setStep('complete');
      if (onImportComplete) {
        onImportComplete(result);
      }
    } catch (err: any) {
      setErrorMessage(`Import failed: ${err?.message || 'Unknown error'}`);
      setStep('preview');
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Import History</Text>
          <Text style={styles.headerSubtitle}>
            Liftosaur, StrengthLog, Strong & Hevy CSV
          </Text>
        </View>
        <TouchableOpacity
          testID="import-close-btn"
          style={styles.closeBtn}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Error banner */}
      {errorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      ) : null}

      {/* Step 1: File Selection & Options */}
      {step === 'select' && (
        <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollContainer}>
          {/* Quick Expo Go Evaluation Section (__DEV__ only) */}
          {(__DEV__ || process.env.NODE_ENV !== 'production') && (
            <View style={styles.evaluationCard}>
              <Text style={styles.evaluationBadge}>⚡ EXPO GO QUICK EVALUATION</Text>
              <Text style={styles.evaluationTitle}>Load Evaluation Data</Text>
              <Text style={styles.cardDescription}>
                Instant 1-tap loader with your exported Liftosaur and StrengthLog history. Evaluate how the app looks with rich historical data without needing to transfer CSV files to your phone:
              </Text>
              <View style={styles.evalButtonRow}>
                <TouchableOpacity
                  testID="eval-preset-3m-btn"
                  style={styles.evalPresetBtn}
                  onPress={() => handleLoadEvaluationPreset('last_3_months')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.evalPresetBtnTitle}>⚡ Quick Eval: Last 3 Months</Text>
                  <Text style={styles.evalPresetBtnSubtitle}>
                    ~35 Liftosaur sessions + 10 body composition logs (July – Oct 2026)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="eval-preset-all-btn"
                  style={[styles.evalPresetBtn, styles.evalPresetBtnOutline]}
                  onPress={() => handleLoadEvaluationPreset('all')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.evalPresetBtnTitle, styles.evalPresetBtnTitleOutline]}>
                    🏛️ Full History: All Time (2.5 Years)
                  </Text>
                  <Text style={[styles.evalPresetBtnSubtitle, styles.evalPresetBtnSubtitleOutline]}>
                    357 sessions (Liftosaur + StrengthLog), 4,617 sets, 34 body logs
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <Text style={styles.sectionTitle}>OR IMPORT CUSTOM EXPORT FILE</Text>

          <View style={styles.formatRow}>
            {(
              [
                'auto',
                'liftosaur',
                'strengthlog',
                'strong',
                'hevy',
                'csv',
              ] as const
            ).map((fmt) => (
              <TouchableOpacity
                key={fmt}
                testID={`format-btn-${fmt}`}
                style={[
                  styles.formatChip,
                  sourceFormat === fmt && styles.formatChipActive,
                ]}
                onPress={() => setSourceFormat(fmt)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.formatChipText,
                    sourceFormat === fmt && styles.formatChipTextActive,
                  ]}
                >
                  {fmt === 'auto'
                    ? '⚡ Auto'
                    : fmt === 'liftosaur'
                    ? 'Liftosaur'
                    : fmt === 'strengthlog'
                    ? 'StrengthLog'
                    : fmt === 'strong'
                    ? 'Strong'
                    : fmt === 'hevy'
                    ? 'Hevy'
                    : 'CSV'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.actionCard}>
            <Text style={styles.cardHeading}>Select Export File</Text>
            <Text style={styles.cardDescription}>
              Choose a `.csv` file exported from Strong, Hevy, or your custom spreadsheet.
              Weights in lbs are automatically converted to canonical kilograms.
            </Text>

            <TouchableOpacity
              testID="pick-csv-file-btn"
              style={styles.primaryActionBtn}
              onPress={handlePickFile}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryActionBtnText}>📄 Pick CSV File</Text>
            </TouchableOpacity>
          </View>

          {/* Paste CSV text toggle */}
          <TouchableOpacity
            testID="toggle-paste-box-btn"
            style={styles.secondaryActionBtn}
            onPress={() => setShowPasteBox(!showPasteBox)}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryActionBtnText}>
              {showPasteBox ? '▲ Hide Direct Paste Box' : '▼ Or Paste CSV Text Directly'}
            </Text>
          </TouchableOpacity>

          {showPasteBox && (
            <View style={styles.pasteCard}>
              <Text style={styles.pasteCardLabel}>Paste CSV Content Below:</Text>
              <TextInput
                testID="csv-paste-input"
                style={styles.pasteInput}
                multiline
                numberOfLines={8}
                placeholder="Date,Workout Name,Exercise Name,Set Order,Weight,Weight Unit,Reps..."
                placeholderTextColor="#52525B"
                value={pastedText}
                onChangeText={setPastedText}
              />
              <TouchableOpacity
                testID="analyze-pasted-btn"
                style={styles.primaryActionBtn}
                onPress={handleAnalyzePasted}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryActionBtnText}>🔍 Analyze Pasted CSV</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>💡 How to export your data:</Text>
            <Text style={styles.infoText}>
              • Strong App: Settings ➔ Export Data ➔ CSV format.{'\n'}
              • Hevy App: Profile ➔ Settings ➔ Export & Import ➔ Export Workouts.{'\n'}
              • All workouts are stored in local SQLite with 'completed' status and provenance tags.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Step 2: Analyzing State */}
      {step === 'analyzing' && (
        <View style={styles.centeredContainer}>
          <ActivityIndicator size="large" color="#00E676" />
          <Text style={styles.centeredText}>Analyzing CSV structure...</Text>
          <Text style={styles.centeredSubtext}>Matching exercise names against library</Text>
        </View>
      )}

      {/* Step 3: Preview & Confirmation */}
      {step === 'preview' && preview && (
        <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollContainer}>
          <Text style={styles.sectionTitle}>IMPORT PREVIEW SUMMARY</Text>

          {/* Date Range Evaluation Filter */}
          <Text style={styles.sectionSubtitleText}>EVALUATION DATE FILTER</Text>
          <View style={styles.filterSegmentRow}>
            {(
              [
                { id: 'all', label: 'All History' },
                { id: '3m', label: 'Last 3 Months' },
                { id: '6m', label: 'Last 6 Months' },
              ] as const
            ).map((f) => (
              <TouchableOpacity
                key={f.id}
                testID={`date-filter-${f.id}`}
                style={[
                  styles.filterSegmentChip,
                  dateFilter === f.id && styles.filterSegmentChipActive,
                ]}
                onPress={() => handleDateFilterChange(f.id)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.filterSegmentChipText,
                    dateFilter === f.id && styles.filterSegmentChipTextActive,
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Metric cards */}
          <View style={styles.metricsRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricVal}>{preview.totalWorkouts}</Text>
              <Text style={styles.metricLabel}>WORKOUTS</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricVal}>{preview.totalSets}</Text>
              <Text style={styles.metricLabel}>TOTAL SETS</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricVal}>{preview.exerciseMatches.length}</Text>
              <Text style={styles.metricLabel}>EXERCISES</Text>
            </View>
          </View>

          {/* Duplicate sessions banner */}
          {preview.duplicateWorkoutsCount > 0 ? (
            <View style={styles.warningBanner}>
              <Text style={styles.warningTitle}>
                ⚠️ {preview.duplicateWorkoutsCount} Potential Duplicate Sessions Detected
              </Text>
              <Text style={styles.warningText}>
                Sessions on the same date with identical exercise set counts were detected in your database.
              </Text>
            </View>
          ) : null}

          {/* Duplicate skip toggle */}
          <View style={styles.toggleCard}>
            <View style={styles.toggleTextCol}>
              <Text style={styles.toggleLabel}>Skip Duplicate Sessions</Text>
              <Text style={styles.toggleSubtext}>
                Prevents re-importing identical workouts already in your calendar.
              </Text>
            </View>
            <Switch
              testID="skip-duplicates-switch"
              value={skipDuplicates}
              onValueChange={setSkipDuplicates}
              trackColor={{ false: '#27272A', true: '#00E676' }}
              thumbColor={skipDuplicates ? '#000000' : '#A1A1AA'}
            />
          </View>

          {/* Exercise matching review */}
          <Text style={styles.sectionTitle}>EXERCISE CATALOG MATCHING</Text>
          <View style={styles.exerciseListCard}>
            {preview.exerciseMatches.map((m, idx) => (
              <View
                key={idx}
                style={[
                  styles.exerciseRow,
                  idx === preview.exerciseMatches.length - 1 && styles.exerciseRowLast,
                ]}
              >
                <View style={styles.exerciseNameCol}>
                  <Text style={styles.exerciseRawName}>{m.rawName}</Text>
                  <Text style={styles.exerciseTargetName}>
                    ➔ {m.matchedExercise ? m.matchedExercise.name : `${m.proposedExercise.name} (Custom)`}
                  </Text>
                </View>
                <View
                  style={[
                    styles.matchBadge,
                    m.matchedExercise ? styles.matchBadgeSuccess : styles.matchBadgeCustom,
                  ]}
                >
                  <Text
                    style={[
                      styles.matchBadgeText,
                      m.matchedExercise
                        ? styles.matchBadgeTextSuccess
                        : styles.matchBadgeTextCustom,
                    ]}
                  >
                    {m.matchedExercise ? 'MATCHED' : '+ CUSTOM'}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              testID="cancel-preview-btn"
              style={styles.cancelBtn}
              onPress={() => setStep('select')}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelBtnText}>Choose Another</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="confirm-import-btn"
              style={styles.confirmBtn}
              onPress={handleExecuteImport}
              activeOpacity={0.8}
            >
              <Text style={styles.confirmBtnText}>
                Import {preview.totalWorkouts - (skipDuplicates ? preview.duplicateWorkoutsCount : 0)} Sessions ➔
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Step 4: Importing in Progress */}
      {step === 'importing' && (
        <View style={styles.centeredContainer}>
          <ActivityIndicator size="large" color="#00E676" />
          <Text style={styles.centeredText}>Importing sessions into SQLite...</Text>
          <Text style={styles.centeredSubtext}>Writing workouts, sets, and custom movements</Text>
        </View>
      )}

      {/* Step 5: Completed */}
      {step === 'complete' && executionResult && (
        <View style={styles.completedContainer}>
          <View style={styles.successIconBadge}>
            <Text style={styles.successIconText}>✓</Text>
          </View>
          <Text style={styles.successTitle}>Import Complete!</Text>
          <Text style={styles.successSubtitle}>
            Your training history is now available offline in your local ledger.
          </Text>

          <View style={styles.resultCard}>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Workouts Imported</Text>
              <Text style={styles.resultVal}>{executionResult.importedWorkoutsCount}</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Sets Logged</Text>
              <Text style={styles.resultVal}>{executionResult.importedSetsCount}</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Custom Movements Created</Text>
              <Text style={styles.resultVal}>{executionResult.createdExercisesCount}</Text>
            </View>
            {bodyMetricsImportedCount > 0 && (
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Body Metrics Logged</Text>
                <Text style={styles.resultVal}>{bodyMetricsImportedCount}</Text>
              </View>
            )}
            {executionResult.skippedDuplicatesCount > 0 && (
              <View style={[styles.resultRow, styles.resultRowLast]}>
                <Text style={styles.resultLabel}>Duplicates Skipped</Text>
                <Text style={styles.resultValAccent}>
                  {executionResult.skippedDuplicatesCount}
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            testID="import-done-btn"
            style={styles.doneBtn}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={styles.doneBtnText}>View Workouts in Calendar ➔</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FAFAFA',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#A1A1AA',
    fontWeight: '600',
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorBanner: {
    backgroundColor: '#3F1212',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  errorBannerText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '600',
  },
  scrollContent: {
    flex: 1,
  },
  scrollContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 8,
  },
  formatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  formatChip: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  formatChipActive: {
    backgroundColor: '#27272A',
    borderColor: '#00E676',
  },
  formatChipText: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '700',
  },
  formatChipTextActive: {
    color: '#00E676',
  },
  actionCard: {
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 18,
    marginBottom: 14,
  },
  cardHeading: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  cardDescription: {
    color: '#A1A1AA',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  primaryActionBtn: {
    backgroundColor: '#00E676',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  secondaryActionBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryActionBtnText: {
    color: '#00E676',
    fontSize: 13,
    fontWeight: '700',
  },
  pasteCard: {
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  pasteCardLabel: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  pasteInput: {
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    padding: 12,
    color: '#FAFAFA',
    fontSize: 12,
    fontFamily: 'monospace',
    height: 120,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  infoCard: {
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: '#18181B',
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
  },
  infoTitle: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  infoText: {
    color: '#71717A',
    fontSize: 12,
    lineHeight: 18,
  },
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  centeredText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 16,
  },
  centeredSubtext: {
    color: '#71717A',
    fontSize: 13,
    marginTop: 6,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  metricVal: {
    color: '#00E676',
    fontSize: 22,
    fontWeight: '900',
  },
  metricLabel: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
  },
  warningBanner: {
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.4)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  warningTitle: {
    color: '#FACC15',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  warningText: {
    color: '#D4D4D8',
    fontSize: 12,
    lineHeight: 16,
  },
  toggleCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
  },
  toggleTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  toggleLabel: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '700',
  },
  toggleSubtext: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 2,
  },
  exerciseListCard: {
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 20,
  },
  exerciseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  exerciseRowLast: {
    borderBottomWidth: 0,
  },
  exerciseNameCol: {
    flex: 1,
    paddingRight: 10,
  },
  exerciseRawName: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
  },
  exerciseTargetName: {
    color: '#A1A1AA',
    fontSize: 11,
    marginTop: 2,
  },
  matchBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  matchBadgeSuccess: {
    backgroundColor: 'rgba(0, 230, 118, 0.1)',
    borderColor: 'rgba(0, 230, 118, 0.3)',
  },
  matchBadgeCustom: {
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  matchBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  matchBadgeTextSuccess: {
    color: '#00E676',
  },
  matchBadgeTextCustom: {
    color: '#FACC15',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '700',
  },
  confirmBtn: {
    flex: 2,
    backgroundColor: '#00E676',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
  },
  completedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  successIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderWidth: 2,
    borderColor: '#00E676',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successIconText: {
    color: '#00E676',
    fontSize: 32,
    fontWeight: '900',
  },
  successTitle: {
    color: '#FAFAFA',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 6,
  },
  successSubtitle: {
    color: '#A1A1AA',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 18,
  },
  resultCard: {
    width: '100%',
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 24,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  resultRowLast: {
    borderBottomWidth: 0,
  },
  resultLabel: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '600',
  },
  resultVal: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
  },
  resultValAccent: {
    color: '#FACC15',
    fontSize: 13,
    fontWeight: '700',
  },
  doneBtn: {
    width: '100%',
    backgroundColor: '#00E676',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '900',
  },
  sectionSubtitleText: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  evaluationCard: {
    backgroundColor: '#0F1710',
    borderWidth: 1,
    borderColor: '#00E676',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  evaluationBadge: {
    color: '#00E676',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  evaluationTitle: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  evalButtonRow: {
    flexDirection: 'column',
    gap: 8,
    marginTop: 12,
  },
  evalPresetBtn: {
    backgroundColor: '#00E676',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'flex-start',
  },
  evalPresetBtnOutline: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  evalPresetBtnTitle: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  evalPresetBtnTitleOutline: {
    color: '#FAFAFA',
  },
  evalPresetBtnSubtitle: {
    color: '#18181B',
    fontSize: 11,
    fontWeight: '600',
  },
  evalPresetBtnSubtitleOutline: {
    color: '#A1A1AA',
  },
  filterSegmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  filterSegmentChip: {
    flex: 1,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  filterSegmentChipActive: {
    borderColor: '#00E676',
    backgroundColor: '#00331A',
  },
  filterSegmentChipText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '700',
  },
  filterSegmentChipTextActive: {
    color: '#00E676',
  },
});
