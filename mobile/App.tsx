import { BottomTabBar } from './src/ui/BottomTabBar';
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
  IExercisePreferenceRepository,
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
  SQLiteExercisePreferenceRepository,
} from './src/database';
import { ProgramBlockService } from './src/services/programBlockService';
import { ExercisePreferenceService } from './src/services/exercisePreferenceService';
import { CalibratedParamService } from './src/services/calibratedParamService';
import { removeDiscardedWorkouts } from './src/services/workoutDiscardService';
import { WorkoutTabRouter } from './src/features/logger';
import { HomeScreen } from './src/features/home';
import { CalendarScreen } from './src/features/calendar';
import { PlotsScreen } from './src/features/plots';
import { BodyMetricsScreen } from './src/features/bodyMetrics';
import { UserProfileScreen } from './src/features/profile';
import { ProgramOverviewScreen } from './src/features/progression/ProgramOverviewScreen';
import { SettingsScreen } from './src/features/settings';
import { OnboardingWizardModal } from './src/features/onboarding';
import { Workout } from './src/core/types';
import { RepositoryProvider, Repositories } from './src/context/RepositoryContext';

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
  exercisePreferenceRepo?: IExercisePreferenceRepository;
  exercisePreferenceService?: ExercisePreferenceService;
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
  exercisePreferenceRepo: propExercisePreferenceRepo,
  exercisePreferenceService: propExercisePreferenceService,
  programBlockService: propProgramBlockService,
  db: propDb,
}: AppProps = {}) {
  const [activeTab, setActiveTab] = useState<RootTab>(initialTab);
  const [activeSubScreen, setActiveSubScreen] = useState<'calendar' | 'analytics' | null>(
    initialTab === 'calendar' ? 'calendar' : null
  );
  const [analyticsGroup, setAnalyticsGroup] = useState<'performance' | 'body_composition'>('performance');
  const [showBodyMetricsModal, setShowBodyMetricsModal] = useState<boolean>(false);
  const [showPrograms, setShowPrograms] = useState(false);
  const [showProgramSetup, setShowProgramSetup] = useState(false);
  const [programRevision, setProgramRevision] = useState(0);
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
  const [repos, setRepos] = useState<Repositories | null>(() => {
    if (propWorkoutRepo && propExerciseRepo && propUserSettingsRepo) {
      const pRepo = propProgramRepo || ({} as IProgramRepository);
      const upRepo = propUserProfileRepo || ({} as IUserProfileRepository);
      const bmRepo = propBodyMetricsRepo || ({} as IBodyMetricsRepository);
      const painRepo = propPainReportRepo || ({} as IPainReportRepository);
      const prefRepo = propExercisePreferenceRepo;
      const prefService =
        propExercisePreferenceService ||
        (prefRepo ? new ExercisePreferenceService(prefRepo) : undefined);
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
        exercisePreferenceRepo: prefRepo,
        exercisePreferenceService: prefService,
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
        const prefRepo = new SQLiteExercisePreferenceRepository(db);
        const prefService = new ExercisePreferenceService(prefRepo);
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
          exercisePreferenceRepo: prefRepo,
          exercisePreferenceService: prefService,
          programBlockService: pbService,
          calibratedParamService: new CalibratedParamService(db),
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

  // Older versions retained discarded sessions. Remove them once repositories are ready.
  useEffect(() => {
    if (!repos || !dbReady) return;
    removeDiscardedWorkouts(repos.workoutRepo, repos.userSettingsRepo)
      .catch(error => console.warn('Could not remove discarded workouts:', error));
  }, [repos, dbReady]);

  // Periodic or event-driven check for active in-progress workout
  const checkActiveWorkout = useCallback(async () => {
    if (!repos?.workoutRepo) return;
    try {
      const inProgress = await repos.workoutRepo.getInProgressWorkout();
      setHasActiveWorkout(!!inProgress);
      if (inProgress) {
        setCurrentWorkoutId(inProgress.id);
      } else {
        setCurrentWorkoutId(undefined);
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
                  <CalendarScreen
                      onClose={() => setActiveSubScreen(null)}
                    workoutRepo={repos.workoutRepo}
                    exerciseRepo={repos.exerciseRepo}
                    gearRepo={repos.gearRepo}
                    userSettingsRepo={repos.userSettingsRepo}
                    programBlockService={repos.programBlockService}
                    onStartWorkout={(dateIso) => {
                      setActiveSubScreen(null);
                      handleNavigateToTab('workout');
                    }}
                    onSelectWorkout={handleStartSession}
                  />
                </View>
              ) : activeSubScreen === 'analytics' ? (
                <View style={styles.subScreenContainer}>
                  <PlotsScreen
                        onClose={() => setActiveSubScreen(null)}
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
                  key={`home-${programRevision}`}
                  onNavigateToWorkout={() => handleNavigateToTab('workout')}
                  onNavigateToProfile={() => handleNavigateToTab('profile')}
                  onNavigateToPrograms={() => { handleNavigateToTab('workout'); setShowPrograms(true); }}
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
              exercisePreferenceRepo={repos.exercisePreferenceRepo}
              exercisePreferenceService={repos.exercisePreferenceService}
              programBlockService={repos.programBlockService}
              hasActiveWorkout={hasActiveWorkout}
              currentWorkoutId={currentWorkoutId}
              isActiveTab={currentTab === 'workout'}
              programRevision={programRevision}
              onStartSession={handleStartSession}
              onFinishSession={handleFinishSession}
              onDiscardSession={handleDiscardSession}
              onOpenProgramPlanner={() => setShowPrograms(true)}
            />
          </View>

          {/* TAB 3: PROFILE (Performance Records & Athlete Setup) */}
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
                workoutRepo={repos.workoutRepo}
                painReportRepo={repos.painReportRepo}
                onOpenProgramOverview={() => { handleNavigateToTab('workout'); setShowPrograms(true); }}
                onProgramGenerated={(progId) => {
                  checkActiveWorkout();
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

          <BottomTabBar currentTab={currentTab} hasActiveWorkout={hasActiveWorkout} onSelect={handleNavigateToTab} />

        {/* Workout program management and focused generation/evolution setup */}
        {showPrograms && <Modal visible animationType="slide" onRequestClose={() => { setShowPrograms(false); setProgramRevision(n => n + 1); }}>
          <SafeAreaView style={styles.rootContainer}>
              <ProgramOverviewScreen onOpenSetup={() => { setShowPrograms(false); setShowProgramSetup(true); }} programRepo={repos.programRepo} programBlockService={repos.programBlockService} exerciseRepo={repos.exerciseRepo} gearRepo={repos.gearRepo} onClose={() => { setShowPrograms(false); setProgramRevision(n => n + 1); }} />
          </SafeAreaView>
        </Modal>}
        {showProgramSetup && <Modal visible animationType="slide" onRequestClose={() => { setShowProgramSetup(false); setShowPrograms(true); }}>
          <SafeAreaView style={styles.rootContainer}>
            <UserProfileScreen userProfileRepo={repos.userProfileRepo} programRepo={repos.programRepo} programBlockService={repos.programBlockService} exerciseRepo={repos.exerciseRepo} gearRepo={repos.gearRepo} userSettingsRepo={repos.userSettingsRepo} bodyMetricsRepo={repos.bodyMetricsRepo} workoutRepo={repos.workoutRepo} painReportRepo={repos.painReportRepo} initialEditor="programs" onClose={() => { setShowProgramSetup(false); setShowPrograms(true); setProgramRevision(n => n + 1); }} />
          </SafeAreaView>
        </Modal>}

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
  subScreenContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
