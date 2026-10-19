/**
 * Workout Suite — HomeScreen
 *
 * Implements Section 4.1: Tab 1: HOME (Dashboard, Calendar & Analytics Hub)
 * - Top Section: Quick Status Dashboard (Active Program, Next Workout card, Weekly Metrics)
 * - Middle Section: Interactive Calendar Agenda (monthly grid, weekly agenda, workout dots)
 * - Bottom Section: Future Analytics Mount Point (e1RM, Bodyweight, DOTS, Symmetry radar)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {
  IWorkoutRepository,
  IExerciseRepository,
  IGearRepository,
  IUserSettingsRepository,
  IProgramRepository,
  IBodyMetricsRepository,
  IUserProfileRepository,
} from '../../domain/repositories';
import {
  ProgramBlockService,
  ActiveProgramInfo,
} from '../../services/programBlockService';
import {
  computeDashboardMetrics,
  WeeklyMetrics,
} from '../../services/dashboardMetricsService';
import { CalendarScreen } from '../calendar/CalendarScreen';
import { PlotsScreen } from '../plots/PlotsScreen';
import { WorkloadDeepDiveModal } from '../plots/WorkloadDeepDiveModal';
import { BodyMetricsScreen } from '../bodyMetrics/BodyMetricsScreen';
import { SBDBalanceRadarChart } from '../inspection/SBDBalanceRadarChart';
import { ExerciseInspectionService } from '../../services/exerciseInspectionService';
import {
  WorkoutTemplate,
  Program,
  SBDBalanceProfile,
  Gender,
  WeightUnit,
} from '../../core/types';

export interface HomeScreenProps {
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  programRepo?: IProgramRepository;
  programBlockService?: ProgramBlockService;
  bodyMetricsRepo?: IBodyMetricsRepository;
  userProfileRepo?: IUserProfileRepository;
  onNavigateToWorkout?: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToCalendar?: () => void;
  onNavigateToAnalytics?: (targetGroup?: 'performance' | 'body_composition') => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  workoutRepo,
  exerciseRepo,
  gearRepo,
  userSettingsRepo,
  programRepo,
  programBlockService,
  bodyMetricsRepo,
  userProfileRepo,
  onNavigateToWorkout,
  onNavigateToProfile,
  onNavigateToCalendar,
  onNavigateToAnalytics,
}) => {
  const [showBodyMetricsModal, setShowBodyMetricsModal] = useState<boolean>(false);
  const [showRadarModal, setShowRadarModal] = useState<boolean>(false);
  const [showWorkloadModal, setShowWorkloadModal] = useState<boolean>(false);
  const [sbdProfile, setSbdProfile] = useState<SBDBalanceProfile | null>(null);
  const [userGender, setUserGender] = useState<Gender>('male');
  const [userBodyweightKg, setUserBodyweightKg] = useState<number | null>(null);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [loading, setLoading] = useState<boolean>(true);
  const [activeInfo, setActiveInfo] = useState<ActiveProgramInfo | null>(null);
  const [nextTemplate, setNextTemplate] = useState<WorkoutTemplate | null>(null);
  const [weeklyMetrics, setWeeklyMetrics] = useState<WeeklyMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(true);

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);

      // 1. Immediately load fast program block info and template progression
      if (programBlockService && programRepo) {
        try {
          const active = await programBlockService.getActiveProgram();
          setActiveInfo(active);

          if (active) {
            const details = await programRepo.getProgramWithDetails(active.program.id);
            if (details && details.templates.length > 0) {
              const tmpls = details.templates;
              const recent = await workoutRepo.findAll({ limit: 15 });
              const tmplIds = tmpls.map((t) => t.id);
              const lastCompleted = recent.find(
                (w) => w.status === 'completed' && w.template_id && tmplIds.includes(w.template_id)
              );

              let nextIdx = 0;
              if (lastCompleted && lastCompleted.template_id) {
                const lastIdx = tmpls.findIndex((t) => t.id === lastCompleted.template_id);
                if (lastIdx !== -1) {
                  nextIdx = (lastIdx + 1) % tmpls.length;
                }
              }
              setNextTemplate(tmpls[nextIdx]);
            }
          }
        } catch {
          // Ignore
        }
      }

      // 2. Load basic user settings
      let currentGender: Gender = 'male';
      let currentBw: number | null = null;
      if (userSettingsRepo) {
        try {
          const [gender, bw, unit] = await Promise.all([
            userSettingsRepo.getUserGender(),
            userSettingsRepo.getUserBodyweight(),
            userSettingsRepo.getUnitSystem(),
          ]);
          currentGender = gender;
          currentBw = bw;
          setUserGender(gender);
          setUserBodyweightKg(bw);
          setUnitSystem(unit);
        } catch {
          // Ignore
        }
      }

      // Yield UI thread: render headers and active cards immediately
      setLoading(false);

      // 3. Offload heavy historical metrics and allometric radar calculations (Phase 5)
      const scheduleIdleTask =
        typeof (globalThis as any).requestIdleCallback === 'function'
          ? (globalThis as any).requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 1);

      scheduleIdleTask(async () => {
        try {
          setMetricsLoading(true);
          const metrics = await computeDashboardMetrics(workoutRepo);
          setWeeklyMetrics(metrics);

          if (currentBw && currentBw > 0) {
            const inspectionService = new ExerciseInspectionService(workoutRepo, exerciseRepo);
            const profile = await inspectionService.getSBDBalanceProfile({
              gender: currentGender,
              bodyweightKg: currentBw,
            });
            setSbdProfile(profile);
          } else {
            setSbdProfile(null);
          }
        } catch (e) {
          console.warn('Background analytics calculation error:', e);
        } finally {
          setMetricsLoading(false);
        }
      });
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setLoading(false);
    }
  }, [workoutRepo, exerciseRepo, userSettingsRepo, programRepo, programBlockService]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  return (
    <View testID="home-screen" style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* ==================================================================== */}
        {/* 1. TOP SECTION — QUICK STATUS DASHBOARD                              */}
        {/* ==================================================================== */}
        <View testID="home-status-dashboard" style={styles.dashboardSection}>
          {/* Active Program Badge Row */}
          <View style={styles.activeProgramRow}>
            <View style={styles.activeProgramInfo}>
              <Text style={styles.dashboardSubtitle}>DATSET TRAINING HUB</Text>
              <View style={styles.programTitleContainer}>
                {activeInfo ? (
                  <>
                    <View
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: activeInfo.program.color_hex || '#00E676' },
                      ]}
                    />
                    <Text testID="home-active-program-name" style={styles.activeProgramName}>
                      {activeInfo.program.name}
                    </Text>
                  </>
                ) : (
                  <Text testID="home-active-program-name" style={styles.noProgramName}>
                    No Program Active
                  </Text>
                )}
              </View>
            </View>

            {onNavigateToProfile && (
              <TouchableOpacity
                testID="home-manage-program-btn"
                style={styles.manageProgramBtn}
                onPress={onNavigateToProfile}
              >
                <Text style={styles.manageProgramBtnText}>Program 📋</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Next Scheduled Workout Quick Card */}
          {activeInfo && nextTemplate ? (
            <TouchableOpacity
              testID="next-workout-card"
              style={styles.nextWorkoutCard}
              onPress={onNavigateToWorkout}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Start next workout: ${nextTemplate.name}`}
            >
              <View style={styles.nextWorkoutLeft}>
                <Text style={styles.nextWorkoutTag}>NEXT WORKOUT</Text>
                <Text testID="next-workout-name" style={styles.nextWorkoutTitle}>
                  {nextTemplate.name}
                </Text>
                {nextTemplate.notes && (
                  <Text style={styles.nextWorkoutNotes} numberOfLines={1}>
                    {nextTemplate.notes}
                  </Text>
                )}
              </View>
              <View style={styles.startNowBtn}>
                <Text style={styles.startNowBtnText}>START ⚡</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <View testID="next-workout-empty-card" style={styles.noProgramCard}>
              <Text style={styles.noProgramCardText}>
                No program active. Visit your profile to synthesize or pick a program.
              </Text>
            </View>
          )}

          {/* Weekly Summary Metrics Row */}
          <View testID="weekly-metrics-card" style={styles.metricsRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>WORKOUTS</Text>
              <Text testID="metric-workouts-this-week" style={styles.metricValue}>
                {weeklyMetrics ? weeklyMetrics.workoutsThisWeek : metricsLoading ? '—' : '0'}
              </Text>
              <Text style={styles.metricSub}>this week</Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>TONNAGE</Text>
              <Text testID="metric-tonnage-this-week" style={styles.metricValue}>
                {weeklyMetrics
                  ? `${weeklyMetrics.totalTonnageKg.toLocaleString()} kg`
                  : metricsLoading
                  ? '—'
                  : '0 kg'}
              </Text>
              <Text style={styles.metricSub}>volume lifted</Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>STREAK</Text>
              <Text testID="metric-active-streak" style={styles.metricValue}>
                {weeklyMetrics
                  ? `${weeklyMetrics.activeStreakWeeks} wks`
                  : metricsLoading
                  ? '—'
                  : '0 wks'}
              </Text>
              <Text style={styles.metricSub}>consistent</Text>
            </View>
          </View>
        </View>

        {/* ==================================================================== */}
        {/* 2. MIDDLE SECTION — INTERACTIVE CALENDAR AGENDA                      */}
        {/* ==================================================================== */}
        {/* ==================================================================== */}
        {/* 2. MIDDLE SECTION — TRAINING CALENDAR & AGENDA                       */}
        {/* ==================================================================== */}
        <View testID="home-calendar-section" style={styles.calendarSection}>
          <View style={styles.analyticsHeaderRow}>
            <View>
              <Text style={styles.sectionSubtitle}>SCHEDULE & PERIODIZATION</Text>
              <Text style={styles.sectionTitle}>Training Calendar</Text>
            </View>
            {onNavigateToCalendar && (
              <TouchableOpacity
                testID="home-open-calendar-btn"
                style={styles.openFullViewBtn}
                onPress={onNavigateToCalendar}
                activeOpacity={0.7}
              >
                <Text style={styles.openFullViewBtnText}>Full View ➔</Text>
              </TouchableOpacity>
            )}
          </View>

          {onNavigateToCalendar ? (
            <TouchableOpacity
              testID="home-calendar-summary-card"
              style={[styles.hubSummaryCard, styles.calendarSummaryCard]}
              onPress={onNavigateToCalendar}
              activeOpacity={0.8}
            >
              <View style={styles.hubSummaryLeft}>
                <Text style={styles.hubSummaryTag}>SCHEDULED TRAINING</Text>
                <Text style={styles.hubSummaryTitle}>
                  {activeInfo ? `${activeInfo.program.name} • Active Meso` : 'Calendar & Periodization'}
                </Text>
                <Text style={styles.hubSummaryDesc}>
                  Tap to view monthly workout calendar, inspect past logged sessions, and view scheduled template sequence.
                </Text>
              </View>
              <View style={styles.hubSummaryAction}>
                <Text style={styles.hubSummaryActionText}>Open ➔</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.calendarWrapper}>
              <CalendarScreen
                workoutRepo={workoutRepo}
                exerciseRepo={exerciseRepo}
                gearRepo={gearRepo}
                userSettingsRepo={userSettingsRepo}
                programBlockService={programBlockService}
              />
            </View>
          )}
        </View>

        {/* ==================================================================== */}
        {/* 3. PERFORMANCE ANALYTICS (e1RM, Volume Tonnage & DOTS Progression)   */}
        {/* ==================================================================== */}
        <View testID="home-performance-section" style={styles.analyticsSection}>
          <View style={styles.analyticsHeaderRow}>
            <View>
              <Text style={styles.sectionSubtitle}>STRENGTH & WORK CAPACITY</Text>
              <Text style={styles.sectionTitle}>Performance Analytics</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                testID="home-workload-deep-dive-btn"
                style={styles.deepDiveHeaderBtn}
                onPress={() => setShowWorkloadModal(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.deepDiveHeaderBtnText}>Deep Dive 🔍</Text>
              </TouchableOpacity>
              {onNavigateToAnalytics && (
                <TouchableOpacity
                  testID="home-open-analytics-btn"
                  style={styles.openFullViewBtn}
                  onPress={() => onNavigateToAnalytics('performance')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.openFullViewBtnText}>Charts ➔</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Allometric Strength & DOTS Intelligence Card (Always Displayed) */}
          <TouchableOpacity
            testID="home-dots-progression-btn"
            style={styles.dotsCardFull}
            onPress={() => setShowRadarModal(true)}
            activeOpacity={0.7}
          >
            <View style={styles.dotsCardHeader}>
              <View style={styles.dotsBadgeRow}>
                <Text style={styles.analyticsCardBadge}>ALLOMETRIC COEFFICIENT</Text>
                {sbdProfile?.dotsScore ? (
                  <Text style={styles.dotsScoreHighlight}>
                    {sbdProfile.dotsScore.toFixed(1)} <Text style={styles.dotsScoreUnit}>pts</Text>
                  </Text>
                ) : null}
              </View>
              <Text style={styles.dotsCardActionHint}>Inspect ➔</Text>
            </View>
            <Text style={styles.analyticsCardTitle}>DOTS Progression & SBD Balance</Text>
            <Text style={styles.analyticsCardDesc}>
              {sbdProfile?.dotsScore
                ? `Current score: ${sbdProfile.dotsScore.toFixed(1)} points across SBD relative to ${userBodyweightKg ? userBodyweightKg.toFixed(1) : ''} ${unitSystem}. Tap to inspect balance radar & strength standards.`
                : 'Bodyweight-normalized coefficient tracking pure strength-to-mass ratio changes. Tap to inspect balance radar & strength standards.'}
            </Text>
          </TouchableOpacity>

          {onNavigateToAnalytics ? (
            <TouchableOpacity
              testID="home-performance-summary-card"
              style={styles.hubSummaryCard}
              onPress={() => onNavigateToAnalytics('performance')}
              activeOpacity={0.8}
            >
              <View style={styles.hubSummaryLeft}>
                <Text style={styles.hubSummaryTag}>ESTIMATED 1RM & VOLUME</Text>
                <Text style={styles.hubSummaryTitle}>Performance Progression</Text>
                <Text style={styles.hubSummaryDesc}>
                  Track estimated 1RMs, weekly tonnage, set volume across muscle groups, and RPE distributions.
                </Text>
              </View>
              <View style={styles.hubSummaryAction}>
                <Text style={styles.hubSummaryActionText}>Open ➔</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <PlotsScreen
              workoutRepo={workoutRepo}
              exerciseRepo={exerciseRepo}
              bodyMetricsRepo={bodyMetricsRepo}
              userProfileRepo={userProfileRepo}
              programRepo={programRepo}
              programBlockService={programBlockService}
              userSettingsRepo={userSettingsRepo}
              targetGroup="performance"
              initialChartType="e1rm"
              isInline={true}
            />
          )}
        </View>

        {/* ==================================================================== */}
        {/* 4. BODY COMPOSITION (Bodyweight, Body Fat % & Circumferences)        */}
        {/* ==================================================================== */}
        <View testID="home-body-composition-section" style={styles.analyticsSection}>
          <View style={styles.analyticsHeaderRow}>
            <View>
              <Text style={styles.sectionSubtitle}>PHYSIQUE & ANTHROPOMETRY</Text>
              <Text style={styles.sectionTitle}>Body Composition</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {bodyMetricsRepo && (
                <TouchableOpacity
                  testID="home-log-body-metrics-btn"
                  style={styles.logMetricsBtn}
                  onPress={() => setShowBodyMetricsModal(true)}
                >
                  <Text style={styles.logMetricsBtnText}>Log Body ⚖️</Text>
                </TouchableOpacity>
              )}
              {onNavigateToAnalytics && (
                <TouchableOpacity
                  testID="home-open-body-plots-btn"
                  style={styles.openFullViewBtn}
                  onPress={() => onNavigateToAnalytics('body_composition')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.openFullViewBtnText}>Trends ➔</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {onNavigateToAnalytics ? (
            <TouchableOpacity
              testID="home-body-composition-summary-card"
              style={styles.hubSummaryCard}
              onPress={() => onNavigateToAnalytics('body_composition')}
              activeOpacity={0.8}
            >
              <View style={styles.hubSummaryLeft}>
                <Text style={styles.hubSummaryTag}>METRICS & PROGRESS</Text>
                <Text style={styles.hubSummaryTitle}>Weight & Body Fat Trends</Text>
                <Text style={styles.hubSummaryDesc}>
                  Track weigh-ins, moving averages, and anthropometric circumference trends. Tap to inspect charts.
                </Text>
              </View>
              <View style={styles.hubSummaryAction}>
                <Text style={styles.hubSummaryActionText}>Open ➔</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <PlotsScreen
              workoutRepo={workoutRepo}
              exerciseRepo={exerciseRepo}
              bodyMetricsRepo={bodyMetricsRepo}
              userProfileRepo={userProfileRepo}
              programRepo={programRepo}
              programBlockService={programBlockService}
              userSettingsRepo={userSettingsRepo}
              targetGroup="body_composition"
              initialChartType="bodyweight"
              isInline={true}
              onNavigateToBodyMetrics={() => setShowBodyMetricsModal(true)}
            />
          )}
        </View>
      </ScrollView>

      {/* Body Metrics Logging Full-Screen Modal */}
      {bodyMetricsRepo && (
        <Modal
          visible={showBodyMetricsModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowBodyMetricsModal(false)}
        >
          <BodyMetricsScreen
            bodyMetricsRepo={bodyMetricsRepo}
            userProfileRepo={userProfileRepo}
            userSettingsRepo={userSettingsRepo}
            onClose={() => setShowBodyMetricsModal(false)}
          />
        </Modal>
      )}

      {/* SBD Symmetry Radar & DOTS Intelligence Modal */}
      <Modal
        visible={showRadarModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowRadarModal(false)}
      >
        <SBDBalanceRadarChart
          balanceProfile={sbdProfile}
          gender={userGender}
          bodyweightKg={userBodyweightKg}
          unitSystem={unitSystem}
          onClose={() => setShowRadarModal(false)}
          onOpenProfile={() => {
            setShowRadarModal(false);
            onNavigateToProfile?.();
          }}
        />
      </Modal>

      {/* Workload, Volume Landmarks & Intensity Deep Dive Modal */}
      <WorkloadDeepDiveModal
        visible={showWorkloadModal}
        workoutRepo={workoutRepo}
        exerciseRepo={exerciseRepo}
        userSettingsRepo={userSettingsRepo}
        onClose={() => setShowWorkloadModal(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  dashboardSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
  },
  dashboardSubtitle: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  activeProgramRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  activeProgramInfo: {
    flex: 1,
  },
  programTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  colorSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  activeProgramName: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  noProgramName: {
    color: '#71717A',
    fontSize: 16,
    fontWeight: '700',
  },
  manageProgramBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  manageProgramBtnText: {
    color: '#D4D4D8',
    fontSize: 12,
    fontWeight: '700',
  },
  nextWorkoutCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#00E676',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  nextWorkoutLeft: {
    flex: 1,
    paddingRight: 12,
  },
  nextWorkoutTag: {
    color: '#00E676',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 2,
  },
  nextWorkoutTitle: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
  },
  nextWorkoutNotes: {
    color: '#A1A1AA',
    fontSize: 11,
    marginTop: 2,
  },
  startNowBtn: {
    backgroundColor: '#00E676',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  startNowBtnText: {
    color: '#0A0A0A',
    fontSize: 13,
    fontWeight: '900',
  },
  noProgramCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  noProgramCardText: {
    color: '#A1A1AA',
    fontSize: 12,
    marginBottom: 10,
  },
  freestyleBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#00E676',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  freestyleBtnText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '800',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  metricLabel: {
    color: '#71717A',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metricValue: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '900',
    marginVertical: 2,
  },
  metricSub: {
    color: '#52525B',
    fontSize: 9,
  },
  calendarSection: {
    paddingTop: 16,
  },
  sectionTitle: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  calendarWrapper: {
    minHeight: 180,
  },
  analyticsSection: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#18181B',
    marginTop: 16,
  },
  analyticsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionSubtitle: {
    color: '#71717A',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  logMetricsBtn: {
    backgroundColor: '#14291B',
    borderColor: '#00E676',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  logMetricsBtnText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '700',
  },
  analyticsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  analyticsCard: {
    width: '48%',
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 8,
    padding: 12,
  },
  analyticsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  analyticsCardIcon: {
    fontSize: 16,
  },
  analyticsCardBadge: {
    backgroundColor: '#1E293B',
    color: '#38BDF8',
    fontSize: 8,
    fontWeight: '800',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  analyticsCardTitle: {
    color: '#E4E4E7',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  analyticsCardDesc: {
    color: '#71717A',
    fontSize: 10,
    lineHeight: 14,
  },
  dotsCardFull: {
    width: '100%',
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  dotsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  dotsBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dotsScoreHighlight: {
    color: '#00E676',
    fontSize: 13,
    fontWeight: '800',
  },
  dotsScoreUnit: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '600',
  },
  dotsCardActionHint: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '700',
  },
  deepDiveHeaderBtn: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  deepDiveHeaderBtnText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  openFullViewBtn: {
    backgroundColor: '#18181B',
    borderColor: '#27272A',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  openFullViewBtnText: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '700',
  },
  hubSummaryCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 10,
    padding: 14,
    marginTop: 4,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calendarSummaryCard: {
    marginHorizontal: 16,
  },
  hubSummaryLeft: {
    flex: 1,
    marginRight: 12,
  },
  hubSummaryTag: {
    color: '#00E676',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  hubSummaryTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  hubSummaryDesc: {
    color: '#71717A',
    fontSize: 11,
    lineHeight: 15,
  },
  hubSummaryAction: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hubSummaryActionText: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '700',
  },
});
