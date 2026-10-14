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
} from 'react-native';
import { WeightUnit, IntensityMetric } from '../../core/types';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';

export interface SettingsScreenProps {
  userSettingsRepo: IUserSettingsRepository;
  onSettingsChange?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  userSettingsRepo,
  onSettingsChange,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [intensityMetric, setIntensityMetric] = useState<IntensityMetric>('RPE');
  const [pureUtilityMode, setPureUtilityMode] = useState<boolean>(false);

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
              All weights are stored canonically in kilograms (ADR-008). Values
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
                  ADR-024: Strips gamification, social leaderboards, animations, and non-essential
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
              <Text style={styles.diagValueAccent}>Write-Through (ADR-010)</Text>
            </View>
            <View style={[styles.diagRow, styles.diagRowLast]}>
              <Text style={styles.diagLabel}>Suite Version</Text>
              <Text style={styles.diagValue}>1.0.0 (Phase 1 MVP)</Text>
            </View>
          </View>
        </ScrollView>
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
});
