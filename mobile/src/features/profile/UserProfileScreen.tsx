/**
 * Workout Suite — UserProfileScreen
 *
 * Implements Step 4.4: Questionnaire UI, Psychological Matrix & Program Generator
 * Implements ADR-014: Multi-Dimensional User Profile & Psychological Preference Matrix
 * Implements ADR-038: Profile-Driven Program Synthesizer Pure Generator
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import {
  UserProfile,
  Gender,
  TrainingEnjoyment,
  IntensityStyle,
  PrimaryGoal,
  EquipmentAccess,
  SynthesizedProgramSummary,
  Exercise,
} from '../../core/types';
import { IUserProfileRepository } from '../../domain/repositories/IUserProfileRepository';
import { IProgramRepository } from '../../domain/repositories/IProgramRepository';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import { ProgramBlockService } from '../../services/programBlockService';
import { synthesizeProgram } from '../../core/generator/programSynthesizer';

export interface UserProfileScreenProps {
  userProfileRepo: IUserProfileRepository;
  programRepo?: IProgramRepository;
  programBlockService?: ProgramBlockService;
  exerciseRepo?: IExerciseRepository;
  onClose?: () => void;
  onProgramGenerated?: (programId: string) => void;
}

export const UserProfileScreen: React.FC<UserProfileScreenProps> = ({
  userProfileRepo,
  programRepo,
  programBlockService,
  exerciseRepo,
  onClose,
  onProgramGenerated,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [profileId, setProfileId] = useState<string>('profile_default');

  // Form State
  const [gender, setGender] = useState<Gender>('male');
  const [birthdate, setBirthdate] = useState<string>('1995-01-01');
  const [heightCm, setHeightCm] = useState<string>('180');
  const [trainingEnjoyment, setTrainingEnjoyment] = useState<TrainingEnjoyment>('neutral');
  const [intensityStyle, setIntensityStyle] = useState<IntensityStyle>('balanced');
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal>('hypertrophy');
  const [secondaryGoals, setSecondaryGoals] = useState<string[]>(['strength']);
  const [preferredDays, setPreferredDays] = useState<number>(4);
  const [preferredDurationMins, setPreferredDurationMins] = useState<number>(60);
  const [equipmentAccess, setEquipmentAccess] = useState<EquipmentAccess>('commercial_gym');

  // Generation Feedback State
  const [generatedSummary, setGeneratedSummary] = useState<SynthesizedProgramSummary | null>(null);
  const [lastGeneratedProgramId, setLastGeneratedProgramId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Load existing profile
  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const existing = await userProfileRepo.getProfile();
      if (existing) {
        setProfileId(existing.id);
        setGender(existing.gender);
        if (existing.birthdate) setBirthdate(existing.birthdate);
        if (existing.height_cm != null) setHeightCm(String(existing.height_cm));
        setTrainingEnjoyment(existing.training_enjoyment);
        setIntensityStyle(existing.intensity_style);
        setPrimaryGoal(existing.primary_goal);
        if (existing.secondary_goals) setSecondaryGoals(existing.secondary_goals);
        setPreferredDays(existing.preferred_days_per_week);
        setPreferredDurationMins(existing.preferred_session_duration_mins);
        setEquipmentAccess(existing.equipment_access);
      }
    } catch (err: any) {
      console.error('Failed to load user profile:', err);
    } finally {
      setLoading(false);
    }
  }, [userProfileRepo]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Construct current profile object
  const buildCurrentProfile = (): UserProfile => {
    const parsedHeight = parseFloat(heightCm);
    return {
      id: profileId,
      gender,
      birthdate: birthdate.trim() || null,
      height_cm: isNaN(parsedHeight) ? null : parsedHeight,
      training_enjoyment: trainingEnjoyment,
      intensity_style: intensityStyle,
      primary_goal: primaryGoal,
      secondary_goals: secondaryGoals.length > 0 ? secondaryGoals : null,
      preferred_days_per_week: preferredDays,
      preferred_session_duration_mins: preferredDurationMins,
      equipment_access: equipmentAccess,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  // Toggle secondary goal pills
  const toggleSecondaryGoal = (goal: string) => {
    setSecondaryGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
    );
  };

  // Save profile to repository
  const handleSaveProfile = async () => {
    try {
      setSaving(true);
      setStatusMessage(null);
      const profile = buildCurrentProfile();
      await userProfileRepo.saveProfile(profile);
      setStatusMessage('Psychological profile & preferences saved successfully.');
    } catch (err: any) {
      setStatusMessage(`Failed to save: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  // 1-Tap Program Generation
  const handleGenerateProgram = async () => {
    if (!programRepo || !programBlockService) {
      setStatusMessage('Program synthesis requires active database repository connection.');
      return;
    }

    try {
      setGenerating(true);
      setStatusMessage(null);
      const profile = buildCurrentProfile();
      await userProfileRepo.saveProfile(profile);

      // Load exercise catalog if available
      let catalog: Exercise[] | undefined = undefined;
      if (exerciseRepo) {
        catalog = await exerciseRepo.findAll();
      }

      // 1. Synthesize multi-day split pure program
      const synthesized = synthesizeProgram(profile, {
        availableExercises: catalog,
      });

      // 2. Persist full hierarchy to SQLite
      await programRepo.saveSynthesizedProgram(synthesized);

      // 3. 1-Tap activate program meso-cycle block
      await programBlockService.swapActiveProgram(synthesized.program.id);

      setGeneratedSummary(synthesized.summary);
      setLastGeneratedProgramId(synthesized.program.id);
      setStatusMessage(`Program "${synthesized.program.name}" generated & activated!`);

      if (onProgramGenerated) {
        onProgramGenerated(synthesized.program.id);
      }
    } catch (err: any) {
      setStatusMessage(`Generation failed: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00E676" />
        <Text style={styles.loadingText}>Loading athlete profile matrix...</Text>
      </View>
    );
  }

  return (
    <View testID="user-profile-screen" style={styles.screen}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Training Profile</Text>
          <Text style={styles.headerSubtitle}>
            Psychological & logistical matrix for custom program generation
          </Text>
        </View>
        {onClose && (
          <TouchableOpacity
            testID="close-user-profile-btn"
            style={styles.closeBtn}
            onPress={onClose}
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Status Notification Banner */}
        {statusMessage && (
          <View
            style={[
              styles.statusBanner,
              statusMessage.includes('failed') || statusMessage.includes('Failed')
                ? styles.statusBannerError
                : styles.statusBannerSuccess,
            ]}
          >
            <Text style={styles.statusBannerText}>{statusMessage}</Text>
          </View>
        )}

        {/* Generated Summary Card */}
        {generatedSummary && (
          <View testID="generated-program-summary-card" style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <Text style={styles.summaryBadge}>PROGRAM ACTIVATED</Text>
              <Text style={styles.summarySplitTitle}>
                {generatedSummary.splitType.replace('_', ' ').toUpperCase()} • {generatedSummary.daysPerWeek} DAYS/WK
              </Text>
            </View>
            <View style={styles.summaryMetricsRow}>
              <View style={styles.summaryMetricItem}>
                <Text style={styles.metricLabel}>Session Duration</Text>
                <Text style={styles.metricValue}>~{generatedSummary.estimatedSessionDurationMins} min</Text>
              </View>
              <View style={styles.summaryMetricItem}>
                <Text style={styles.metricLabel}>Weekly Sets</Text>
                <Text style={styles.metricValue}>{generatedSummary.totalWeeklySets} sets</Text>
              </View>
              <View style={styles.summaryMetricItem}>
                <Text style={styles.metricLabel}>Antagonist Pairs</Text>
                <Text style={styles.metricValue}>{generatedSummary.hasSupersets ? 'Active' : 'Sequential'}</Text>
              </View>
            </View>
            <Text style={styles.summaryProgressionText}>
              ⚙️ {generatedSummary.progressionSchemeSummary}
            </Text>
          </View>
        )}

        {/* Section 1: Demographics */}
        <Text style={styles.sectionTitle}>1. ATHLETE DEMOGRAPHICS</Text>
        <View style={styles.card}>
          <Text style={styles.inputLabel}>Biological Sex (for strength standards & Navy body fat)</Text>
          <View style={styles.toggleRow}>
            {(['male', 'female'] as Gender[]).map((g) => (
              <TouchableOpacity
                key={g}
                testID={`gender-toggle-${g}`}
                style={[styles.toggleBtn, gender === g && styles.toggleBtnActive]}
                onPress={() => setGender(g)}
              >
                <Text style={[styles.toggleBtnText, gender === g && styles.toggleBtnTextActive]}>
                  {g === 'male' ? 'Male ♂' : 'Female ♀'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Text style={styles.inputLabel}>Height (cm)</Text>
              <TextInput
                testID="height-input"
                style={styles.textInput}
                keyboardType="numeric"
                value={heightCm}
                onChangeText={setHeightCm}
                placeholder="180"
                placeholderTextColor="#71717A"
              />
            </View>
            <View style={styles.fieldHalf}>
              <Text style={styles.inputLabel}>Birthdate (YYYY-MM-DD)</Text>
              <TextInput
                testID="birthdate-input"
                style={styles.textInput}
                value={birthdate}
                onChangeText={setBirthdate}
                placeholder="1995-01-01"
                placeholderTextColor="#71717A"
              />
            </View>
          </View>
        </View>

        {/* Section 2: Training Enjoyment (Psychology) */}
        <Text style={styles.sectionTitle}>2. TRAINING ENJOYMENT (ADR-014)</Text>
        <View style={styles.card}>
          <Text style={styles.cardDescription}>
            How do you feel about working out in the gym?
          </Text>
          {[
            {
              id: 'enthusiast',
              title: 'Gym Enthusiast ⚡',
              desc: 'Enjoys the gym, high variety, thrives on 4–6 days/week and 60–90 min workouts.',
            },
            {
              id: 'neutral',
              title: 'Disciplined Routine 🎯',
              desc: 'Committed to results, consistent, prefers structured 3–4 days/week and 45–60 min sessions.',
            },
            {
              id: 'minimalist',
              title: 'Minimalist Efficiency ⏱️',
              desc: 'Gym is a chore or time is very tight; wants compound supersets and max efficiency in 30–45 min.',
            },
          ].map((item) => (
            <TouchableOpacity
              key={item.id}
              testID={`enjoyment-option-${item.id}`}
              style={[
                styles.optionRow,
                trainingEnjoyment === item.id && styles.optionRowActive,
              ]}
              onPress={() => setTrainingEnjoyment(item.id as TrainingEnjoyment)}
            >
              <View style={styles.optionRadio}>
                {trainingEnjoyment === item.id && <View style={styles.optionRadioInner} />}
              </View>
              <View style={styles.optionTextContainer}>
                <Text
                  style={[
                    styles.optionTitle,
                    trainingEnjoyment === item.id && styles.optionTitleActive,
                  ]}
                >
                  {item.title}
                </Text>
                <Text style={styles.optionDesc}>{item.desc}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Section 3: Effort & Intensity Style */}
        <Text style={styles.sectionTitle}>3. INTENSITY & EXERTION STYLE</Text>
        <View style={styles.card}>
          {[
            {
              id: 'high_intensity_low_volume',
              title: 'High Intensity / Low Volume (HIT)',
              desc: '1–2 all-out working sets to RPE 9.5–10 / failure. Utilizes Dynamic Double Progression.',
            },
            {
              id: 'volume_accumulation',
              title: 'Volume Accumulation',
              desc: '3–4 submaximal sets @ RPE 7.5. Emphasizes steady volume accrual and fatigue management.',
            },
            {
              id: 'balanced',
              title: 'Balanced Hybrid',
              desc: '3 working sets @ target RPE 8.5. The classic middle ground for strength and hypertrophy.',
            },
          ].map((item) => (
            <TouchableOpacity
              key={item.id}
              testID={`intensity-style-${item.id}`}
              style={[
                styles.optionRow,
                intensityStyle === item.id && styles.optionRowActive,
              ]}
              onPress={() => setIntensityStyle(item.id as IntensityStyle)}
            >
              <View style={styles.optionRadio}>
                {intensityStyle === item.id && <View style={styles.optionRadioInner} />}
              </View>
              <View style={styles.optionTextContainer}>
                <Text
                  style={[
                    styles.optionTitle,
                    intensityStyle === item.id && styles.optionTitleActive,
                  ]}
                >
                  {item.title}
                </Text>
                <Text style={styles.optionDesc}>{item.desc}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Section 4: Primary Goal */}
        <Text style={styles.sectionTitle}>4. PRIMARY TRAINING GOAL</Text>
        <View style={styles.card}>
          <View style={styles.goalPillContainer}>
            {(
              [
                'hypertrophy',
                'strength',
                'powerbuilding',
                'endurance',
                'longevity',
              ] as PrimaryGoal[]
            ).map((goal) => (
              <TouchableOpacity
                key={goal}
                testID={`primary-goal-${goal}`}
                style={[
                  styles.goalPill,
                  primaryGoal === goal && styles.goalPillActive,
                ]}
                onPress={() => setPrimaryGoal(goal)}
              >
                <Text
                  style={[
                    styles.goalPillText,
                    primaryGoal === goal && styles.goalPillTextActive,
                  ]}
                >
                  {goal.charAt(0).toUpperCase() + goal.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.inputLabel, { marginTop: 16 }]}>Secondary Goals (Multi-select)</Text>
          <View style={styles.secondaryGoalRow}>
            {['strength', 'hypertrophy', 'powerbuilding', 'endurance', 'longevity'].map((goal) => {
              const selected = secondaryGoals.includes(goal);
              return (
                <TouchableOpacity
                  key={goal}
                  testID={`secondary-goal-${goal}`}
                  style={[styles.secondaryPill, selected && styles.secondaryPillActive]}
                  onPress={() => toggleSecondaryGoal(goal)}
                >
                  <Text
                    style={[
                      styles.secondaryPillText,
                      selected && styles.secondaryPillTextActive,
                    ]}
                  >
                    {selected ? '✓ ' : '+ '}
                    {goal}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Section 5: Schedule & Logistics */}
        <Text style={styles.sectionTitle}>5. SCHEDULE & EQUIPMENT CONSTRAINTS</Text>
        <View style={styles.card}>
          <Text style={styles.inputLabel}>Available Training Days Per Week</Text>
          <View style={styles.daysSelectorRow}>
            {[2, 3, 4, 5, 6].map((days) => (
              <TouchableOpacity
                key={days}
                testID={`days-per-week-${days}`}
                style={[
                  styles.dayBtn,
                  preferredDays === days && styles.dayBtnActive,
                ]}
                onPress={() => setPreferredDays(days)}
              >
                <Text
                  style={[
                    styles.dayBtnText,
                    preferredDays === days && styles.dayBtnTextActive,
                  ]}
                >
                  {days}d
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.inputLabel, { marginTop: 16 }]}>Target Workout Duration</Text>
          <View style={styles.daysSelectorRow}>
            {[30, 45, 60, 75, 90].map((dur) => (
              <TouchableOpacity
                key={dur}
                testID={`duration-${dur}`}
                style={[
                  styles.dayBtn,
                  preferredDurationMins === dur && styles.dayBtnActive,
                ]}
                onPress={() => setPreferredDurationMins(dur)}
              >
                <Text
                  style={[
                    styles.dayBtnText,
                    preferredDurationMins === dur && styles.dayBtnTextActive,
                  ]}
                >
                  {dur}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.inputLabel, { marginTop: 16 }]}>Equipment Access</Text>
          {[
            { id: 'commercial_gym', label: 'Commercial Gym (Barbells, Dumbbells, Cables, Machines)' },
            { id: 'garage_gym', label: 'Garage Gym (Barbells, Dumbbells, Pull-up Bar)' },
            { id: 'dumbbells_only', label: 'Dumbbells Only (Dumbbells & Adjustable Bench)' },
            { id: 'bodyweight_only', label: 'Bodyweight Only (Calisthenics)' },
          ].map((eq) => (
            <TouchableOpacity
              key={eq.id}
              testID={`equipment-${eq.id}`}
              style={[
                styles.optionRow,
                equipmentAccess === eq.id && styles.optionRowActive,
              ]}
              onPress={() => setEquipmentAccess(eq.id as EquipmentAccess)}
            >
              <View style={styles.optionRadio}>
                {equipmentAccess === eq.id && <View style={styles.optionRadioInner} />}
              </View>
              <Text
                style={[
                  styles.optionTitle,
                  equipmentAccess === eq.id && styles.optionTitleActive,
                ]}
              >
                {eq.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtonsContainer}>
          <TouchableOpacity
            testID="generate-custom-program-btn"
            style={[styles.generateProgramBtn, generating && styles.btnDisabled]}
            onPress={handleGenerateProgram}
            disabled={generating}
            activeOpacity={0.8}
          >
            {generating ? (
              <ActivityIndicator size="small" color="#0A0A0A" />
            ) : (
              <Text style={styles.generateProgramBtnText}>⚡ 1-Tap Generate Custom Program</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            testID="save-profile-btn"
            style={[styles.saveProfileBtn, saving && styles.btnDisabled]}
            onPress={handleSaveProfile}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#00E676" />
            ) : (
              <Text style={styles.saveProfileBtnText}>Save Preferences Only</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
  },
  loadingText: {
    color: '#71717A',
    fontSize: 13,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FAFAFA',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 2,
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnText: {
    color: '#A1A1AA',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  statusBanner: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  statusBannerSuccess: {
    backgroundColor: '#064E3B',
    borderWidth: 1,
    borderColor: '#059669',
  },
  statusBannerError: {
    backgroundColor: '#7F1D1D',
    borderWidth: 1,
    borderColor: '#DC2626',
  },
  statusBannerText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: '#0F1A12',
    borderWidth: 1,
    borderColor: '#00E676',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  summaryHeader: {
    marginBottom: 12,
  },
  summaryBadge: {
    color: '#00E676',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  summarySplitTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  summaryMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#14291B',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  summaryMetricItem: {
    alignItems: 'center',
  },
  metricLabel: {
    color: '#86EFAC',
    fontSize: 10,
    fontWeight: '500',
  },
  metricValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  summaryProgressionText: {
    color: '#A7F3D0',
    fontSize: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00E676',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  cardDescription: {
    color: '#A1A1AA',
    fontSize: 12,
    marginBottom: 12,
  },
  inputLabel: {
    color: '#D4D4D8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  toggleBtn: {
    flex: 1,
    backgroundColor: '#18181B',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  toggleBtnActive: {
    backgroundColor: '#00E676',
    borderColor: '#00E676',
  },
  toggleBtnText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '600',
  },
  toggleBtnTextActive: {
    color: '#0A0A0A',
    fontWeight: '800',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  fieldHalf: {
    flex: 1,
  },
  textInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    color: '#FAFAFA',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionRowActive: {
    backgroundColor: '#18181B',
    borderColor: '#27272A',
  },
  optionRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#71717A',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    marginRight: 10,
  },
  optionRadioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E676',
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '600',
  },
  optionTitleActive: {
    color: '#00E676',
    fontWeight: '700',
  },
  optionDesc: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  goalPillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  goalPill: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  goalPillActive: {
    backgroundColor: '#00E676',
    borderColor: '#00E676',
  },
  goalPillText: {
    color: '#D4D4D8',
    fontSize: 12,
    fontWeight: '600',
  },
  goalPillTextActive: {
    color: '#0A0A0A',
    fontWeight: '800',
  },
  secondaryGoalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  secondaryPill: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  secondaryPillActive: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
  },
  secondaryPillText: {
    color: '#71717A',
    fontSize: 11,
  },
  secondaryPillTextActive: {
    color: '#38BDF8',
    fontWeight: '600',
  },
  daysSelectorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dayBtn: {
    flex: 1,
    backgroundColor: '#18181B',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
  },
  dayBtnActive: {
    backgroundColor: '#00E676',
    borderColor: '#00E676',
  },
  dayBtnText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '700',
  },
  dayBtnTextActive: {
    color: '#0A0A0A',
    fontWeight: '900',
  },
  actionButtonsContainer: {
    marginTop: 16,
    gap: 12,
  },
  generateProgramBtn: {
    backgroundColor: '#00E676',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateProgramBtnText: {
    color: '#0A0A0A',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  saveProfileBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveProfileBtnText: {
    color: '#D4D4D8',
    fontSize: 13,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
