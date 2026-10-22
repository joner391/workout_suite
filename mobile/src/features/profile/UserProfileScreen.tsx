import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors } from '../../ui/theme';
/**
 * Workout Suite — UserProfileScreen
 *
 * Athlete hub with direct performance destinations and focused preference editors.
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
  ExperienceLevel,
} from '../../core/types';
import { IUserProfileRepository } from '../../domain/repositories/IUserProfileRepository';
import { IProgramRepository } from '../../domain/repositories/IProgramRepository';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import { IGearRepository } from '../../domain/repositories/IGearRepository';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';
import { IBodyMetricsRepository } from '../../domain/repositories/IBodyMetricsRepository';
import { IWorkoutRepository } from '../../domain/repositories/IWorkoutRepository';
import { IPainReportRepository } from '../../domain/repositories/IPainReportRepository';
import {
  ProgramBlockService,
  ActiveProgramInfo,
} from '../../services/programBlockService';
import {
  ProgramEvolutionService,
  EvolutionResult,
} from '../../services/programEvolutionService';
import { synthesizeProgram } from '../../core/generator/programSynthesizer';
import { ProgramOverviewScreen } from '../progression/ProgramOverviewScreen';
import { GearInventoryScreen } from '../gear/GearInventoryScreen';
import { BodyMetricsScreen } from '../bodyMetrics/BodyMetricsScreen';
import { PersonalRecordsScreen } from './PersonalRecordsScreen';
import { StrengthOverviewScreen } from './StrengthOverviewScreen';
import { mergeProfileEditorChanges, ProfileEditorSection } from '../../services/profilePreferencesService';
import { useOptionalRepositories } from '../../context/RepositoryContext';
import { TrainingAdaptationService } from '../../services/trainingAdaptationService';

export interface UserProfileScreenProps {
  userProfileRepo: IUserProfileRepository;
  programRepo?: IProgramRepository;
  programBlockService?: ProgramBlockService;
  programEvolutionService?: ProgramEvolutionService;
  exerciseRepo?: IExerciseRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  bodyMetricsRepo?: IBodyMetricsRepository;
  workoutRepo?: IWorkoutRepository;
  painReportRepo?: IPainReportRepository;
  initialQuestionnaireExpanded?: boolean;
  isBetaPhase?: boolean;
  onClose?: () => void;
  onProgramGenerated?: (programId: string) => void;
  onOpenProgramOverview?: () => void;
  initialEditor?: ProfileEditorSection;
}

export const UserProfileScreen: React.FC<UserProfileScreenProps> = ({
  userProfileRepo,
  programRepo,
  programBlockService,
  programEvolutionService,
  exerciseRepo,
  gearRepo,
  userSettingsRepo,
  bodyMetricsRepo,
  workoutRepo,
  painReportRepo,
  initialQuestionnaireExpanded = false,
  isBetaPhase,
  onClose,
  onProgramGenerated,
  onOpenProgramOverview,
  initialEditor,
}) => {
  const repositories = useOptionalRepositories();
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [evolving, setEvolving] = useState<boolean>(false);
  const [isBeta, setIsBeta] = useState<boolean>(isBetaPhase ?? false);
  const [isCycleCompleted, setIsCycleCompleted] = useState<boolean>(false);
  const [profileId, setProfileId] = useState<string>('profile_default');
  const [activeInfo, setActiveInfo] = useState<ActiveProgramInfo | null>(null);
  const [showProgramOverview, setShowProgramOverview] = useState<boolean>(false);
  const [showGearInventory, setShowGearInventory] = useState<boolean>(false);
  const [showBodyMetrics, setShowBodyMetrics] = useState<boolean>(false);
  const [showEvolutionModal, setShowEvolutionModal] = useState<boolean>(false);
  const [evolutionResult, setEvolutionResult] = useState<EvolutionResult | null>(null);
  const [editorSection, setEditorSection] = useState<ProfileEditorSection | null>(initialEditor ?? (initialQuestionnaireExpanded ? 'training' : null));
  const [showRecords, setShowRecords] = useState(false);
  const [showStrength, setShowStrength] = useState(false);
  const [savedProfile, setSavedProfile] = useState<UserProfile | null>(null);

  // Form State
  const [gender, setGender] = useState<Gender>('male');
  const [birthdate, setBirthdate] = useState<string>('');
  const [heightCm, setHeightCm] = useState<string>('');
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('intermediate');
  const [trainingMentality, setTrainingMentality] = useState<TrainingMentality>('precision');
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal>('hypertrophy');
  const [secondaryGoals, setSecondaryGoals] = useState<string[]>(['strength']);
  const [preferredDays, setPreferredDays] = useState<number>(4);
  const [preferredDurationMins, setPreferredDurationMins] = useState<number>(60);
  const [equipmentAccess, setEquipmentAccess] = useState<EquipmentAccess>('commercial_gym');
  const [pendingMesoMood, setPendingMesoMood] = useState<boolean>(false);

  // Generation Feedback State
  const [generatedSummary, setGeneratedSummary] = useState<SynthesizedProgramSummary | null>(null);
  const [lastGeneratedProgramId, setLastGeneratedProgramId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Load existing profile
  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      let activeProg: ActiveProgramInfo | null = null;
      if (programBlockService) {
        try {
          activeProg = await programBlockService.getActiveProgram();
          setActiveInfo(activeProg);
        } catch {
          // Ignore
        }
      }

      // Check beta-phase status from settings or prop
      let currentIsBeta = isBetaPhase ?? false;
      if (userSettingsRepo) {
        try {
          const betaSetting = await userSettingsRepo.get('is_beta_phase');
          const appPhaseSetting = await userSettingsRepo.get('app_phase');
          if (betaSetting === 'true' || appPhaseSetting === 'beta') {
            currentIsBeta = true;
          }
        } catch {
          // Ignore
        }
      }
      setIsBeta(currentIsBeta);

      // Check if current cycle is completed
      if (programRepo && activeProg) {
        try {
          const evoService =
            programEvolutionService ??
            new ProgramEvolutionService(
              programRepo,
              userProfileRepo,
              workoutRepo,
              painReportRepo,
              exerciseRepo,
              programBlockService,
              userSettingsRepo,
              repositories?.exercisePreferenceRepo
            );
          const readiness = await evoService.isReadyForEvolution(activeProg.program.id);
          setIsCycleCompleted(readiness.ready);
        } catch {
          setIsCycleCompleted(false);
        }
      } else {
        setIsCycleCompleted(false);
      }

      const existing = await userProfileRepo.getProfile();
      setSavedProfile(existing);
      if (existing) {
        setProfileId(existing.id);
        setGender(existing.gender);
        setBirthdate(existing.birthdate ?? '');
        setHeightCm(existing.height_cm != null ? String(existing.height_cm) : '');
        setExperienceLevel(existing.experience_level ?? 'intermediate');
        setPendingMesoMood(Boolean(existing.pending_meso_mood));
        setTrainingMentality(
          existing.training_mentality ??
          (existing.intensity_style === 'high_intensity_low_volume'
            ? 'fury'
            : existing.training_enjoyment === 'minimalist'
            ? 'get_out'
            : 'precision')
        );
        setPrimaryGoal(existing.primary_goal);
        setSecondaryGoals(existing.secondary_goals ?? []);
        setPreferredDays(existing.preferred_days_per_week);
        setPreferredDurationMins(existing.preferred_session_duration_mins);
        setEquipmentAccess(existing.equipment_access);
      }
    } catch (err: any) {
      console.error('Failed to load user profile:', err);
    } finally {
      setLoading(false);
    }
  }, [userProfileRepo, programBlockService, programRepo, programEvolutionService, workoutRepo, painReportRepo, exerciseRepo, userSettingsRepo, isBetaPhase]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Construct current profile object
  const buildCurrentProfile = (): UserProfile => {
    const parsedHeight = parseFloat(heightCm);
    return {
      ...savedProfile,
      id: profileId,
      gender,
      birthdate: birthdate.trim() || null,
      height_cm: isNaN(parsedHeight) ? null : parsedHeight,
      experience_level: experienceLevel,
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
      pending_meso_mood: pendingMesoMood,
      created_at: savedProfile?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  // Toggle secondary goal pills
  const toggleSecondaryGoal = (goal: string) => {
    setSecondaryGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
    );
  };

  // 1. Action: Save Preferences Only
  const handleSaveProfile = async () => {
    try {
      setSaving(true);
      setStatusMessage(null);
      const draft = buildCurrentProfile();
      const existing = await userProfileRepo.getProfile();
      const profile = mergeProfileEditorChanges(existing, draft, editorSection ?? 'training', !!activeInfo);
      await userProfileRepo.saveProfile(profile);
      if (editorSection === 'details') await userSettingsRepo?.setUserGender(profile.gender);
      setSavedProfile(profile); setPendingMesoMood(!!profile.pending_meso_mood);
      setEditorSection(initialEditor === 'programs' ? 'programs' : null);
      if (editorSection === 'equipment') setShowGearInventory(true);
      setStatusMessage('Changes saved.');
    } catch (err: any) {
      setStatusMessage(`Failed to save: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const closeEditor = () => {
    if (saving || generating || evolving) return;
    if (initialEditor === 'programs' && editorSection !== 'programs') {
      setEditorSection('programs'); loadProfile();
    } else {
      setEditorSection(null);
      if (initialEditor) onClose?.(); else loadProfile();
      if (editorSection === 'equipment') setShowGearInventory(true);
    }
  };

  // 2. Action: Deferred Mesocycle Evolution (Step 8.3)
  const handleEvolveOngoingProgram = async () => {
    if (!programRepo) {
      setStatusMessage('Evolution requires active database repository connection.');
      return;
    }

    try {
      setEvolving(true);
      setStatusMessage(null);
      const profile = buildCurrentProfile();
      await userProfileRepo.saveProfile(profile);

      const evolutionSvc =
        programEvolutionService ??
        new ProgramEvolutionService(
          programRepo,
          userProfileRepo,
          workoutRepo,
          painReportRepo,
          exerciseRepo,
          programBlockService,
          userSettingsRepo,
          repositories?.exercisePreferenceRepo
        );

      let catalog: Exercise[] | undefined = undefined;
      if (exerciseRepo) {
        catalog = await exerciseRepo.findAll();
      }

      const activeProgramId = activeInfo?.program.id;
      const result = await evolutionSvc.evolveActiveProgramForNextMeso({
        programId: activeProgramId,
        userProfile: profile,
        exerciseCatalog: catalog,
      });

      setEvolutionResult(result);
      setEditorSection(null);
      setShowEvolutionModal(true);
      setPendingMesoMood(false);
      setLastGeneratedProgramId(result.programId);
      setStatusMessage(`Mesocycle ${result.mesoNumber} applied. (${result.summaryBadge})`);

      if (programBlockService) {
        const fresh = await programBlockService.getActiveProgram();
        setActiveInfo(fresh);
      }
    } catch (err: any) {
      setStatusMessage(`Evolution failed: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setEvolving(false);
    }
  };

  // 3. Action: Create Brand New Program
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

      // Keep an active session intact when creating programs from the Workout hub.
      if (workoutRepo) {
        try {
          const oldInProgress = await workoutRepo.getInProgressWorkout();
          if (oldInProgress) {
            setStatusMessage('Generation failed: finish or discard your active workout before creating a new program.');
            return;
          }
        } catch {
          // Safe fallback
        }
      }

      // Load exercise catalog if available
      let catalog: Exercise[] | undefined = undefined;
      if (exerciseRepo) {
        catalog = await exerciseRepo.findAll();
      }

      // 1. Synthesize multi-day split pure program
      const synthesized = synthesizeProgram(profile, {
        availableExercises: catalog,
        preferences: await repositories?.exercisePreferenceRepo?.getAll(),
      });

      // 2. Persist full hierarchy to SQLite
      await programRepo.saveSynthesizedProgram(synthesized);

      // 3. 1-Tap activate program meso-cycle block
      await programBlockService.swapActiveProgram(synthesized.program.id);
      if (workoutRepo && userSettingsRepo) {
        const adaptation = new TrainingAdaptationService(workoutRepo, { settings: userSettingsRepo, programs: programRepo, profiles: userProfileRepo });
        const state = await adaptation.state(synthesized.program.id);
        state.mood = profile.training_mentality;
        await adaptation.save(synthesized.program.id, state);
      }

      setGeneratedSummary(synthesized.summary);
      setLastGeneratedProgramId(synthesized.program.id);
      setStatusMessage(`Program "${synthesized.program.name}" generated & activated!`);

      if (programBlockService) {
        const fresh = await programBlockService.getActiveProgram();
        setActiveInfo(fresh);
      }

      // Open Program Overview so athlete can inspect and make manual adjustments
      setEditorSection(null);
      setShowProgramOverview(true);

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
        <ActivityIndicator size="large" color={uiColors.accent} />
        <Text style={styles.loadingText}>Loading your profile...</Text>
      </View>
    );
  }

  const editor = editorSection ? (
        <View style={styles.screen}>
          <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {editorSection === 'training' ? 'Training preferences' : editorSection === 'details' ? 'Personal details' : editorSection === 'equipment' ? 'Equipment access' : 'Program setup'}
        </Text>
        <TouchableOpacity
          testID="profile-editor-close"
          accessibilityRole="button"
          style={styles.closeBtn}
          disabled={saving || generating || evolving}
          onPress={closeEditor}
          accessibilityLabel="Close">
          <AppIcon name="close" size={20} color={uiColors.accentText} />
        </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <View testID="questionnaire-body" style={styles.questionnaireBody}>
              {statusMessage?.toLowerCase().includes('failed') && <Text accessibilityRole="alert" style={styles.hubSubtitle}>{statusMessage}</Text>}
              {editorSection === 'details' && <>
              {/* Section 1: Demographics */}
              <Text style={[styles.sectionTitle, { marginTop: 0 }]}>PERSONAL DETAILS</Text>
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
                    placeholderTextColor={uiColors.subtle}
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
                    placeholderTextColor={uiColors.subtle}
                    />
                  </View>
                </View>

                <Text style={[styles.inputLabel, { marginTop: 16 }]}>
                  Experience Tier (Bifurcated Novice vs Standard Splits)
                </Text>
                <View style={styles.toggleRow}>
                  {(['beginner', 'intermediate', 'advanced'] as ExperienceLevel[]).map((exp) => (
                    <TouchableOpacity
                      key={exp}
                      testID={`experience-toggle-${exp}`}
                      style={[styles.toggleBtn, experienceLevel === exp && styles.toggleBtnActive]}
                      onPress={() => setExperienceLevel(exp)}
                    >
                      <Text style={[styles.toggleBtnText, experienceLevel === exp && styles.toggleBtnTextActive]}>
                        {exp.charAt(0).toUpperCase() + exp.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

              </View>

              </>}
              {editorSection === 'training' && <>
              {/* Section 2: Dynamic Training Mood */}
              <Text style={styles.sectionTitle}>TRAINING MOOD & GOALS</Text>
              <View style={styles.card}>
                <Text style={styles.cardDescription}>
                  {activeInfo ? 'These changes apply to your next training cycle. Your current workouts stay as planned.' : 'These preferences will be used when you create a program.'}
                </Text>
                {[
                  {
                    id: 'fury' as TrainingMentality,
                    title: 'Fury ⚡',
                    subtitle: 'High Effort Density / Maximum Efficiency',
                  },
                  {
                    id: 'precision' as TrainingMentality,
                    title: 'Precision 🎯',
                    subtitle: 'Technical Mastery / Controlled Proximity',
                  },
                  {
                    id: 'get_out' as TrainingMentality,
                    title: 'I Wanna Get Out of Here ⏱️',
                    subtitle: 'Temporal Density / Antagonist Supersets',
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
                    </View>
                  </TouchableOpacity>
                ))}

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

                <Text style={[styles.inputLabel, { marginTop: 16 }]}>Available Training Days Per Week</Text>
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

                <Text style={[styles.inputLabel, { marginTop: 16 }]}>Primary Training Goal</Text>
                <View style={styles.goalPillContainer}>
                  {(
                    [
                      'hypertrophy',
                      'strength',
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
                  {['strength', 'hypertrophy', 'endurance', 'longevity'].map((goal) => {
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

              </>}
              {editorSection === 'equipment' && <>
              {/* Section 3: Logistics & Equipment Inventory */}
              <Text style={styles.sectionTitle}>EQUIPMENT ACCESS</Text>
              <View style={styles.card}>
                <Text style={styles.inputLabel}>Equipment Access</Text>
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
              </>}

              {/* Action Buttons (3 Distinct Paths: Step 8.3 & Beta Gating) */}
              <View style={styles.actionButtonsContainer}>
                {editorSection === 'programs' && <>
                  <Text style={styles.hubTitle}>{primaryGoal} · {preferredDays} days/week · {preferredDurationMins} minutes</Text>
                  <Text style={styles.hubSubtitle}>Using your saved preferences and equipment access. Evolving a cycle opens a review. Creating a new program activates it immediately.</Text>
                  <TouchableOpacity style={styles.hubRow} onPress={() => setEditorSection('training')}><Text style={styles.hubTitle}>Edit training preferences →</Text></TouchableOpacity>
                {activeInfo && (!isBeta || isCycleCompleted) && (
                  <TouchableOpacity
                    testID="evolve-ongoing-program-btn"
                    style={[
                      styles.evolveProgramBtn,
                      evolving && styles.btnDisabled,
                      isCycleCompleted && styles.evolveProgramBtnCompleted,
                    ]}
                    onPress={handleEvolveOngoingProgram}
                    disabled={evolving || generating || saving}
                    activeOpacity={0.8}
                  >
                    {evolving ? (
                    <ActivityIndicator size="small" color={uiColors.background} />
                    ) : (
                      <Text style={styles.evolveProgramBtnText}>
                        {isCycleCompleted
                          ? '🎉 Mesocycle Completed — Evolve Next Meso'
                          : '⚡ Evolve Ongoing Program for Next Meso'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  testID="generate-custom-program-btn"
                  style={[styles.generateProgramBtn, generating && styles.btnDisabled]}
                  onPress={handleGenerateProgram}
                  disabled={generating || evolving || saving}
                  activeOpacity={0.8}
                >
                  {generating ? (
                  <ActivityIndicator size="small" color={uiColors.background} />
                  ) : (
                    <Text style={styles.generateProgramBtnText}>Create Brand New Program</Text>
                  )}
                </TouchableOpacity>

                </>}
                {editorSection !== 'programs' && <TouchableOpacity
                  testID="save-profile-btn"
                  style={[styles.saveProfileBtn, saving && styles.btnDisabled]}
                  onPress={handleSaveProfile}
                  disabled={saving || generating || evolving}
                  activeOpacity={0.8}
                >
                  {saving ? (
                <ActivityIndicator size="small" color={uiColors.accent} />
                  ) : (
                    <Text style={styles.saveProfileBtnText}>Save changes</Text>
                  )}
                </TouchableOpacity>}
              </View>
            </View>
          </ScrollView>
        </View>
  ) : null;
  if (initialEditor && editor) return editor;

  return (
    <View testID="user-profile-screen" style={styles.screen}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Profile</Text>
          <Text style={styles.headerSubtitle}>
            Your performance and training setup
          </Text>
        </View>
        {onClose && (
          <TouchableOpacity
            testID="close-user-profile-btn"
            style={styles.closeBtn}
            onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"
          >
            <AppIcon name="close" size={20} color={uiColors.accentText} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.performanceLinks}>
          {workoutRepo && exerciseRepo && <>
            <TouchableOpacity
              testID="profile-records-btn"
              accessibilityRole="button"
              style={styles.performanceLink}
              onPress={() => setShowRecords(true)}
            >
              <Text style={styles.hubTitle}>Exercises →</Text>
              <Text style={styles.hubSubtitle}>Exercise details, records and history</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="profile-strength-btn"
              accessibilityRole="button"
              style={styles.performanceLink}
              onPress={() => setShowStrength(true)}
            >
              <Text style={styles.hubTitle}>SBD / DOTS →</Text>
              <Text style={styles.hubSubtitle}>Lift estimates, total and history</Text>
            </TouchableOpacity>
          </>}
        </View>
        <TouchableOpacity
          testID="profile-training-preferences-btn"
          accessibilityRole="button"
          style={styles.hubRow}
          onPress={() => setEditorSection('training')}
        >
          <Text style={styles.hubTitle}>Training preferences →</Text>
          <Text style={styles.hubSubtitle}>{primaryGoal} · {preferredDays} days/week · {preferredDurationMins} minutes</Text>
          <Text style={styles.hubSubtitle}>Mood: {trainingMentality.replace('_', ' ')}{pendingMesoMood ? ' · Changes saved for next cycle' : ''}</Text>
        </TouchableOpacity>
        {gearRepo && <TouchableOpacity
          testID="profile-gear-btn"
          accessibilityRole="button"
          style={styles.hubRow}
          onPress={() => setShowGearInventory(true)}
        >
          <Text style={styles.hubTitle}>Gear & equipment →</Text>
          <Text style={styles.hubSubtitle}>Manage your gym inventory</Text>
        </TouchableOpacity>}
        {bodyMetricsRepo && <TouchableOpacity
          testID="profile-open-body-metrics-btn"
          accessibilityRole="button"
          style={styles.hubRow}
          onPress={() => setShowBodyMetrics(true)}
        >
          <Text style={styles.hubTitle}>Bodyweight & measurements →</Text>
          <Text style={styles.hubSubtitle}>Weigh-ins, body composition and measurements</Text>
        </TouchableOpacity>}
        <TouchableOpacity
          testID="profile-personal-details-btn"
          accessibilityRole="button"
          style={styles.hubRow}
          onPress={() => setEditorSection('details')}
        >
          <Text style={styles.hubTitle}>Personal details →</Text>
          <Text style={styles.hubSubtitle}>Sex, height, birthdate and experience</Text>
        </TouchableOpacity>
        {/* Active Program Banner & Program Overview Hub */}
        <View testID="active-program-banner-card" style={styles.activeProgramCard}>
          <View style={styles.activeProgramHeader}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.activeProgramBadge}>ACTIVE PROGRAM</Text>
                {pendingMesoMood && (
                  <View style={styles.pendingMoodBadge}>
                    <Text style={styles.pendingMoodBadgeText}>Mood Staged for Meso N+1</Text>
                  </View>
                )}
              </View>
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
              <Text style={styles.openOverviewBtnText}>Programs </Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          testID="profile-program-setup-btn"
          accessibilityRole="button"
          style={styles.hubRow}
          onPress={() => setEditorSection('programs')}
        >
          <Text style={styles.hubTitle}>Create or evolve a program →</Text>
          <Text style={styles.hubSubtitle}>Review your setup before generating changes</Text>
        </TouchableOpacity>

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
                  <Text style={styles.metricValue}>{generatedSummary.totalWeeklySets} full{generatedSummary.totalWeeklyMiniSets ? ` + ${generatedSummary.totalWeeklyMiniSets} mini` : ''}</Text>
              </View>
              <View style={styles.summaryMetricItem}>
                <Text style={styles.metricLabel}>Antagonist Pairs</Text>
                <Text style={styles.metricValue}>{generatedSummary.hasSupersets ? 'Active' : 'Sequential'}</Text>
              </View>
            </View>
            <Text style={styles.summaryProgressionText}>
              {generatedSummary.progressionSchemeSummary}
            </Text>
              {generatedSummary.planningWarnings?.map((warning, index) => (
                <Text key={index} style={styles.summaryProgressionText}>{warning}</Text>
              ))}
          </View>
        )}

      </ScrollView>
      {!initialEditor && editor && <Modal visible animationType="slide" onRequestClose={closeEditor}>{editor}</Modal>}

      {showRecords && workoutRepo && exerciseRepo && <Modal visible animationType="slide" onRequestClose={() => setShowRecords(false)}>
        <PersonalRecordsScreen
          workoutRepo={workoutRepo}
          exerciseRepo={exerciseRepo}
          gearRepo={gearRepo}
          userSettingsRepo={userSettingsRepo}
          programBlockService={programBlockService}
          onClose={() => setShowRecords(false)}
        />
      </Modal>}
      {showStrength && workoutRepo && exerciseRepo && <Modal visible animationType="slide" onRequestClose={() => setShowStrength(false)}>
        <StrengthOverviewScreen
          workoutRepo={workoutRepo}
          exerciseRepo={exerciseRepo}
          userSettingsRepo={userSettingsRepo}
          userProfileRepo={userProfileRepo}
          bodyMetricsRepo={bodyMetricsRepo}
          onClose={() => setShowStrength(false)}
        />
      </Modal>}

      {/* Mesocycle Evolution Diff Modal */}
      {showEvolutionModal && evolutionResult && (
        <Modal
          visible={showEvolutionModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowEvolutionModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.evolutionModalCard}>
              <View style={styles.evolutionModalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.evolutionModalBadge}>
                    MESOCYCLE {evolutionResult.mesoNumber} APPLIED
                  </Text>
                  <Text style={styles.evolutionModalTitle}>What Changed & Why</Text>
                </View>
                <TouchableOpacity
                  testID="close-evolution-modal-x"
                  onPress={() => {
                    setShowEvolutionModal(false);
                    setShowProgramOverview(true);
                  }}
                  style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close"
                >
                  <AppIcon name="close" size={20} color={uiColors.accentText} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.evolutionDiffScroll}>
                <Text style={styles.evolutionDiffMarkdown}>
                  {evolutionResult.diffMarkdown}
                </Text>
              </ScrollView>
              <TouchableOpacity
                testID="close-evolution-modal-btn"
                style={styles.closeEvolutionBtn}
                onPress={() => {
                  setShowEvolutionModal(false);
                  setShowProgramOverview(true);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.closeEvolutionBtnText}>
                  View Meso {evolutionResult.mesoNumber} ✓
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Program Overview & Builder Modal */}
      {showProgramOverview && programRepo && programBlockService && (
        <Modal
          visible={showProgramOverview}
          animationType="slide"
          onRequestClose={() => {
            setShowProgramOverview(false);
            setLastGeneratedProgramId(null);
            if (initialEditor) onClose?.(); else loadProfile();
          }}
        >
          <ProgramOverviewScreen
            programRepo={programRepo}
            programBlockService={programBlockService}
            exerciseRepo={exerciseRepo}
            gearRepo={gearRepo}
            initialProgramId={lastGeneratedProgramId || activeInfo?.program.id}
            onClose={() => {
              setShowProgramOverview(false);
              setLastGeneratedProgramId(null);
              if (initialEditor) onClose?.(); else loadProfile();
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
            onEditAccess={() => { setShowGearInventory(false); setEditorSection('equipment'); }}
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
  performanceLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  performanceLink: { flex: 1, minWidth: 140, backgroundColor: uiColors.accentSurface, borderRadius: 14, borderWidth: 1, borderColor: uiColors.accentBorder, padding: 16, gap: 8 },
  hubRow: { backgroundColor: uiColors.raised, borderRadius: 12, padding: 16, gap: 6, marginBottom: 12 },
  hubTitle: { color: uiColors.text, fontWeight: '700', fontSize: 16 },
  hubSubtitle: { color: uiColors.muted, lineHeight: 20, fontSize: 12 },
  activeProgramCard: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.accent,
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
    color: uiColors.accentText,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  activeProgramTitle: {
    color: uiColors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  activeProgramMeta: {
    color: uiColors.subtle,
    fontSize: 11,
    marginTop: 2,
  },
  openOverviewBtn: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.accent,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  openOverviewBtnText: {
    color: uiColors.accentText,
    fontSize: 12,
    fontWeight: '700',
  },
  optionSubtitle: {
    color: uiColors.muted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
    marginBottom: 2,
  },
  screen: {
    flex: 1,
    backgroundColor: uiColors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: uiColors.background,
  },
  loadingText: {
    color: uiColors.subtle,
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
    borderBottomColor: uiColors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: uiColors.text,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: uiColors.subtle,
    marginTop: 2,
  },
  closeBtn: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    padding: 8,
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
    color: uiColors.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: '#0F1A12',
    borderWidth: 1,
    borderColor: uiColors.accent,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  summaryHeader: {
    marginBottom: 12,
  },
  summaryBadge: {
    color: uiColors.accentText,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  summarySplitTitle: {
    color: uiColors.text,
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
    color: uiColors.accentText,
    fontSize: 10,
    fontWeight: '500',
  },
  metricValue: {
    color: uiColors.text,
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
    color: uiColors.accentText,
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  cardDescription: {
    color: uiColors.muted,
    fontSize: 12,
    marginBottom: 12,
  },
  inputLabel: {
    color: uiColors.secondaryText,
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
    backgroundColor: uiColors.raised,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  toggleBtnActive: {
    backgroundColor: uiColors.accent,
    borderColor: uiColors.accent,
  },
  toggleBtnText: {
    color: uiColors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  toggleBtnTextActive: {
    color: uiColors.background,
    fontWeight: '600',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  fieldHalf: {
    flex: 1,
  },
  textInput: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: 6,
    color: uiColors.text,
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
    backgroundColor: uiColors.raised,
    borderColor: uiColors.border,
  },
  optionRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: uiColors.subtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    marginRight: 10,
  },
  optionRadioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: uiColors.accent,
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
    color: uiColors.accentText,
    fontWeight: '600',
  },
  goalPillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  goalPill: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 20,
  },
  goalPillActive: {
    backgroundColor: uiColors.accent,
    borderColor: uiColors.accent,
  },
  goalPillText: {
    lineHeight: 16,
    color: uiColors.secondaryText,
    fontSize: 11,
    fontWeight: '600',
  },
  goalPillTextActive: {
    color: uiColors.background,
    fontWeight: '600',
  },
  secondaryGoalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  secondaryPill: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  secondaryPillActive: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
  },
  secondaryPillText: {
    lineHeight: 16,
    fontWeight: '600',
    color: uiColors.subtle,
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
    backgroundColor: uiColors.raised,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.border,
    alignItems: 'center',
  },
  dayBtnActive: {
    backgroundColor: uiColors.accent,
    borderColor: uiColors.accent,
  },
  dayBtnText: {
    color: uiColors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  dayBtnTextActive: {
    color: uiColors.background,
    fontWeight: '700',
  },
  actionButtonsContainer: {
    marginTop: 16,
    gap: 12,
  },
  evolveProgramBtn: {
    backgroundColor: uiColors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  evolveProgramBtnCompleted: {
    backgroundColor: '#38BDF8',
    borderWidth: 1,
    borderColor: '#7DD3FC',
  },
  evolveProgramBtnText: {
    color: uiColors.background,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  generateProgramBtn: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateProgramBtnText: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '800',
  },
  saveProfileBtn: {
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveProfileBtnText: {
    color: uiColors.secondaryText,
    fontSize: 13,
    fontWeight: '600',
  },
  pendingMoodBadge: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: '#002914',
    borderWidth: 1,
    borderColor: uiColors.accent,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pendingMoodBadgeText: {
    lineHeight: 16,
    color: uiColors.accentText,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  evolutionModalCard: {
    backgroundColor: uiColors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: uiColors.accent,
    width: '100%',
    maxHeight: '80%',
    padding: 20,
  },
  evolutionModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  evolutionModalBadge: {
    color: uiColors.accentText,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  evolutionModalTitle: {
    color: uiColors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  modalCloseBtn: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    padding: 6,
  },
  evolutionDiffScroll: {
    maxHeight: 320,
    marginVertical: 12,
  },
  evolutionDiffMarkdown: {
    color: uiColors.secondaryText,
    fontSize: 13,
    lineHeight: 20,
  },
  closeEvolutionBtn: {
    backgroundColor: uiColors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  closeEvolutionBtnText: {
    color: uiColors.background,
    fontSize: 14,
    fontWeight: '900',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  questionnaireBody: {
    backgroundColor: uiColors.background,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: uiColors.accent,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingTop: 16,
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
});
