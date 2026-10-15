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
  Modal,
} from 'react-native';
import {
  UserProfile,
  Gender,
  TrainingMentality,
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
import { IGearRepository } from '../../domain/repositories/IGearRepository';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';
import { IBodyMetricsRepository } from '../../domain/repositories/IBodyMetricsRepository';
import {
  ProgramBlockService,
  ActiveProgramInfo,
} from '../../services/programBlockService';
import { synthesizeProgram } from '../../core/generator/programSynthesizer';
import { ProgramOverviewScreen } from '../progression/ProgramOverviewScreen';
import { GearInventoryScreen } from '../gear/GearInventoryScreen';
import { BodyMetricsScreen } from '../bodyMetrics/BodyMetricsScreen';

export interface UserProfileScreenProps {
  userProfileRepo: IUserProfileRepository;
  programRepo?: IProgramRepository;
  programBlockService?: ProgramBlockService;
  exerciseRepo?: IExerciseRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  bodyMetricsRepo?: IBodyMetricsRepository;
  initialQuestionnaireExpanded?: boolean;
  onClose?: () => void;
  onProgramGenerated?: (programId: string) => void;
  onOpenProgramOverview?: () => void;
}

export const UserProfileScreen: React.FC<UserProfileScreenProps> = ({
  userProfileRepo,
  programRepo,
  programBlockService,
  exerciseRepo,
  gearRepo,
  userSettingsRepo,
  bodyMetricsRepo,
  initialQuestionnaireExpanded = false,
  onClose,
  onProgramGenerated,
  onOpenProgramOverview,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [profileId, setProfileId] = useState<string>('profile_default');
  const [activeInfo, setActiveInfo] = useState<ActiveProgramInfo | null>(null);
  const [showProgramOverview, setShowProgramOverview] = useState<boolean>(false);
  const [showGearInventory, setShowGearInventory] = useState<boolean>(false);
  const [showBodyMetrics, setShowBodyMetrics] = useState<boolean>(false);
  const [questionnaireExpanded, setQuestionnaireExpanded] = useState<boolean>(initialQuestionnaireExpanded);

  // Form State
  const [gender, setGender] = useState<Gender>('male');
  const [birthdate, setBirthdate] = useState<string>('1995-01-01');
  const [heightCm, setHeightCm] = useState<string>('180');
  const [trainingMentality, setTrainingMentality] = useState<TrainingMentality>('precision');
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
      if (programBlockService) {
        try {
          const active = await programBlockService.getActiveProgram();
          setActiveInfo(active);
        } catch {
          // Ignore
        }
      }

      const existing = await userProfileRepo.getProfile();
      if (existing) {
        setProfileId(existing.id);
        setGender(existing.gender);
        if (existing.birthdate) setBirthdate(existing.birthdate);
        if (existing.height_cm != null) setHeightCm(String(existing.height_cm));
        setTrainingMentality(
          existing.training_mentality ??
          (existing.intensity_style === 'high_intensity_low_volume'
            ? 'fury'
            : existing.training_enjoyment === 'minimalist'
            ? 'get_out'
            : 'precision')
        );
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
  }, [userProfileRepo, programBlockService]);

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
      training_mentality: trainingMentality,
      training_enjoyment:
        trainingMentality === 'get_out'
          ? 'minimalist'
          : trainingMentality === 'fury'
          ? 'enthusiast'
          : 'neutral',
      intensity_style:
        trainingMentality === 'fury'
          ? 'high_intensity_low_volume'
          : trainingMentality === 'precision'
          ? 'volume_accumulation'
          : 'balanced',
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
        {/* Active Program Banner & Program Overview Hub */}
        <View testID="active-program-banner-card" style={styles.activeProgramCard}>
          <View style={styles.activeProgramHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.activeProgramBadge}>ACTIVE PROGRAM</Text>
              <Text style={styles.activeProgramTitle} numberOfLines={1}>
                {activeInfo ? activeInfo.program.name : 'No Program Active'}
              </Text>
              {activeInfo && (
                <Text style={styles.activeProgramMeta}>
                  Active since {activeInfo.block.start_date || 'recently'}
                </Text>
              )}
            </View>
            <TouchableOpacity
              testID="open-program-overview-btn"
              style={styles.openOverviewBtn}
              onPress={() => {
                if (onOpenProgramOverview) {
                  onOpenProgramOverview();
                } else {
                  setShowProgramOverview(true);
                }
              }}
            >
              <Text style={styles.openOverviewBtnText}>Programs 📋</Text>
            </TouchableOpacity>
          </View>
        </View>

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

        {/* Athlete Questionnaire Collapsible Section */}
        <View style={styles.questionnaireSection}>
          <TouchableOpacity
            testID="toggle-questionnaire-btn"
            style={[
              styles.questionnaireHeaderCard,
              questionnaireExpanded && styles.questionnaireHeaderCardExpanded,
            ]}
            onPress={() => setQuestionnaireExpanded((prev) => !prev)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Toggle Athlete Questionnaire"
          >
            <View style={styles.questionnaireHeaderLeft}>
              <View style={styles.questionnaireTitleRow}>
                <Text style={styles.questionnaireTitle}>Athlete Questionnaire</Text>
                <Text style={styles.questionnaireBadge}>ADR-038</Text>
              </View>
              <Text style={styles.questionnaireSubtitle}>
                {gender.charAt(0).toUpperCase() + gender.slice(1)} • {trainingMentality.toUpperCase()} • {primaryGoal.toUpperCase()} • {preferredDays}d/wk • {preferredDurationMins}m
              </Text>
              <Text style={styles.questionnaireHint}>
                {questionnaireExpanded ? 'Tap to collapse questionnaire' : 'Tap to expand & customize preferences'}
              </Text>
            </View>
            <View style={styles.questionnaireChevronContainer}>
              <Text style={styles.questionnaireChevron}>
                {questionnaireExpanded ? '▲' : '▼'}
              </Text>
            </View>
          </TouchableOpacity>

          {questionnaireExpanded && (
            <View testID="questionnaire-body" style={styles.questionnaireBody}>
              {/* Section 1: Demographics */}
              <Text style={[styles.sectionTitle, { marginTop: 0 }]}>1. ATHLETE DEMOGRAPHICS</Text>
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

          {bodyMetricsRepo && (
            <TouchableOpacity
              testID="profile-open-body-metrics-btn"
              style={styles.openBodyMetricsBtn}
              onPress={() => setShowBodyMetrics(true)}
            >
              <Text style={styles.openBodyMetricsBtnText}>
                Anthropometry, Tape Measurements & Navy BF% ⚖️
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Section 2: Training Mentality Matrix */}
        <Text style={styles.sectionTitle}>2. TRAINING MENTALITY</Text>
        <View style={styles.card}>
          <Text style={styles.cardDescription}>
            Select your training philosophy. This drives exertion targets, volume accumulation, and progression schemes.
          </Text>
          {[
            {
              id: 'fury' as TrainingMentality,
              title: 'Fury ⚡',
              subtitle: 'Maximum Effort / Low Volume',
              desc: 'Pushes with high intensity and aggression; leaves nothing in the tank. (1–2 working sets to RPE 9.5–10, Dynamic Double Progression)',
            },
            {
              id: 'precision' as TrainingMentality,
              title: 'Precision 🎯',
              subtitle: 'Deliberate Mastery / High Volume',
              desc: 'Hones craft with deliberate technical mastery. (3–4 working sets @ RPE 7.5–8.5, Linear & Double Progression)',
            },
            {
              id: 'get_out' as TrainingMentality,
              title: 'I Wanna Get Out of Here ⏱️',
              subtitle: 'Minimalist Efficiency / Antagonist Supersets',
              desc: 'Wants to get out of the gym, doing the least work possible for meaningful results. (2 sets, automatic antagonist supersets, tight rest)',
            },
          ].map((item) => (
            <TouchableOpacity
              key={item.id}
              testID={`mentality-option-${item.id}`}
              style={[
                styles.optionRow,
                trainingMentality === item.id && styles.optionRowActive,
              ]}
              onPress={() => setTrainingMentality(item.id)}
            >
              <View style={styles.optionRadio}>
                {trainingMentality === item.id && <View style={styles.optionRadioInner} />}
              </View>
              <View style={styles.optionTextContainer}>
                <Text
                  style={[
                    styles.optionTitle,
                    trainingMentality === item.id && styles.optionTitleActive,
                  ]}
                >
                  {item.title}
                </Text>
                <Text style={styles.optionSubtitle}>{item.subtitle}</Text>
                <Text style={styles.optionDesc}>{item.desc}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Section 3: Primary Goal */}
        <Text style={styles.sectionTitle}>3. PRIMARY TRAINING GOAL</Text>
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

        {/* Section 4: Schedule & Logistics */}
        <Text style={styles.sectionTitle}>4. SCHEDULE & EQUIPMENT CONSTRAINTS</Text>
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
            {[15, 30, 45, 60, 75, 90].map((dur) => (
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

          {/* Section: Gym Equipment & Gear Inventory (ADR-025) */}
          <View style={styles.gearCard}>
            <View style={styles.gearCardHeader}>
              <Text style={styles.gearCardTitle}>Gear & Equipment Inventory</Text>
              <Text style={styles.gearBadge}>ADR-025</Text>
            </View>
            <Text style={styles.gearCardDesc}>
              Configure your gym's specific barbells (Olympic, Safety Squat Bar, Trap Bar) and cable machines. Equipment saved here is available for selection across exercises, workout sessions, and program templates.
            </Text>
            {gearRepo ? (
              <TouchableOpacity
                testID="open-gear-inventory-btn"
                style={styles.openGearBtn}
                onPress={() => setShowGearInventory(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.openGearBtnText}>Manage Equipment Inventory ➔</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.gearDisabledText}>Gear repository not connected</Text>
            )}
          </View>
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
            </View>
          )}
        </View>
      </ScrollView>

      {/* Program Overview & Builder Modal */}
      {showProgramOverview && programRepo && programBlockService && (
        <Modal
          visible={showProgramOverview}
          animationType="slide"
          onRequestClose={() => {
            setShowProgramOverview(false);
            loadProfile();
          }}
        >
          <ProgramOverviewScreen
            programRepo={programRepo}
            programBlockService={programBlockService}
            exerciseRepo={exerciseRepo}
            gearRepo={gearRepo}
            onClose={() => {
              setShowProgramOverview(false);
              loadProfile();
            }}
            onSelectProgram={async (progId) => {
              await programBlockService.swapActiveProgram(progId);
              setShowProgramOverview(false);
              loadProfile();
            }}
          />
        </Modal>
      )}

      {/* Gear & Equipment Inventory Modal (ADR-025) */}
      {showGearInventory && gearRepo && (
        <Modal
          visible={showGearInventory}
          animationType="slide"
          onRequestClose={() => setShowGearInventory(false)}
        >
          <GearInventoryScreen
            gearRepo={gearRepo}
            userSettingsRepo={userSettingsRepo}
            onClose={() => setShowGearInventory(false)}
          />
        </Modal>
      )}

      {/* Body Metrics & Anthropometry Modal (Step 5.2) */}
      {showBodyMetrics && bodyMetricsRepo && (
        <Modal
          visible={showBodyMetrics}
          animationType="slide"
          onRequestClose={() => setShowBodyMetrics(false)}
        >
          <BodyMetricsScreen
            bodyMetricsRepo={bodyMetricsRepo}
            userProfileRepo={userProfileRepo}
            userSettingsRepo={userSettingsRepo}
            onClose={() => setShowBodyMetrics(false)}
          />
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  activeProgramCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#00E676',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  activeProgramHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  activeProgramBadge: {
    color: '#00E676',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  activeProgramTitle: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
  },
  activeProgramMeta: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2,
  },
  openOverviewBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#00E676',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  openOverviewBtnText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '700',
  },
  optionSubtitle: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
    marginBottom: 2,
  },
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
  gearCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  gearCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  gearCardTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
  },
  gearBadge: {
    backgroundColor: '#27272A',
    color: '#00E676',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gearCardDesc: {
    color: '#A1A1AA',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 12,
  },
  openGearBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#00E676',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  openGearBtnText: {
    color: '#00E676',
    fontSize: 13,
    fontWeight: '700',
  },
  gearDisabledText: {
    color: '#71717A',
    fontSize: 12,
    fontStyle: 'italic',
  },
  openBodyMetricsBtn: {
    backgroundColor: '#14291B',
    borderWidth: 1,
    borderColor: '#00E676',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  openBodyMetricsBtnText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '700',
  },
  questionnaireSection: {
    marginBottom: 20,
  },
  questionnaireHeaderCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  questionnaireHeaderCardExpanded: {
    borderColor: '#00E676',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  questionnaireHeaderLeft: {
    flex: 1,
  },
  questionnaireTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  questionnaireTitle: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
  },
  questionnaireBadge: {
    color: '#00E676',
    fontSize: 10,
    fontWeight: '900',
    backgroundColor: '#002914',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  questionnaireSubtitle: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  questionnaireHint: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 4,
  },
  questionnaireChevronContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionnaireChevron: {
    color: '#00E676',
    fontSize: 13,
    fontWeight: '700',
  },
  questionnaireBody: {
    backgroundColor: '#09090B',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#00E676',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingTop: 16,
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
});
