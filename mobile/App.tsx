/**
 * Workout Suite — Mobile Application Entry & Root Navigation
 *
 * Implements Step 1.6: Bottom Tab Navigation (Logger, Calendar, Settings)
 * Implements ADR-001: Local-First Architecture with SQLite
 * Implements ADR-010: Write-Through Crash Recovery for Active Sessions
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
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
} from './src/database';
import { ProgramBlockService } from './src/services/programBlockService';
import { ActiveLoggerScreen } from './src/features/logger';
import { CalendarScreen } from './src/features/calendar';
import { SettingsScreen } from './src/features/settings';
import { Workout } from './src/core/types';

export type RootTab = 'logger' | 'calendar' | 'settings';

export interface AppProps {
  initialTab?: RootTab;
  initialWorkoutId?: string;
  workoutRepo?: IWorkoutRepository;
  exerciseRepo?: IExerciseRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  programRepo?: IProgramRepository;
  userProfileRepo?: IUserProfileRepository;
  programBlockService?: ProgramBlockService;
  db?: ISQLiteDatabase;
  [key: string]: unknown;
}

export default function App({
  initialTab = 'logger',
  initialWorkoutId,
  workoutRepo: propWorkoutRepo,
  exerciseRepo: propExerciseRepo,
  gearRepo: propGearRepo,
  userSettingsRepo: propUserSettingsRepo,
  programRepo: propProgramRepo,
  userProfileRepo: propUserProfileRepo,
  programBlockService: propProgramBlockService,
  db: propDb,
}: AppProps = {}) {
  const [activeTab, setActiveTab] = useState<RootTab>(initialTab);
  const [dbReady, setDbReady] = useState<boolean>(!!propWorkoutRepo);
  const [hasActiveWorkout, setHasActiveWorkout] = useState<boolean>(false);
  const [database, setDatabase] = useState<ISQLiteDatabase | undefined>(propDb);

  const [currentWorkoutId, setCurrentWorkoutId] = useState<string | undefined>(
    initialWorkoutId
  );

  // Concrete repositories (fallback to SQLite if props omitted)
  const [repos, setRepos] = useState<{
    workoutRepo: IWorkoutRepository;
    exerciseRepo: IExerciseRepository;
    gearRepo: IGearRepository;
    userSettingsRepo: IUserSettingsRepository;
    programRepo: IProgramRepository;
    userProfileRepo: IUserProfileRepository;
    programBlockService: ProgramBlockService;
  } | null>(() => {
    if (propWorkoutRepo && propExerciseRepo && propUserSettingsRepo) {
      const pRepo = propProgramRepo || ({} as IProgramRepository);
      const upRepo = propUserProfileRepo || ({} as IUserProfileRepository);
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
        const pbService = new ProgramBlockService(pRepo);

        setRepos({
          workoutRepo: wRepo,
          exerciseRepo: eRepo,
          gearRepo: gRepo,
          userSettingsRepo: uRepo,
          programRepo: pRepo,
          userProfileRepo: upRepo,
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

  // Handle starting a workout from Calendar
  const handleStartWorkoutFromCalendar = (dateIso?: string) => {
    setActiveTab('logger');
  };

  // Handle session finished in logger -> switch to calendar to view it
  const handleFinishSession = (completedWorkout: Workout) => {
    setHasActiveWorkout(false);
    setCurrentWorkoutId(undefined);
    setActiveTab('calendar');
  };

  const handleDiscardSession = () => {
    setHasActiveWorkout(false);
    setCurrentWorkoutId(undefined);
    setActiveTab('calendar');
  };

  if (!dbReady || !repos) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.loadingScreen} edges={['top', 'bottom', 'left', 'right']}>
          <StatusBar style="light" />
          <ActivityIndicator size="large" color="#00E676" />
          <Text style={styles.loadingTitle}>MomentRM</Text>
          <Text style={styles.loadingSubtext}>
            Initializing offline SQLite storage...
          </Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.rootContainer} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style="light" />

      {/* Screen Body Container */}
      <View style={styles.bodyContainer}>
        {/* We keep Logger rendered so in-progress session state is not lost on tab switch */}
        <View
          style={[
            styles.tabContentContainer,
            activeTab === 'logger' ? styles.visibleContent : styles.hiddenContent,
          ]}
        >
          <ActiveLoggerScreen
            initialWorkoutId={currentWorkoutId}
            workoutRepo={repos.workoutRepo}
            exerciseRepo={repos.exerciseRepo}
            gearRepo={repos.gearRepo}
            userSettingsRepo={repos.userSettingsRepo}
            programRepo={repos.programRepo}
            onFinishSession={handleFinishSession}
            onDiscardSession={handleDiscardSession}
          />
        </View>

        {activeTab === 'calendar' && (
          <View style={[styles.tabContentContainer, styles.visibleContent]}>
            <CalendarScreen
              workoutRepo={repos.workoutRepo}
              exerciseRepo={repos.exerciseRepo}
              gearRepo={repos.gearRepo}
              userSettingsRepo={repos.userSettingsRepo}
              programBlockService={repos.programBlockService}
              onStartWorkout={handleStartWorkoutFromCalendar}
            />
          </View>
        )}

        {activeTab === 'settings' && (
          <View style={[styles.tabContentContainer, styles.visibleContent]}>
            <SettingsScreen
              userSettingsRepo={repos.userSettingsRepo}
              exerciseRepo={repos.exerciseRepo}
              gearRepo={repos.gearRepo}
              workoutRepo={repos.workoutRepo}
              programRepo={repos.programRepo}
              userProfileRepo={repos.userProfileRepo}
              programBlockService={repos.programBlockService}
              db={database}
              onSettingsChange={checkActiveWorkout}
            />
          </View>
        )}
      </View>

      {/* High-Contrast Bottom Tab Navigation Bar */}
      <View style={styles.bottomTabBar}>
        {/* Logger Tab */}
        <TouchableOpacity
          style={styles.tabButton}
          onPress={() => setActiveTab('logger')}
          activeOpacity={0.7}
          accessibilityLabel="Active Logger Tab"
        >
          <View style={styles.iconContainer}>
            <Text
              style={[
                styles.tabIconText,
                activeTab === 'logger' && styles.tabIconTextActive,
              ]}
            >
              ⚡
            </Text>
            {hasActiveWorkout && <View style={styles.activeWorkoutIndicatorDot} />}
          </View>
          <Text
            style={[
              styles.tabLabelText,
              activeTab === 'logger' && styles.tabLabelTextActive,
            ]}
          >
            Logger
          </Text>
        </TouchableOpacity>

        {/* Calendar Tab */}
        <TouchableOpacity
          style={styles.tabButton}
          onPress={() => setActiveTab('calendar')}
          activeOpacity={0.7}
          accessibilityLabel="Calendar Tab"
        >
          <View style={styles.iconContainer}>
            <Text
              style={[
                styles.tabIconText,
                activeTab === 'calendar' && styles.tabIconTextActive,
              ]}
            >
              📅
            </Text>
          </View>
          <Text
            style={[
              styles.tabLabelText,
              activeTab === 'calendar' && styles.tabLabelTextActive,
            ]}
          >
            Calendar
          </Text>
        </TouchableOpacity>

        {/* Settings Tab */}
        <TouchableOpacity
          style={styles.tabButton}
          onPress={() => setActiveTab('settings')}
          activeOpacity={0.7}
          accessibilityLabel="Settings Tab"
        >
          <View style={styles.iconContainer}>
            <Text
              style={[
                styles.tabIconText,
                activeTab === 'settings' && styles.tabIconTextActive,
              ]}
            >
              ⚙️
            </Text>
          </View>
          <Text
            style={[
              styles.tabLabelText,
              activeTab === 'settings' && styles.tabLabelTextActive,
            ]}
          >
            Settings
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
    fontSize: 11,
    fontWeight: '700',
    color: '#71717A',
    marginTop: 3,
  },
  tabLabelTextActive: {
    color: '#00E676',
    fontWeight: '800',
  },
});
