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
import { WeightUnit, IntensityMetric } from '../../core/types';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';
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
  onSettingsChange?: () => void;
}

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
  onSettingsChange,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [intensityMetric, setIntensityMetric] = useState<IntensityMetric>('RPE');
  const [pureUtilityMode, setPureUtilityMode] = useState<boolean>(false);

  const [showExerciseLibrary, setShowExerciseLibrary] = useState<boolean>(false);
  const [showImportScreen, setShowImportScreen] = useState<boolean>(false);
  const [showProgramOverview, setShowProgramOverview] = useState<boolean>(false);

  const [exporting, setExporting] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

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
      const [unit, intensity, utility] = await Promise.all([
        userSettingsRepo.getUnitSystem(),
        userSettingsRepo.getIntensityMetric(),
        userSettingsRepo.getPureUtilityMode(),
      ]);
      setUnitSystem(unit);
      setIntensityMetric(intensity);
      setPureUtilityMode(utility);
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

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
        <Text style={styles.headerSubtitle}>
          Preferences & Gym Defaults
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#00E676" size="large" />
          <Text style={styles.loadingText}>Loading preferences...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
        >
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
                trackColor={{ false: '#27272A', true: '#00E676' }}
                thumbColor={pureUtilityMode ? '#000000' : '#A1A1AA'}
                accessibilityLabel="Toggle Pure Utility Mode"
              />
            </View>
          </View>

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
                  <ActivityIndicator size="small" color="#00E676" />
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
              <Text style={styles.diagValue}>1.0.0 (Phase 1 MVP)</Text>
            </View>
          </View>
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
    backgroundColor: '#000000',
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FAFAFA',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#A1A1AA',
    marginTop: 2,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#A1A1AA',
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
    fontSize: 12,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  settingCard: {
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  settingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  settingValueBadge: {
    fontSize: 12,
    fontWeight: '800',
    color: '#00E676',
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.3)',
  },
  settingDescription: {
    fontSize: 13,
    color: '#A1A1AA',
    lineHeight: 18,
    marginBottom: 14,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#18181B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 3,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentButtonActive: {
    backgroundColor: '#27272A',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#71717A',
  },
  segmentTextActive: {
    color: '#00E676',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabelContainer: {
    flex: 1,
    paddingRight: 12,
  },
  toggleSubtext: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 4,
    lineHeight: 17,
  },
  diagnosticsCard: {
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 16,
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  diagRowLast: {
    borderBottomWidth: 0,
  },
  diagLabel: {
    fontSize: 13,
    color: '#A1A1AA',
    fontWeight: '600',
  },
  diagValue: {
    fontSize: 13,
    color: '#FAFAFA',
    fontWeight: '700',
  },
  diagValueAccent: {
    fontSize: 13,
    color: '#00E676',
    fontWeight: '700',
  },
  actionNavigateBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  actionNavigateBtnText: {
    color: '#00E676',
    fontSize: 13,
    fontWeight: '800',
  },
  disabledText: {
    color: '#71717A',
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
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  exportStatusText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});


