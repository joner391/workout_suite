import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
import { ScreenHeader } from '../../ui/ScreenHeader';
/**
 * Workout Suite — SettingsScreen
 *
 * Implements Step 1.6: Basic Settings Toggles
 * Implements ADR-008: Canonical Kilogram Storage with Display-Layer Unit Conversion
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 *
 * Features:
 * - Instant toggle between kg and lbs unit systems.
 * - Instant toggle between RPE and RIR intensity metrics.
 * - Instant toggle for Pure Utility Mode.
 * - Storage & diagnostics status display.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Modal,
} from 'react-native';
import { WeightUnit, IntensityMetric, AutoWarmupMode } from '../../core/types';
import { IUserSettingsRepository, SETTINGS_KEYS } from '../../domain/repositories/IUserSettingsRepository';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import { IGearRepository } from '../../domain/repositories/IGearRepository';
import { IWorkoutRepository } from '../../domain/repositories/IWorkoutRepository';
import { IProgramRepository } from '../../domain/repositories/IProgramRepository';
import { IUserProfileRepository } from '../../domain/repositories/IUserProfileRepository';
import { IBodyMetricsRepository } from '../../domain/repositories/IBodyMetricsRepository';
import { ISQLiteDatabase } from '../../database/schema';
import { ExportService } from '../../services/exportService';
import { ImportService } from '../../services/importService';
import { ProgramBlockService } from '../../services/programBlockService';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { CalibratedParamService } from '../../services/calibratedParamService';
import { ExerciseLibraryScreen } from '../inspection/ExerciseLibraryScreen';
import { ImportScreen } from '../import/ImportScreen';
import { ProgramOverviewScreen } from '../progression';

export interface SettingsScreenProps {
  userSettingsRepo: IUserSettingsRepository;
  exerciseRepo?: IExerciseRepository;
  gearRepo?: IGearRepository;
  workoutRepo?: IWorkoutRepository;
  programRepo?: IProgramRepository;
  userProfileRepo?: IUserProfileRepository;
  bodyMetricsRepo?: IBodyMetricsRepository;
  programBlockService?: ProgramBlockService;
  db?: ISQLiteDatabase;
  exportService?: ExportService;
  importService?: ImportService;
  calibratedParamService?: CalibratedParamService;
  onSettingsChange?: () => void;
  initialShowImport?: boolean;
  onNavigateToCalendar?: () => void;
}

export type SettingsSection = 'preferences' | 'tools' | 'data' | 'about';

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  userSettingsRepo,
  exerciseRepo,
  gearRepo,
  workoutRepo,
  programRepo,
  userProfileRepo,
  bodyMetricsRepo,
  programBlockService,
  db,
  exportService,
  importService,
  calibratedParamService,
  onSettingsChange,
  initialShowImport = false,
  onNavigateToCalendar,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [intensityMetric, setIntensityMetric] = useState<IntensityMetric>('RPE');
  const [pureUtilityMode, setPureUtilityMode] = useState<boolean>(false);
  const [autoWarmupMode, setAutoWarmupMode] = useState<AutoWarmupMode>('smart_compounds');
  const [smartWarmup, setSmartWarmup] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    initialShowImport ? 'data' : 'preferences'
  );

  const [showExerciseLibrary, setShowExerciseLibrary] = useState<boolean>(false);
  const [showImportScreen, setShowImportScreen] = useState<boolean>(initialShowImport);
  const [showProgramOverview, setShowProgramOverview] = useState<boolean>(false);

  useEffect(() => {
    if (initialShowImport) {
      setActiveSection('data');
      setShowImportScreen(true);
    }
  }, [initialShowImport]);

  const [exporting, setExporting] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const [calibratedStatus, setCalibratedStatus] = useState<string | null>(null);
  const [importingCalib, setImportingCalib] = useState<boolean>(false);

  const handleImportCalibratedParams = async () => {
    try {
      setImportingCalib(true);
      setCalibratedStatus(null);
      if (!db && !calibratedParamService) {
        setCalibratedStatus('Database not connected.');
        return;
      }
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }
      const fileUri = result.assets[0].uri;
      const fileContent = await FileSystem.readAsStringAsync(fileUri);
      const service = calibratedParamService ?? (db ? new CalibratedParamService(db) : null);
      if (!service) {
        setCalibratedStatus('CalibratedParamService unavailable.');
        return;
      }
      const importRes = await service.importParameters(fileContent);
      if (importRes.success) {
        setCalibratedStatus(`Successfully imported ${importRes.importedCount} calibrated parameters!`);
      } else {
        setCalibratedStatus(`Import failed: ${importRes.errors.join(', ')}`);
      }
    } catch (err: any) {
      setCalibratedStatus(`Import error: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setImportingCalib(false);
    }
  };

  const handleExportData = async () => {
    try {
      setExporting(true);
      setExportStatus(null);
      const service = exportService ?? (db ? new ExportService(db) : null);
      if (!service) {
        setExportStatus('Export failed: SQLite database not connected.');
        return;
      }
      const result = await service.exportAndShare(db);
      if (result.shared) {
        setExportStatus('Export complete! File shared successfully.');
      } else {
        setExportStatus(`Export saved to: ${result.filePath}`);
      }
    } catch (err: any) {
      setExportStatus(`Export error: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setExporting(false);
    }
  };


  // Load current settings
  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const [unit, intensity, utility, warmupMode, smart] = await Promise.all([
        userSettingsRepo.getUnitSystem(),
        userSettingsRepo.getIntensityMetric(),
        userSettingsRepo.getPureUtilityMode(),
        userSettingsRepo.getAutoWarmupMode(),
        userSettingsRepo.get(SETTINGS_KEYS.SMART_WARMUP),
      ]);
      setUnitSystem(unit);
      setIntensityMetric(intensity);
      setPureUtilityMode(utility);
      setAutoWarmupMode(warmupMode);
      setSmartWarmup(smart === '1');
    } catch {
      // Use defaults
    } finally {
      setLoading(false);
    }
  }, [userSettingsRepo]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Unit System toggle handler
  const handleUnitChange = async (unit: WeightUnit) => {
    setUnitSystem(unit);
    await userSettingsRepo.setUnitSystem(unit);
    if (onSettingsChange) {
      onSettingsChange();
    }
  };

  // Intensity Metric toggle handler
  const handleIntensityChange = async (metric: IntensityMetric) => {
    setIntensityMetric(metric);
    await userSettingsRepo.setIntensityMetric(metric);
    if (onSettingsChange) {
      onSettingsChange();
    }
  };

  // Pure Utility Mode toggle handler
  const handleUtilityModeToggle = async (value: boolean) => {
    setPureUtilityMode(value);
    await userSettingsRepo.setPureUtilityMode(value);
    if (onSettingsChange) {
      onSettingsChange();
    }
  };

  const handleSmartWarmupToggle = async (enabled: boolean) => {
    await userSettingsRepo.set(SETTINGS_KEYS.SMART_WARMUP, enabled ? '1' : '0');
    setSmartWarmup(enabled);
    onSettingsChange?.();
  };

  // Auto Warmup Mode toggle handler
  const handleAutoWarmupChange = async (mode: AutoWarmupMode) => {
    setAutoWarmupMode(mode);
    await userSettingsRepo.setAutoWarmupMode(mode);
    if (onSettingsChange) {
      onSettingsChange();
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <ScreenHeader title="Settings" subtitle="Preferences, data and app setup" />

      {/* Category Segmented Control */}
      <View style={styles.sectionTabBar} testID="settings-section-tab-bar">
        <TouchableOpacity
          testID="settings-tab-preferences"
          style={[
            styles.sectionTabBtn,
            activeSection === 'preferences' && styles.sectionTabBtnActive,
          ]}
          onPress={() => setActiveSection('preferences')}
          accessibilityLabel="Preferences Tab"
        >
          <Text
            style={[
              styles.sectionTabText,
              activeSection === 'preferences' && styles.sectionTabTextActive,
            ]}
          >
            Preferences
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="settings-tab-tools"
          style={[
            styles.sectionTabBtn,
            activeSection === 'tools' && styles.sectionTabBtnActive,
          ]}
          onPress={() => setActiveSection('tools')}
          accessibilityLabel="Tools Tab"
        >
          <Text
            style={[
              styles.sectionTabText,
              activeSection === 'tools' && styles.sectionTabTextActive,
            ]}
          >
            Tools
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="settings-tab-data"
          style={[
            styles.sectionTabBtn,
            activeSection === 'data' && styles.sectionTabBtnActive,
          ]}
          onPress={() => setActiveSection('data')}
          accessibilityLabel="Data Tab"
        >
          <Text
            style={[
              styles.sectionTabText,
              activeSection === 'data' && styles.sectionTabTextActive,
            ]}
          >
            Data
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="settings-tab-about"
          style={[
            styles.sectionTabBtn,
            activeSection === 'about' && styles.sectionTabBtnActive,
          ]}
          onPress={() => setActiveSection('about')}
          accessibilityLabel="About Tab"
        >
          <Text
            style={[
              styles.sectionTabText,
              activeSection === 'about' && styles.sectionTabTextActive,
            ]}
          >
            About
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={uiColors.accent} size="large" />
          <Text style={styles.loadingText}>Loading preferences...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
        >
          {activeSection === 'preferences' && (
            <>
              {/* Section: Units & Calculations */}
              <Text style={styles.sectionTitle}>UNITS & DISPLAY</Text>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Weight Unit System</Text>
                  <Text style={styles.settingValueBadge}>
                    {unitSystem.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.settingDescription}>
                  All weights are stored canonically in kilograms. Values
                  are dynamically converted to {unitSystem} in all logger inputs,
                  plate solvers, and charts.
                </Text>

                <View style={styles.segmentedControl}>
                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      unitSystem === 'kg' && styles.segmentButtonActive,
                    ]}
                    onPress={() => handleUnitChange('kg')}
                    activeOpacity={0.8}
                    accessibilityLabel="Set unit system to Kilograms (kg)"
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        unitSystem === 'kg' && styles.segmentTextActive,
                      ]}
                    >
                      Metric (kg)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      unitSystem === 'lbs' && styles.segmentButtonActive,
                    ]}
                    onPress={() => handleUnitChange('lbs')}
                    activeOpacity={0.8}
                    accessibilityLabel="Set unit system to Pounds (lbs)"
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        unitSystem === 'lbs' && styles.segmentTextActive,
                      ]}
                    >
                      Imperial (lbs)
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Section: Intensity Metric */}
              <Text style={styles.sectionTitle}>EFFORT & EXERTION METRIC</Text>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Default Intensity Metric</Text>
                  <Text style={styles.settingValueBadge}>
                    {intensityMetric}
                  </Text>
                </View>
                <Text style={styles.settingDescription}>
                  Choose how you prefer to gauge proximity to failure during working sets:
                  {'\n'}• RPE: Rate of Perceived Exertion (6.0 – 10.0)
                  {'\n'}• RIR: Reps in Reserve (0.0 – 4.0)
                </Text>

                <View style={styles.segmentedControl}>
                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      intensityMetric === 'RPE' && styles.segmentButtonActive,
                    ]}
                    onPress={() => handleIntensityChange('RPE')}
                    activeOpacity={0.8}
                    accessibilityLabel="Set intensity metric to RPE"
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        intensityMetric === 'RPE' && styles.segmentTextActive,
                      ]}
                    >
                      RPE (6.0 – 10.0)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      intensityMetric === 'RIR' && styles.segmentButtonActive,
                    ]}
                    onPress={() => handleIntensityChange('RIR')}
                    activeOpacity={0.8}
                    accessibilityLabel="Set intensity metric to RIR"
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        intensityMetric === 'RIR' && styles.segmentTextActive,
                      ]}
                    >
                      RIR (0 – 4 Reps)
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Section: Cognitive Mode */}
              <Text style={styles.sectionTitle}>EXPERIENCE & UTILITY</Text>

              <View style={styles.settingCard}>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleLabelContainer}>
                    <Text style={styles.settingLabel}>Pure Utility Mode</Text>
                    <Text style={styles.toggleSubtext}>
                      Strips gamification, social leaderboards, animations, and non-essential
                      elements for maximum cognitive focus and battery savings in the gym.
                    </Text>
                  </View>

                  <Switch
                    value={pureUtilityMode}
                    onValueChange={handleUtilityModeToggle}
                    trackColor={{ false: uiColors.border, true: uiColors.accent }}
                    thumbColor={pureUtilityMode ? uiColors.background : uiColors.muted}
                    accessibilityLabel="Toggle Pure Utility Mode"
                  />
                </View>
              </View>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Automated Warm-Up Sets</Text>
                  <Text style={styles.settingValueBadge}>
                    {autoWarmupMode === 'smart_compounds'
                      ? 'SMART COMPOUNDS'
                      : autoWarmupMode === 'all_exercises'
                        ? 'ALL LIFTS'
                        : 'MANUAL ONLY'}
                  </Text>
                </View>
                <Text style={styles.settingDescription}>
                  Synthesizes an individualized warm-up progression ladder (bar tare, 50%, 70%, diagnostic single) when starting a workout or adding exercises:
                  {'\n'}• Smart Compounds: Prepares multi-joint compound lifts only, attenuating sets if the muscle group is already warmed up.
                  {'\n'}• All Lifts: Generates warm-up sets for every added movement.
                  {'\n'}• Manual Only: Use Add Set in the logger, then tap its set-type tag to change it to Warm.
                </Text>

                <View style={styles.segmentedControl}>
                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      autoWarmupMode === 'smart_compounds' && styles.segmentButtonActive,
                    ]}
                    onPress={() => handleAutoWarmupChange('smart_compounds')}
                    activeOpacity={0.8}
                    accessibilityLabel="Set automated warm-up mode to Smart Compounds"
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        autoWarmupMode === 'smart_compounds' && styles.segmentTextActive,
                      ]}
                    >
                      Smart Compounds
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      autoWarmupMode === 'all_exercises' && styles.segmentButtonActive,
                    ]}
                    onPress={() => handleAutoWarmupChange('all_exercises')}
                    activeOpacity={0.8}
                    accessibilityLabel="Set automated warm-up mode to All Lifts"
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        autoWarmupMode === 'all_exercises' && styles.segmentTextActive,
                      ]}
                    >
                      All Lifts
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      autoWarmupMode === 'off' && styles.segmentButtonActive,
                    ]}
                    onPress={() => handleAutoWarmupChange('off')}
                    activeOpacity={0.8}
                    accessibilityLabel="Set automated warm-up mode to Manual Only"
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        autoWarmupMode === 'off' && styles.segmentTextActive,
                      ]}
                    >
                      Manual Only
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.toggleRow, styles.smartWarmupToggle]}>
                  <Text style={styles.settingLabel}>Smart Warmup</Text>
                  <Switch
                    testID="smart-warmup-switch"
                    value={smartWarmup}
                    onValueChange={handleSmartWarmupToggle}
                    trackColor={{ false: uiColors.border, true: uiColors.accent }}
                    thumbColor={smartWarmup ? uiColors.background : uiColors.muted}
                    accessibilityLabel="Suggest working loads from the last warm-up set"
                  />
                </View>
                <Text style={styles.settingDescription}>
                  Rate how your last warm-up set felt to get working-load suggestions. Review and
                  confirm each suggestion before it changes your remaining sets.
                </Text>
              </View>
            </>
          )}

          {activeSection === 'tools' && (
            <>
              {/* Section: Gym Equipment & Library */}
              <Text style={styles.sectionTitle}>EXERCISE CATALOG & EQUIPMENT</Text>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Exercise Library & Variant Tree</Text>
                </View>
                <Text style={styles.settingDescription}>
                  Browse the catalog of movements, create custom exercises, and link variants to root movements for cross-variant strength tracking and PR benchmarking.
                </Text>
                {exerciseRepo ? (
                  <TouchableOpacity
                    testID="open-exercise-library-btn"
                    style={styles.actionNavigateBtn}
                    onPress={() => setShowExerciseLibrary(true)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.actionNavigateBtnText}>Manage Exercise Library ➔</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.disabledText}>Repository not connected</Text>
                )}
              </View>

              {/* Section: Training Programs & Progression (Step 4.4) */}
              <Text style={styles.sectionTitle}>TRAINING PROGRAMS & PROGRESSION</Text>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Program Builder & Progression Rules</Text>
                </View>
                <Text style={styles.settingDescription}>
                  Manage active programs, multi-day training splits, prescribed exercises and set schemes, or launch the visual IF/THEN progression rule builder.
                </Text>
                {programRepo ? (
                  <TouchableOpacity
                    testID="open-program-overview-btn"
                    style={styles.actionNavigateBtn}
                    onPress={() => setShowProgramOverview(true)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.actionNavigateBtnText}>Manage Programs & Rules ➔</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.disabledText}>Program repository not connected</Text>
                )}
              </View>
            </>
          )}

          {activeSection === 'data' && (
            <>
              {/* Section: Data & Backup (Step 2.3) */}
              <Text style={styles.sectionTitle}>DATA & BACKUP</Text>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Export Database (JSON)</Text>
                  <Text style={styles.settingValueBadge}>SCHEMA v1.0.0</Text>
                </View>
                <Text style={styles.settingDescription}>
                  Export full SQLite database state into the contract-verified JSON format
                  (schemas/workout_export.schema.json) for cross-device transfer, offline backup,
                  and Companion analytics ingestion.
                </Text>

                {exportStatus ? (
                  <View style={styles.exportStatusBanner}>
                    <Text style={styles.exportStatusText}>{exportStatus}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  testID="export-json-btn"
                  style={[
                    styles.actionNavigateBtn,
                    exporting && styles.actionNavigateBtnDisabled,
                  ]}
                  onPress={handleExportData}
                  disabled={exporting}
                  activeOpacity={0.8}
                >
                  {exporting ? (
                    <View style={styles.buttonInlineRow}>
                      <ActivityIndicator size="small" color={uiColors.accent} />
                      <Text style={[styles.actionNavigateBtnText, { marginLeft: 8 }]}>
                        Exporting Database...
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.actionNavigateBtnText}>
                      Export Data (JSON) ➔
                    </Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Import Training History (CSV)</Text>
                </View>
                <Text style={styles.settingDescription}>
                  Import workout logs from CSV spreadsheets or workout tracker exports.
                  Includes automatic movement matching against library and duplicate session detection.
                </Text>

                {importStatus ? (
                  <View style={styles.exportStatusBanner}>
                    <Text style={styles.exportStatusText}>{importStatus}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  testID="open-import-history-btn"
                  style={styles.actionNavigateBtn}
                  onPress={() => setShowImportScreen(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.actionNavigateBtnText}>
                    Import Workouts (CSV Wizard) ➔
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Import Calibrated 1RM & k (JSON)</Text>
                  <Text style={styles.settingValueBadge}>TIER 2 KF</Text>
                </View>
                <Text style={styles.settingDescription}>
                  Import calibrated (1RM, k) parameters exported from the Companion Python Kalman Filter
                  to upgrade in-gym e1RM calculations with individualized endurance exponents.
                </Text>

                {calibratedStatus ? (
                  <View style={styles.exportStatusBanner}>
                    <Text style={styles.exportStatusText}>{calibratedStatus}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  testID="import-calibrated-params-btn"
                  style={[
                    styles.actionNavigateBtn,
                    importingCalib && styles.actionNavigateBtnDisabled,
                  ]}
                  onPress={handleImportCalibratedParams}
                  disabled={importingCalib}
                  activeOpacity={0.8}
                >
                  {importingCalib ? (
                    <View style={styles.buttonInlineRow}>
                      <ActivityIndicator size="small" color={uiColors.accent} />
                      <Text style={[styles.actionNavigateBtnText, { marginLeft: 8 }]}>
                        Importing Parameters...
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.actionNavigateBtnText}>
                      Import Calibrated Parameters (JSON) ➔
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {activeSection === 'about' && (
            <>
              {/* Section: Storage & Diagnostics */}
              <Text style={styles.sectionTitle}>LOCAL STORAGE & ENGINE</Text>


              <View style={styles.diagnosticsCard}>
                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>Persistence Engine</Text>
                  <Text style={styles.diagValue}>expo-sqlite (Local-First)</Text>
                </View>
                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>Journal Mode</Text>
                  <Text style={styles.diagValue}>WAL (Write-Ahead Logging)</Text>
                </View>
                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>Foreign Key Constraints</Text>
                  <Text style={styles.diagValueAccent}>ACTIVE (ON)</Text>
                </View>
                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>Crash Recovery Protocol</Text>
                  <Text style={styles.diagValueAccent}>Write-Through</Text>
                </View>
                <View style={[styles.diagRow, styles.diagRowLast]}>
                  <Text style={styles.diagLabel}>Suite Version</Text>
                  <Text style={styles.diagValue}>datSet v1.0.0 (Production Release)</Text>
                </View>
              </View>

              {/* Section: Scientific Citations & Legal Disclaimers */}
              <Text style={styles.sectionTitle}>SCIENTIFIC CITATIONS & LEGAL</Text>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Scientific Models & Formulas</Text>
                  <Text style={styles.settingValueBadge}>PEER-REVIEWED</Text>
                </View>
                <Text style={styles.settingDescription}>
                  datSet utilizes verified, peer-reviewed exercise physiology and biomechanical models for all load auto-regulation, endurance scaling, and relative strength estimation:
                </Text>

                <View style={styles.referenceBlock}>
                  <Text style={styles.referenceHeading}>• Estimated 1RM Heuristics</Text>
                  <Text style={styles.referenceDetail}>
                    Epley (1985): 1RM = w · (1 + r / 30){'\n'}
                    Brzycki (1993): 1RM = w / (1.0278 - 0.0278 · r){'\n'}
                    Discounted for RPE / RIR offsets according to Helms et al. (2016) and Zourdos et al. (2016).
                  </Text>

                  <Text style={styles.referenceHeading}>• Relative Strength & Standardization</Text>
                  <Text style={styles.referenceDetail}>
                    DOTS Formula (Donald O. Travis, 2019): Fourth-order polynomial bodyweight scaling coefficient for comparative powerlifting strength analysis.
                  </Text>

                  <Text style={styles.referenceHeading}>• Body Composition Estimation</Text>
                  <Text style={styles.referenceDetail}>
                    U.S. Navy Circumference Method (Hodgdon & Beckett, 1984): Logarithmic neck, waist, hip, and height anthropometric equations.
                  </Text>

                  <Text style={styles.referenceHeading}>• Fatigue & Recovery Modeling (Companion)</Text>
                  <Text style={styles.referenceDetail}>
                    Banister Impulse-Response Systems Model (1975): Dual-exponential fitness-fatigue differential impulse tracking.
                  </Text>
                </View>
              </View>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Health & Medical Disclaimer</Text>
                  <Text style={[styles.settingValueBadge, styles.warningBadge]}>INFORMATIONAL</Text>
                </View>
                <Text style={styles.settingDescription}>
                  datSet is an informational training ledger and mathematical auto-regulation toolkit, not a medical diagnostics provider or licensed healthcare service.
                  {'\n\n'}
                  Training prescriptions, warm-up ladders, and pain interception heuristics are general training suggestions. If you experience sharp, radiating, or persistent joint or muscular pain, discontinue the movement and consult a licensed physician or physical therapist.
                </Text>
              </View>

              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>Privacy & Local Data Policy</Text>
                  <Text style={styles.settingValueBadge}>OFFLINE-FIRST</Text>
                </View>
                <Text style={styles.settingDescription}>
                  100% On-Device Storage: All workout logs, personal records, body metrics, and equipment inventories are stored in an encrypted/isolated SQLite database on your device.
                  {'\n\n'}
                  datSet does not track, sell, or transmit any health or personal data to remote servers or third-party analytics providers.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      )}



      {/* Full-Screen Program Builder & Progression Rules Modal (Step 4.4) */}
      {programRepo && (
        <Modal
          visible={showProgramOverview}
          animationType="slide"
          onRequestClose={() => setShowProgramOverview(false)}
        >
          <ProgramOverviewScreen
            programRepo={programRepo}
            programBlockService={
              programBlockService ?? new ProgramBlockService(programRepo)
            }
            exerciseRepo={exerciseRepo}
            gearRepo={gearRepo}
            onClose={() => setShowProgramOverview(false)}
            onSelectProgram={() => {
              if (onSettingsChange) {
                onSettingsChange();
              }
            }}
          />
        </Modal>
      )}

      {/* Full-Screen Exercise Library Modal */}
      {exerciseRepo && (
        <Modal
          visible={showExerciseLibrary}
          animationType="slide"
          onRequestClose={() => setShowExerciseLibrary(false)}
        >
          <ExerciseLibraryScreen
            exerciseRepo={exerciseRepo}
            workoutRepo={workoutRepo}
            gearRepo={gearRepo}
            userSettingsRepo={userSettingsRepo}
            onClose={() => setShowExerciseLibrary(false)}
          />
        </Modal>
      )}

      {/* Full-Screen Import Wizard Modal */}
      {showImportScreen && (workoutRepo || importService) && (
        <Modal
          visible={showImportScreen}
          animationType="slide"
          onRequestClose={() => setShowImportScreen(false)}
        >
          <ImportScreen
            importService={
              importService ??
              new ImportService(
                workoutRepo!,
                exerciseRepo!,
                bodyMetricsRepo
              )
            }
            onClose={() => setShowImportScreen(false)}
            onNavigateToCalendar={() => {
              setShowImportScreen(false);
              if (onNavigateToCalendar) {
                onNavigateToCalendar();
              }
            }}
            onImportComplete={(result) => {
              setImportStatus(
                `Successfully imported ${result.importedWorkoutsCount} workouts (${result.importedSetsCount} sets)`
              );
              if (onSettingsChange) {
                onSettingsChange();
              }
            }}
          />
        </Modal>
      )}
    </View>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: uiColors.background,
  },
  sectionTabBar: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    backgroundColor: uiColors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
    gap: 8,
  },
  sectionTabBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    flex: 1,
    paddingVertical: 8,
    borderRadius: uiRadius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
  },
  sectionTabBtnActive: {
    backgroundColor: uiColors.border,
    borderWidth: 1,
    borderColor: uiColors.accent,
  },
  sectionTabText: {
    color: uiColors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTabTextActive: {
    color: uiColors.accentText,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: uiColors.muted,
    fontSize: 14,
    marginTop: 12,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: uiColors.text,
    letterSpacing: 0,
    marginTop: 20,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  settingCard: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 16,
    marginBottom: 8,
  },
  settingHeader: {
    gap: 8,
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  settingLabel: {
    lineHeight: 22,
    fontSize: 16,
    fontWeight: '600',
    color: uiColors.text,
  },
  settingValueBadge: {
    minHeight: 26,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    lineHeight: 16,
    fontSize: 11,
    fontWeight: '600',
    color: uiColors.accentText,
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.3)',
  },
  settingDescription: {
    fontSize: 13,
    color: uiColors.muted,
    lineHeight: 18,
    marginBottom: 14,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: uiColors.raised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 3,
  },
  segmentButton: {
    minHeight: 44,
    paddingHorizontal: 8,
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: uiRadius.control,
  },
  segmentButtonActive: {
    backgroundColor: uiColors.border,
  },
  segmentText: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: uiColors.subtle,
  },
  segmentTextActive: {
    color: uiColors.accentText,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  smartWarmupToggle: {
    marginTop: 16,
    paddingTop: 16,
    marginBottom: 12,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
  },
  toggleLabelContainer: {
    flex: 1,
    paddingRight: 12,
  },
  toggleSubtext: {
    fontSize: 12,
    color: uiColors.subtle,
    marginTop: 4,
    lineHeight: 17,
  },
  diagnosticsCard: {
    backgroundColor: uiColors.background,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 16,
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  diagRowLast: {
    borderBottomWidth: 0,
  },
  diagLabel: {
    fontSize: 13,
    color: uiColors.muted,
    fontWeight: '600',
  },
  diagValue: {
    fontSize: 13,
    color: uiColors.text,
    fontWeight: '700',
  },
  diagValueAccent: {
    fontSize: 13,
    color: uiColors.accentText,
    fontWeight: '700',
  },
  actionNavigateBtn: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.control,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  actionNavigateBtnText: {
    color: uiColors.accentText,
    fontSize: 13,
    fontWeight: '700',
  },
  disabledText: {
    color: uiColors.subtle,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
  },
  actionNavigateBtnDisabled: {
    opacity: 0.6,
  },
  buttonInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportStatusBanner: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  exportStatusText: {
    color: uiColors.accentText,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  referenceBlock: {
    backgroundColor: uiColors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 12,
    marginTop: 4,
  },
  referenceHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.accentText,
    marginTop: 8,
    marginBottom: 2,
  },
  referenceDetail: {
    fontSize: 12,
    color: uiColors.muted,
    lineHeight: 17,
  },
  warningBadge: {
    color: '#FFB300',
    backgroundColor: 'rgba(255, 179, 0, 0.12)',
    borderColor: 'rgba(255, 179, 0, 0.3)',
  },
});
