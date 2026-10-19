/**
 * Workout Suite — Mobile Application Entry & Root Navigation
 *
 * Implements Section 4: Main Navigation Overhaul (HOME, WORKOUT, PROFILE, SETTINGS)
 * Implements Section 4.1: Tab 1: HOME (Dashboard, Calendar & Analytics Hub)
 * Implements Section 4.2: Tab 2: WORKOUT (Smart Session Router: State A/B/C)
 * Implements Section 4.3: Tab 3: PROFILE (Demographics, Mentality, Generator, Program Overview)
 * Implements Section 4.4: Tab 4: SETTINGS (Gym Mechanics, Equipment & Utilities)
 * Implements ADR-001: Local-First Architecture with SQLite
 * Implements ADR-010: Write-Through Crash Recovery for Active Sessions
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Modal,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import {
  IWorkoutRepository,
  IExerciseRepository,
  IGearRepository,
  IUserSettingsRepository,
  IProgramRepository,
  IUserProfileRepository,
  IBodyMetricsRepository,
  IPainReportRepository,
} from './src/domain/repositories';
import {
  getDatabase,
  ISQLiteDatabase,
  SQLiteWorkoutRepository,
  SQLiteExerciseRepository,
  SQLiteGearRepository,
  SQLiteUserSettingsRepository,
  SQLiteProgramRepository,
  SQLiteUserProfileRepository,
  SQLiteBodyMetricsRepository,
  SQLitePainReportRepository,
} from './src/database';
import { ProgramBlockService } from './src/services/programBlockService';
import { WorkoutTabRouter } from './src/features/logger';
import { HomeScreen } from './src/features/home';
import { CalendarScreen } from './src/features/calendar';
import { PlotsScreen } from './src/features/plots';
import { BodyMetricsScreen } from './src/features/bodyMetrics';
import { UserProfileScreen } from './src/features/profile';
import { SettingsScreen } from './src/features/settings';
import { OnboardingWizardModal } from './src/features/onboarding';
import { Workout } from './src/core/types';
import { RepositoryProvider } from './src/context/RepositoryContext';

export type RootTab = 'home' | 'workout' | 'profile' | 'settings' | 'logger' | 'calendar';

export interface AppProps {
  initialTab?: RootTab;
  initialWorkoutId?: string;
  workoutRepo?: IWorkoutRepository;
  exerciseRepo?: IExerciseRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  programRepo?: IProgramRepository;
  userProfileRepo?: IUserProfileRepository;
  bodyMetricsRepo?: IBodyMetricsRepository;
  painReportRepo?: IPainReportRepository;
  programBlockService?: ProgramBlockService;
  db?: ISQLiteDatabase;
  [key: string]: unknown;
}

export default function App({
  initialTab = 'home',
  initialWorkoutId,
  workoutRepo: propWorkoutRepo,
  exerciseRepo: propExerciseRepo,
  gearRepo: propGearRepo,
  userSettingsRepo: propUserSettingsRepo,
  programRepo: propProgramRepo,
  userProfileRepo: propUserProfileRepo,
  bodyMetricsRepo: propBodyMetricsRepo,
  painReportRepo: propPainReportRepo,
  programBlockService: propProgramBlockService,
  db: propDb,
}: AppProps = {}) {
  const [activeTab, setActiveTab] = useState<RootTab>(initialTab);
  const [activeSubScreen, setActiveSubScreen] = useState<'calendar' | 'analytics' | null>(
    initialTab === 'calendar' ? 'calendar' : null
  );
  const [analyticsGroup, setAnalyticsGroup] = useState<'performance' | 'body_composition'>('performance');
  const [showBodyMetricsModal, setShowBodyMetricsModal] = useState<boolean>(false);
  const [tabHistory, setTabHistory] = useState<RootTab[]>([initialTab]);
  const [dbReady, setDbReady] = useState<boolean>(!!propWorkoutRepo);
  const [hasActiveWorkout, setHasActiveWorkout] = useState<boolean>(false);
  const [database, setDatabase] = useState<ISQLiteDatabase | undefined>(propDb);

  const [currentWorkoutId, setCurrentWorkoutId] = useState<string | undefined>(
    initialWorkoutId
  );
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [settingsInitialShowImport, setSettingsInitialShowImport] = useState<boolean>(false);

  const handleNavigateToTab = useCallback((newTab: RootTab) => {
    setActiveSubScreen(null);
    if (newTab !== 'settings') {
      setSettingsInitialShowImport(false);
    }
    setActiveTab(newTab);
    setTabHistory((prev) => {
      if (prev[prev.length - 1] === newTab) return prev;
      return [...prev, newTab];
    });
  }, []);

  // Intercept Android hardware back button (Back-Stack navigation)
  useEffect(() => {
    const onHardwareBack = () => {
      if (activeSubScreen) {
        setActiveSubScreen(null);
        return true;
      }
      if (tabHistory.length > 1) {
        const nextHistory = [...tabHistory];
        nextHistory.pop();
        const prevTab = nextHistory[nextHistory.length - 1] || 'home';
        setTabHistory(nextHistory);
        setActiveTab(prevTab);
        return true;
      }
      if (activeTab !== 'home') {
        setActiveTab('home');
        setTabHistory(['home']);
        return true;
      }
      return false; // Allow default OS exit behavior when on root home
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [tabHistory, activeTab, activeSubScreen]);

  // Normalize legacy tab names
  const currentTab = ((): 'home' | 'workout' | 'profile' | 'settings' => {
    if (activeTab === 'logger') return 'workout';
    if (activeTab === 'calendar') return 'home';
    return activeTab as 'home' | 'workout' | 'profile' | 'settings';
  })();

  // Concrete repositories (fallback to SQLite if props omitted)
  const [repos, setRepos] = useState<{
    workoutRepo: IWorkoutRepository;
    exerciseRepo: IExerciseRepository;
    gearRepo: IGearRepository;
    userSettingsRepo: IUserSettingsRepository;
    programRepo: IProgramRepository;
    userProfileRepo: IUserProfileRepository;
    bodyMetricsRepo: IBodyMetricsRepository;
    painReportRepo: IPainReportRepository;
    programBlockService: ProgramBlockService;
  } | null>(() => {
    if (propWorkoutRepo && propExerciseRepo && propUserSettingsRepo) {
      const pRepo = propProgramRepo || ({} as IProgramRepository);
      const upRepo = propUserProfileRepo || ({} as IUserProfileRepository);
      const bmRepo = propBodyMetricsRepo || ({} as IBodyMetricsRepository);
      const painRepo = propPainReportRepo || ({} as IPainReportRepository);
      const pbService =
        propProgramBlockService ||
        (propProgramRepo ? new ProgramBlockService(propProgramRepo) : ({} as ProgramBlockService));
      return {
        workoutRepo: propWorkoutRepo,
        exerciseRepo: propExerciseRepo,
        gearRepo: propGearRepo || ({} as IGearRepository),
        userSettingsRepo: propUserSettingsRepo,
        programRepo: pRepo,
        userProfileRepo: upRepo,
        bodyMetricsRepo: bmRepo,
        painReportRepo: painRepo,
        programBlockService: pbService,
      };
    }
    return null;
  });

  // Initialize SQLite database when not provided via props
  useEffect(() => {
    if (repos) {
      setDbReady(true);
      return;
    }

    let isMounted = true;

    (async () => {
      try {
        const db = await getDatabase();
        if (!isMounted) return;
        setDatabase(db);

        const wRepo = new SQLiteWorkoutRepository(db);
        const eRepo = new SQLiteExerciseRepository(db);
        const gRepo = new SQLiteGearRepository(db);
        const uRepo = new SQLiteUserSettingsRepository(db);
        const pRepo = new SQLiteProgramRepository(db);
        const upRepo = new SQLiteUserProfileRepository(db);
        const bmRepo = new SQLiteBodyMetricsRepository(db);
        const painRepo = new SQLitePainReportRepository(db);
        const pbService = new ProgramBlockService(pRepo);

        setRepos({
          workoutRepo: wRepo,
          exerciseRepo: eRepo,
          gearRepo: gRepo,
          userSettingsRepo: uRepo,
          programRepo: pRepo,
          userProfileRepo: upRepo,
          bodyMetricsRepo: bmRepo,
          painReportRepo: painRepo,
          programBlockService: pbService,
        });

        // Check if an active session is in progress
        const inProgress = await wRepo.getInProgressWorkout();
        if (inProgress && isMounted) {
          setHasActiveWorkout(true);
          if (!currentWorkoutId) {
            setCurrentWorkoutId(inProgress.id);
          }
        }

        if (isMounted) {
          setDbReady(true);
        }
      } catch (err) {
        if (isMounted) {
          setDbReady(true);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [repos, currentWorkoutId]);

  // Periodic or event-driven check for active in-progress workout
  const checkActiveWorkout = useCallback(async () => {
    if (!repos?.workoutRepo) return;
    try {
      const inProgress = await repos.workoutRepo.getInProgressWorkout();
      setHasActiveWorkout(!!inProgress);
      if (inProgress) {
        setCurrentWorkoutId(inProgress.id);
      }
    } catch {
      // Ignore
    }
  }, [repos]);

  useEffect(() => {
    if (dbReady) {
      checkActiveWorkout();
    }
  }, [dbReady, checkActiveWorkout, activeTab]);

  // Check if first-time user onboarding should be presented
  useEffect(() => {
    if (!repos || !dbReady) return;
    let isMounted = true;
    (async () => {
      try {
        const completed = await repos.userSettingsRepo.get('onboarding_completed');
        if (completed !== '1') {
          const workouts = await repos.workoutRepo.findAll();
          if (workouts.length === 0 && isMounted) {
            setShowOnboarding(true);
          }
        }
      } catch {
        // Safe fallback
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [repos, dbReady]);

  // Handle starting a workout from router or home
  const handleStartSession = (workoutId: string) => {
    setCurrentWorkoutId(workoutId);
    setHasActiveWorkout(true);
    handleNavigateToTab('workout');
  };

  // Handle session finished in logger -> switch to home tab to view metrics/calendar
  const handleFinishSession = (completedWorkout: Workout) => {
    setHasActiveWorkout(false);
    setCurrentWorkoutId(undefined);
    handleNavigateToTab('home');
  };

  const handleDiscardSession = () => {
    setHasActiveWorkout(false);
    setCurrentWorkoutId(undefined);
    handleNavigateToTab('home');
  };

  if (!dbReady || !repos) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.loadingScreen} edges={['top', 'bottom', 'left', 'right']}>
          <StatusBar style="light" />
          <ActivityIndicator size="large" color="#00E676" />
          <Text style={styles.loadingTitle}>datSet</Text>
          <Text style={styles.loadingSubtext}>
            Initializing offline SQLite storage...
          </Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <RepositoryProvider repositories={repos}>
        <SafeAreaView style={styles.rootContainer} edges={['top', 'bottom', 'left', 'right']}>
          <StatusBar style="light" />

        {/* Screen Body Container */}
        <View style={styles.bodyContainer}>
          {/* TAB 1: HOME (Dashboard, Calendar & Analytics Hub) */}
          {currentTab === 'home' && (
            <View style={[styles.tabContentContainer, styles.visibleContent]}>
              {activeSubScreen === 'calendar' ? (
                <View style={styles.subScreenContainer}>
                  <View style={styles.subScreenHeader}>
                    <TouchableOpacity
                      testID="subscreen-back-btn"
                      style={styles.subScreenBackBtn}
                      onPress={() => setActiveSubScreen(null)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.subScreenBackBtnText}>← Back</Text>
                    </TouchableOpacity>
                    <Text style={styles.subScreenHeaderTitle}>Calendar & Periodization</Text>
                    <View style={{ width: 60 }} />
                  </View>
                  <CalendarScreen
                    workoutRepo={repos.workoutRepo}
                    exerciseRepo={repos.exerciseRepo}
                    gearRepo={repos.gearRepo}
                    userSettingsRepo={repos.userSettingsRepo}
                    programBlockService={repos.programBlockService}
                    onStartWorkout={(dateIso) => {
                      setActiveSubScreen(null);
                      handleNavigateToTab('workout');
                    }}
                    onSelectWorkout={(workoutId) => {
                      setCurrentWorkoutId(workoutId);
                      setHasActiveWorkout(true);
                      setActiveSubScreen(null);
                      handleNavigateToTab('workout');
                    }}
                  />
                </View>
              ) : activeSubScreen === 'analytics' ? (
                <View style={styles.subScreenContainer}>
                  <View style={styles.subScreenHeader}>
                    <TouchableOpacity
                      testID="subscreen-back-btn"
                      style={styles.subScreenBackBtn}
                      onPress={() => setActiveSubScreen(null)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.subScreenBackBtnText}>← Back</Text>
                    </TouchableOpacity>
                    <Text style={styles.subScreenHeaderTitle}>
                      {analyticsGroup === 'body_composition' ? 'Body Composition' : 'Performance Analytics'}
                    </Text>
                    <View style={{ width: 60 }} />
                  </View>
                  <PlotsScreen
                    workoutRepo={repos.workoutRepo}
                    exerciseRepo={repos.exerciseRepo}
                    bodyMetricsRepo={repos.bodyMetricsRepo}
                    userProfileRepo={repos.userProfileRepo}
                    programRepo={repos.programRepo}
                    programBlockService={repos.programBlockService}
                    userSettingsRepo={repos.userSettingsRepo}
                    targetGroup={analyticsGroup}
                    initialChartType={analyticsGroup === 'body_composition' ? 'bodyweight' : 'e1rm'}
                    isInline={false}
                    onNavigateToBodyMetrics={() => setShowBodyMetricsModal(true)}
                  />
                </View>
              ) : (
                <HomeScreen
                  workoutRepo={repos.workoutRepo}
                  exerciseRepo={repos.exerciseRepo}
                  gearRepo={repos.gearRepo}
                  userSettingsRepo={repos.userSettingsRepo}
                  programRepo={repos.programRepo}
                  programBlockService={repos.programBlockService}
                  bodyMetricsRepo={repos.bodyMetricsRepo}
                  userProfileRepo={repos.userProfileRepo}
                  onNavigateToWorkout={() => setActiveTab('workout')}
                  onNavigateToProfile={() => setActiveTab('profile')}
                  onNavigateToCalendar={() => setActiveSubScreen('calendar')}
                  onNavigateToAnalytics={(grp) => {
                    setAnalyticsGroup(grp || 'performance');
                    setActiveSubScreen('analytics');
                  }}
                />
              )}
            </View>
          )}

          {/* TAB 2: WORKOUT (Smart Session Router & Active Logger) */}
          {/* Keep mounted so in-progress session state is never discarded on tab switch */}
          <View
            style={[
              styles.tabContentContainer,
              currentTab === 'workout' ? styles.visibleContent : styles.hiddenContent,
            ]}
          >
            <WorkoutTabRouter
              workoutRepo={repos.workoutRepo}
              exerciseRepo={repos.exerciseRepo}
              gearRepo={repos.gearRepo}
              userSettingsRepo={repos.userSettingsRepo}
              programRepo={repos.programRepo}
              painReportRepo={repos.painReportRepo}
              programBlockService={repos.programBlockService}
              hasActiveWorkout={hasActiveWorkout}
              currentWorkoutId={currentWorkoutId}
              onStartSession={handleStartSession}
              onFinishSession={handleFinishSession}
              onDiscardSession={handleDiscardSession}
              onOpenProgramPlanner={() => setActiveTab('profile')}
            />
          </View>

          {/* TAB 3: PROFILE (Training Psychology & Program Planner) */}
          {currentTab === 'profile' && (
            <View style={[styles.tabContentContainer, styles.visibleContent]}>
              <UserProfileScreen
                userProfileRepo={repos.userProfileRepo}
                programRepo={repos.programRepo}
                programBlockService={repos.programBlockService}
                exerciseRepo={repos.exerciseRepo}
                gearRepo={repos.gearRepo}
                userSettingsRepo={repos.userSettingsRepo}
                bodyMetricsRepo={repos.bodyMetricsRepo}
                onProgramGenerated={(progId) => {
                  checkActiveWorkout();
                  setActiveTab('workout');
                }}
              />
            </View>
          )}

          {/* TAB 4: SETTINGS (Gym Mechanics, Equipment & Utilities) */}
          {currentTab === 'settings' && (
            <View style={[styles.tabContentContainer, styles.visibleContent]}>
              <SettingsScreen
                userSettingsRepo={repos.userSettingsRepo}
                exerciseRepo={repos.exerciseRepo}
                gearRepo={repos.gearRepo}
                workoutRepo={repos.workoutRepo}
                programRepo={repos.programRepo}
                userProfileRepo={repos.userProfileRepo}
                bodyMetricsRepo={repos.bodyMetricsRepo}
                programBlockService={repos.programBlockService}
                db={database}
                onSettingsChange={checkActiveWorkout}
                initialShowImport={settingsInitialShowImport}
                onNavigateToCalendar={() => {
                  setSettingsInitialShowImport(false);
                  handleNavigateToTab('home');
                }}
              />
            </View>
          )}
        </View>

        {/* High-Contrast 4-Hub Bottom Tab Navigation Bar */}
        <View testID="root-bottom-tab-bar" style={styles.bottomTabBar}>
          {/* 1. Home Tab */}
          <TouchableOpacity
            testID="tab-btn-home"
            style={styles.tabButton}
            onPress={() => handleNavigateToTab('home')}
            activeOpacity={0.7}
            accessibilityLabel="Home Tab"
          >
            <View style={styles.iconContainer}>
              <Text
                style={[
                  styles.tabIconText,
                  currentTab === 'home' && styles.tabIconTextActive,
                ]}
              >
                🏠
              </Text>
            </View>
            <Text
              style={[
                styles.tabLabelText,
                currentTab === 'home' && styles.tabLabelTextActive,
              ]}
            >
              Home
            </Text>
          </TouchableOpacity>

          {/* 2. Workout Tab */}
          <TouchableOpacity
            testID="tab-btn-workout"
            style={styles.tabButton}
            onPress={() => handleNavigateToTab('workout')}
            activeOpacity={0.7}
            accessibilityLabel="Workout Tab"
          >
            <View style={styles.iconContainer}>
              <Text
                style={[
                  styles.tabIconText,
                  currentTab === 'workout' && styles.tabIconTextActive,
                ]}
              >
                ⚡
              </Text>
              {hasActiveWorkout && (
                <View testID="active-workout-tab-dot" style={styles.activeWorkoutIndicatorDot} />
              )}
            </View>
            <Text
              style={[
                styles.tabLabelText,
                currentTab === 'workout' && styles.tabLabelTextActive,
              ]}
            >
              Workout
            </Text>
          </TouchableOpacity>

          {/* 3. Profile Tab */}
          <TouchableOpacity
            testID="tab-btn-profile"
            style={styles.tabButton}
            onPress={() => handleNavigateToTab('profile')}
            activeOpacity={0.7}
            accessibilityLabel="Profile Tab"
          >
            <View style={styles.iconContainer}>
              <Text
                style={[
                  styles.tabIconText,
                  currentTab === 'profile' && styles.tabIconTextActive,
                ]}
              >
                👤
              </Text>
            </View>
            <Text
              style={[
                styles.tabLabelText,
                currentTab === 'profile' && styles.tabLabelTextActive,
              ]}
            >
              Profile
            </Text>
          </TouchableOpacity>

          {/* 4. Settings Tab */}
          <TouchableOpacity
            testID="tab-btn-settings"
            style={styles.tabButton}
            onPress={() => handleNavigateToTab('settings')}
            activeOpacity={0.7}
            accessibilityLabel="Settings Tab"
          >
            <View style={styles.iconContainer}>
              <Text
                style={[
                  styles.tabIconText,
                  currentTab === 'settings' && styles.tabIconTextActive,
                ]}
              >
                ⚙️
              </Text>
            </View>
            <Text
              style={[
                styles.tabLabelText,
                currentTab === 'settings' && styles.tabLabelTextActive,
              ]}
            >
              Settings
            </Text>
          </TouchableOpacity>
        </View>

        {/* First-Time User 3-Step Onboarding Wizard */}
        {showOnboarding && repos && (
          <OnboardingWizardModal
            visible={showOnboarding}
            userSettingsRepo={repos.userSettingsRepo}
            userProfileRepo={repos.userProfileRepo}
            programRepo={repos.programRepo}
            programBlockService={repos.programBlockService}
            exerciseRepo={repos.exerciseRepo}
            onComplete={() => setShowOnboarding(false)}
            onNavigateToImport={() => {
              setShowOnboarding(false);
              setSettingsInitialShowImport(true);
              handleNavigateToTab('settings');
            }}
          />
        )}

        {/* Body Metrics Logging Full-Screen Modal */}
        {repos && repos.bodyMetricsRepo && (
          <Modal
            visible={showBodyMetricsModal}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setShowBodyMetricsModal(false)}
          >
            <BodyMetricsScreen
              bodyMetricsRepo={repos.bodyMetricsRepo}
              userProfileRepo={repos.userProfileRepo}
              userSettingsRepo={repos.userSettingsRepo}
              onClose={() => setShowBodyMetricsModal(false)}
            />
          </Modal>
        )}
        </SafeAreaView>
      </RepositoryProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FAFAFA',
    marginTop: 16,
    letterSpacing: 0.5,
  },
  loadingSubtext: {
    fontSize: 13,
    color: '#A1A1AA',
    marginTop: 6,
  },
  bodyContainer: {
    flex: 1,
  },
  tabContentContainer: {
    flex: 1,
  },
  visibleContent: {
    display: 'flex',
  },
  hiddenContent: {
    display: 'none',
  },
  bottomTabBar: {
    flexDirection: 'row',
    backgroundColor: '#09090B',
    borderTopWidth: 1,
    borderTopColor: '#27272A',
    paddingVertical: 8,
    paddingHorizontal: 16,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  iconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    height: 24,
  },
  tabIconText: {
    fontSize: 18,
    color: '#71717A',
  },
  tabIconTextActive: {
    color: '#00E676',
  },
  activeWorkoutIndicatorDot: {
    position: 'absolute',
    top: -2,
    right: -6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E676',
    borderWidth: 1.5,
    borderColor: '#09090B',
  },
  tabLabelText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#71717A',
    marginTop: 3,
  },
  tabLabelTextActive: {
    color: '#00E676',
    fontWeight: '800',
  },
  subScreenContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  subScreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#09090B',
    borderBottomWidth: 1,
    borderBottomColor: '#27272A',
  },
  subScreenBackBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  subScreenBackBtnText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '800',
  },
  subScreenHeaderTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
