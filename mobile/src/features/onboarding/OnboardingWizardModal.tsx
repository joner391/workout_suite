/**
 * Workout Suite / datSet — Onboarding Wizard Modal
 *
 * Implements 3-step first-launch wizard:
 * 1. Choose Units (kg vs lbs) & Bar Weight (20kg / 15kg / 25kg) & Intensity Metric (RPE vs RIR).
 * 2. Pick starter equipment profile (Commercial Gym, Barbell Home Gym, Dumbbell Only) & weekly frequency.
 * 3. Starter program generation (via programSynthesizer.ts), CSV import option, and mandatory medical disclaimer.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import {
  WeightUnit,
  IntensityMetric,
  UserProfile,
  Exercise,
} from '../../core/types';
import {
  IUserSettingsRepository,
  IUserProfileRepository,
  IProgramRepository,
  IExerciseRepository,
} from '../../domain/repositories';
import { ProgramBlockService } from '../../services/programBlockService';
import { synthesizeProgram } from '../../core/generator/programSynthesizer';

export interface OnboardingWizardModalProps {
  visible: boolean;
  userSettingsRepo: IUserSettingsRepository;
  userProfileRepo?: IUserProfileRepository;
  programRepo?: IProgramRepository;
  programBlockService?: ProgramBlockService;
  exerciseRepo?: IExerciseRepository;
  onComplete: () => void;
  onNavigateToImport?: () => void;
}

export type StarterAction = 'generate' | 'import' | 'blank';

export const OnboardingWizardModal: React.FC<OnboardingWizardModalProps> = ({
  visible,
  userSettingsRepo,
  userProfileRepo,
  programRepo,
  programBlockService,
  exerciseRepo,
  onComplete,
  onNavigateToImport,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState<boolean>(false);

  // Step 1 State: Units & Bar Specs
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [barWeight, setBarWeight] = useState<number>(20);
  const [intensityMetric, setIntensityMetric] = useState<IntensityMetric>('RPE');

  // Step 2 State: Equipment & Frequency
  const [equipmentAccess, setEquipmentAccess] = useState<
    'commercial_gym' | 'garage_gym' | 'dumbbells_only'
  >('commercial_gym');
  const [daysPerWeek, setDaysPerWeek] = useState<number>(4);

  // Step 3 State: Starter Action
  const [starterAction, setStarterAction] = useState<StarterAction>('generate');

  const handleFinish = async () => {
    try {
      setSaving(true);

      // 1. Save core user settings
      await userSettingsRepo.set('unit_system', unitSystem);
      await userSettingsRepo.set('intensity_metric', intensityMetric);
      await userSettingsRepo.set('default_bar_weight_kg', barWeight.toString());
      await userSettingsRepo.set('onboarding_completed', '1');

      // 2. Save profile preferences
      if (userProfileRepo) {
        const profile: UserProfile = {
          id: 'default_profile',
          gender: 'male',
          birthdate: null,
          height_cm: null,
          training_mentality: 'precision',
          primary_goal: 'hypertrophy',
          secondary_goals: null,
          preferred_days_per_week: daysPerWeek,
          preferred_session_duration_mins: 60,
          equipment_access: equipmentAccess,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await userProfileRepo.saveProfile(profile);

        // 3. Optional Program Generation
        if (
          starterAction === 'generate' &&
          programRepo &&
          programBlockService
        ) {
          let catalog: Exercise[] | undefined = undefined;
          if (exerciseRepo) {
            catalog = await exerciseRepo.findAll();
          }

          const synthesized = synthesizeProgram(profile, {
            availableExercises: catalog,
          });

          await programRepo.saveSynthesizedProgram(synthesized);
          await programBlockService.swapActiveProgram(synthesized.program.id);
        }
      }

      setSaving(false);
      onComplete();

      if (starterAction === 'import' && onNavigateToImport) {
        onNavigateToImport();
      }
    } catch (err) {
      console.error('Error completing onboarding wizard:', err);
      setSaving(false);
      onComplete();
    }
  };

  return (
    <Modal
      testID="onboarding-wizard-modal"
      visible={visible}
      animationType="fade"
      transparent={false}
    >
      <View style={styles.container}>
        {/* Step Indicator Header */}
        <View style={styles.header}>
          <Text style={styles.brandTitle}>datSet</Text>
          <Text style={styles.wizardSubtitle}>INITIAL SETUP ({step}/3)</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${(step / 3) * 100}%` }]} />
          </View>
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
          {/* STEP 1: Units, Bar Tare & Intensity */}
          {step === 1 && (
            <View testID="onboarding-step-1">
              <Text style={styles.stepTitle}>Units & Gym Defaults</Text>
              <Text style={styles.stepDescription}>
                Configure your preferred measurement system and standard barbell weight.
              </Text>

              {/* Unit System */}
              <Text style={styles.inputLabel}>UNIT SYSTEM</Text>
              <View style={styles.optionRow}>
                <TouchableOpacity
                  testID="unit-kg-btn"
                  style={[styles.pillOption, unitSystem === 'kg' && styles.pillOptionActive]}
                  onPress={() => {
                    setUnitSystem('kg');
                    if (barWeight === 45) setBarWeight(20);
                  }}
                >
                  <Text
                    style={[
                      styles.pillOptionText,
                      unitSystem === 'kg' && styles.pillOptionTextActive,
                    ]}
                  >
                    Metric (kg)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="unit-lbs-btn"
                  style={[styles.pillOption, unitSystem === 'lbs' && styles.pillOptionActive]}
                  onPress={() => {
                    setUnitSystem('lbs');
                    if (barWeight === 20) setBarWeight(45);
                  }}
                >
                  <Text
                    style={[
                      styles.pillOptionText,
                      unitSystem === 'lbs' && styles.pillOptionTextActive,
                    ]}
                  >
                    Imperial (lbs)
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Bar Tare Weight */}
              <Text style={styles.inputLabel}>
                DEFAULT BARBELL TARE ({unitSystem.toUpperCase()})
              </Text>
              <View style={styles.optionRow}>
                {unitSystem === 'kg' ? (
                  <>
                    <TouchableOpacity
                      testID="bar-20kg-btn"
                      style={[styles.pillOption, barWeight === 20 && styles.pillOptionActive]}
                      onPress={() => setBarWeight(20)}
                    >
                      <Text
                        style={[
                          styles.pillOptionText,
                          barWeight === 20 && styles.pillOptionTextActive,
                        ]}
                      >
                        20 kg (Standard Olympic)
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="bar-15kg-btn"
                      style={[styles.pillOption, barWeight === 15 && styles.pillOptionActive]}
                      onPress={() => setBarWeight(15)}
                    >
                      <Text
                        style={[
                          styles.pillOptionText,
                          barWeight === 15 && styles.pillOptionTextActive,
                        ]}
                      >
                        15 kg (Short/Women's)
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      testID="bar-45lbs-btn"
                      style={[styles.pillOption, barWeight === 45 && styles.pillOptionActive]}
                      onPress={() => setBarWeight(45)}
                    >
                      <Text
                        style={[
                          styles.pillOptionText,
                          barWeight === 45 && styles.pillOptionTextActive,
                        ]}
                      >
                        45 lbs (Standard Olympic)
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="bar-35lbs-btn"
                      style={[styles.pillOption, barWeight === 35 && styles.pillOptionActive]}
                      onPress={() => setBarWeight(35)}
                    >
                      <Text
                        style={[
                          styles.pillOptionText,
                          barWeight === 35 && styles.pillOptionTextActive,
                        ]}
                      >
                        35 lbs (Short/Women's)
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>

              {/* Intensity Metric */}
              <Text style={styles.inputLabel}>PRIMARY INTENSITY METRIC</Text>
              <View style={styles.optionRow}>
                <TouchableOpacity
                  testID="intensity-rpe-btn"
                  style={[
                    styles.pillOption,
                    intensityMetric === 'RPE' && styles.pillOptionActive,
                  ]}
                  onPress={() => setIntensityMetric('RPE')}
                >
                  <Text
                    style={[
                      styles.pillOptionText,
                      intensityMetric === 'RPE' && styles.pillOptionTextActive,
                    ]}
                  >
                    RPE (Rate of Perceived Exertion)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="intensity-rir-btn"
                  style={[
                    styles.pillOption,
                    intensityMetric === 'RIR' && styles.pillOptionActive,
                  ]}
                  onPress={() => setIntensityMetric('RIR')}
                >
                  <Text
                    style={[
                      styles.pillOptionText,
                      intensityMetric === 'RIR' && styles.pillOptionTextActive,
                    ]}
                  >
                    RIR (Reps In Reserve)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* STEP 2: Equipment Profile & Routine Frequency */}
          {step === 2 && (
            <View testID="onboarding-step-2">
              <Text style={styles.stepTitle}>Equipment & Routine</Text>
              <Text style={styles.stepDescription}>
                Select your training environment and how many days per week you plan to lift.
              </Text>

              {/* Equipment Cards */}
              <Text style={styles.inputLabel}>EQUIPMENT ACCESS</Text>

              <TouchableOpacity
                testID="equip-commercial-btn"
                style={[
                  styles.cardOption,
                  equipmentAccess === 'commercial_gym' && styles.cardOptionActive,
                ]}
                onPress={() => setEquipmentAccess('commercial_gym')}
              >
                <Text style={styles.cardOptionTitle}>🏋️ Commercial Gym</Text>
                <Text style={styles.cardOptionDesc}>
                  Full access to barbells, racks, dumbbells, cables, and selectorized machines.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="equip-home-btn"
                style={[
                  styles.cardOption,
                  equipmentAccess === 'garage_gym' && styles.cardOptionActive,
                ]}
                onPress={() => setEquipmentAccess('garage_gym')}
              >
                <Text style={styles.cardOptionTitle}>🏠 Barbell Home / Garage Gym</Text>
                <Text style={styles.cardOptionDesc}>
                  Squat rack, Olympic barbell, bench, weight plates, and pull-up bar.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="equip-dumbbell-btn"
                style={[
                  styles.cardOption,
                  equipmentAccess === 'dumbbells_only' && styles.cardOptionActive,
                ]}
                onPress={() => setEquipmentAccess('dumbbells_only')}
              >
                <Text style={styles.cardOptionTitle}>🧱 Dumbbells Only</Text>
                <Text style={styles.cardOptionDesc}>
                  Adjustable dumbbell pairs and flat/incline utility bench.
                </Text>
              </TouchableOpacity>

              {/* Days Per Week */}
              <Text style={[styles.inputLabel, { marginTop: 16 }]}>TRAINING DAYS PER WEEK</Text>
              <View style={styles.optionRow}>
                <TouchableOpacity
                  testID="days-3-btn"
                  style={[styles.pillOption, daysPerWeek === 3 && styles.pillOptionActive]}
                  onPress={() => setDaysPerWeek(3)}
                >
                  <Text
                    style={[
                      styles.pillOptionText,
                      daysPerWeek === 3 && styles.pillOptionTextActive,
                    ]}
                  >
                    3 Days (Full Body)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="days-4-btn"
                  style={[styles.pillOption, daysPerWeek === 4 && styles.pillOptionActive]}
                  onPress={() => setDaysPerWeek(4)}
                >
                  <Text
                    style={[
                      styles.pillOptionText,
                      daysPerWeek === 4 && styles.pillOptionTextActive,
                    ]}
                  >
                    4 Days (Upper / Lower)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="days-5-btn"
                  style={[styles.pillOption, daysPerWeek === 5 && styles.pillOptionActive]}
                  onPress={() => setDaysPerWeek(5)}
                >
                  <Text
                    style={[
                      styles.pillOptionText,
                      daysPerWeek === 5 && styles.pillOptionTextActive,
                    ]}
                  >
                    5 Days (Push / Pull / Legs)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* STEP 3: Starter Program & Medical Disclaimer */}
          {step === 3 && (
            <View testID="onboarding-step-3">
              <Text style={styles.stepTitle}>Starter Program & Safety</Text>
              <Text style={styles.stepDescription}>
                Choose how you want to kick off your training in datSet.
              </Text>

              {/* Action Selection */}
              <TouchableOpacity
                testID="starter-generate-btn"
                style={[
                  styles.cardOption,
                  starterAction === 'generate' && styles.cardOptionActive,
                ]}
                onPress={() => setStarterAction('generate')}
              >
                <Text style={styles.cardOptionTitle}>⚡ Synthesize Starter Program</Text>
                <Text style={styles.cardOptionDesc}>
                  Automatically generate a {daysPerWeek}-day split configured for your equipment
                  with built-in progressive overload auto-regulation.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="starter-import-btn"
                style={[
                  styles.cardOption,
                  starterAction === 'import' && styles.cardOptionActive,
                ]}
                onPress={() => setStarterAction('import')}
              >
                <Text style={styles.cardOptionTitle}>📁 Import Existing History</Text>
                <Text style={styles.cardOptionDesc}>
                  1-click import from StrengthLog, Liftosaur, Hevy, or Strong CSV exports.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="starter-blank-btn"
                style={[
                  styles.cardOption,
                  starterAction === 'blank' && styles.cardOptionActive,
                ]}
                onPress={() => setStarterAction('blank')}
              >
                <Text style={styles.cardOptionTitle}>📝 Start with Blank Canvas</Text>
                <Text style={styles.cardOptionDesc}>
                  Build routines and meso-cycles completely from scratch.
                </Text>
              </TouchableOpacity>

              {/* Prominent Medical & Legal Disclaimer */}
              <View style={styles.disclaimerCard}>
                <Text style={styles.disclaimerHeader}>⚠️ Health & Medical Disclaimer</Text>
                <Text style={styles.disclaimerText}>
                  datSet is a local-first software utility providing mathematical training load
                  heuristics, 1RM equations (Epley, Brzycki), and auto-regulation algorithms for
                  informational fitness purposes only.
                  {'\n\n'}
                  The app does NOT provide medical diagnosis, physical therapy, or healthcare
                  advice. Always consult a licensed physician or physiotherapist before beginning an
                  intensive resistance training program or if experiencing joint or muscle pain.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Wizard Footer Navigation */}
        <View style={styles.footer}>
          {step > 1 ? (
            <TouchableOpacity
              testID="wizard-prev-btn"
              style={styles.backButton}
              onPress={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
              disabled={saving}
            >
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {step < 3 ? (
            <TouchableOpacity
              testID="wizard-next-btn"
              style={styles.nextButton}
              onPress={() => setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s))}
            >
              <Text style={styles.nextButtonText}>Next →</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              testID="wizard-finish-btn"
              style={[styles.nextButton, styles.finishButton]}
              onPress={handleFinish}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#000000" size="small" />
              ) : (
                <Text style={styles.finishButtonText}>Complete Setup ✓</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  header: {
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#27272A',
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FAFAFA',
    letterSpacing: 0.5,
  },
  wizardSubtitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00E676',
    letterSpacing: 1,
    marginTop: 2,
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#27272A',
    borderRadius: 2,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#00E676',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FAFAFA',
    marginBottom: 6,
  },
  stepDescription: {
    fontSize: 13,
    color: '#A1A1AA',
    marginBottom: 20,
    lineHeight: 18,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  pillOption: {
    flexGrow: 1,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  pillOptionActive: {
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    borderColor: '#00E676',
  },
  pillOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#A1A1AA',
  },
  pillOptionTextActive: {
    color: '#00E676',
    fontWeight: '800',
  },
  cardOption: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
  },
  cardOptionActive: {
    backgroundColor: 'rgba(0, 230, 118, 0.08)',
    borderColor: '#00E676',
  },
  cardOptionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FAFAFA',
    marginBottom: 4,
  },
  cardOptionDesc: {
    fontSize: 12,
    color: '#A1A1AA',
    lineHeight: 16,
  },
  disclaimerCard: {
    backgroundColor: '#18181B',
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
    borderRadius: 8,
    padding: 14,
    marginTop: 14,
  },
  disclaimerHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F59E0B',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  disclaimerText: {
    fontSize: 11,
    color: '#A1A1AA',
    lineHeight: 16,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#27272A',
    backgroundColor: '#09090B',
  },
  backButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    marginRight: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#A1A1AA',
  },
  nextButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#00E676',
    borderRadius: 8,
  },
  nextButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000000',
  },
  finishButton: {
    backgroundColor: '#00E676',
  },
  finishButtonText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#000000',
  },
});
