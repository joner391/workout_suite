import { ScreenHeader } from '../../ui/ScreenHeader';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — CalendarScreen
 *
 * Implements Step 1.6: Calendar View, Completed Workout Badges & Agenda
 *
 * Features:
 * - Monthly 7-column calendar grid and weekly agenda view.
 * - Completed workout badges / indicator dots on days with logged training.
 * - Drill-down inspection of past sessions via SessionDetailModal.
 * - Day agenda list with duration, volume, set count, and quick stats.
 * - 1-tap navigation to start a new workout session for any date.
 * - High-contrast OLED dark styling matching ActiveLoggerScreen (ADR-024).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {
  Workout,
  WorkoutSet,
  WeightUnit,
  IntensityMetric,
} from '../../core/types';
import { IWorkoutRepository } from '../../domain/repositories/IWorkoutRepository';
import { IExerciseRepository } from '../../domain/repositories/IExerciseRepository';
import { IGearRepository } from '../../domain/repositories/IGearRepository';
import { IUserSettingsRepository } from '../../domain/repositories/IUserSettingsRepository';
import { SessionDetailModal, formatDuration } from './SessionDetailModal';
import { formatWeight } from '../../core/math/unitConversion';
import {
  ProgramBlockService,
  ProgramBlockWithProgram,
} from '../../services/programBlockService';

export type CalendarViewMode = 'month' | 'week';

/** Re-read the session so stale calendar cards cannot reopen deleted/discarded work. */
export async function openCalendarWorkout(
  repo: IWorkoutRepository,
  workoutId: string,
  onInspect: (id: string) => void,
  onResume?: (id: string) => void,
): Promise<boolean> {
  const workout = await repo.findById(workoutId);
  if (!workout || (workout.status !== 'completed' && workout.status !== 'in_progress')) return false;
  if (workout.status === 'in_progress' && onResume) onResume(workout.id);
  else onInspect(workout.id);
  return true;
}

export interface CalendarScreenProps {
  workoutRepo: IWorkoutRepository;
  exerciseRepo: IExerciseRepository;
  gearRepo?: IGearRepository;
  userSettingsRepo?: IUserSettingsRepository;
  programBlockService?: ProgramBlockService;
  onStartWorkout?: (dateIso?: string) => void;
  onSelectWorkout?: (workoutId: string) => void;
  initialExpanded?: boolean;
  onClose?: () => void;
}

export interface CalendarDayItem {
  dateIso: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  workoutCount: number;
  hasCompletedWorkout: boolean;
  hasInProgressWorkout: boolean;
  programSwap?: ProgramBlockWithProgram;
}

// ============================================================================
// Pure Date Helper Functions
// ============================================================================

export function padZero(num: number): string {
  return num < 10 ? `0${num}` : `${num}`;
}

export function toIsoDate(year: number, monthZeroIndexed: number, day: number): string {
  return `${year}-${padZero(monthZeroIndexed + 1)}-${padZero(day)}`;
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const parts = iso.split('-').map(Number);
  return {
    year: parts[0] || new Date().getFullYear(),
    month: (parts[1] || 1) - 1,
    day: parts[2] || 1,
  };
}

export function getTodayIso(): string {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Computes calendar grid days for a given year and month (Monday-start).
 */
export function buildMonthGrid(
  year: number,
  monthZeroIndexed: number,
  workoutsByDate: Record<string, Workout[]>,
  programSwapsByDate?: Record<string, ProgramBlockWithProgram>
): CalendarDayItem[] {
  const todayIso = getTodayIso();
  const daysInMonth = new Date(year, monthZeroIndexed + 1, 0).getDate();

  // Day of week for 1st of month: 0=Mon, 6=Sun
  const firstDay = new Date(year, monthZeroIndexed, 1).getDay();
  const startOffset = (firstDay + 6) % 7;

  // Previous month spillover
  const prevMonthDays = new Date(year, monthZeroIndexed, 0).getDate();
  const prevYear = monthZeroIndexed === 0 ? year - 1 : year;
  const prevMonth = monthZeroIndexed === 0 ? 11 : monthZeroIndexed - 1;

  const items: CalendarDayItem[] = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const dateIso = toIsoDate(prevYear, prevMonth, dayNum);
    const wList = workoutsByDate[dateIso] || [];
    items.push({
      dateIso,
      dayNumber: dayNum,
      isCurrentMonth: false,
      isToday: dateIso === todayIso,
      workoutCount: wList.length,
      hasCompletedWorkout: wList.some((w) => w.status === 'completed'),
      hasInProgressWorkout: wList.some((w) => w.status === 'in_progress'),
      programSwap: programSwapsByDate ? programSwapsByDate[dateIso] : undefined,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateIso = toIsoDate(year, monthZeroIndexed, d);
    const wList = workoutsByDate[dateIso] || [];
    items.push({
      dateIso,
      dayNumber: d,
      isCurrentMonth: true,
      isToday: dateIso === todayIso,
      workoutCount: wList.length,
      hasCompletedWorkout: wList.some((w) => w.status === 'completed'),
      hasInProgressWorkout: wList.some((w) => w.status === 'in_progress'),
      programSwap: programSwapsByDate ? programSwapsByDate[dateIso] : undefined,
    });
  }

  // Next month spillover to round up to full 7-column rows
  const remainingCells = (7 - (items.length % 7)) % 7;
  const nextYear = monthZeroIndexed === 11 ? year + 1 : year;
  const nextMonth = monthZeroIndexed === 11 ? 0 : monthZeroIndexed + 1;

  for (let d = 1; d <= remainingCells; d++) {
    const dateIso = toIsoDate(nextYear, nextMonth, d);
    const wList = workoutsByDate[dateIso] || [];
    items.push({
      dateIso,
      dayNumber: d,
      isCurrentMonth: false,
      isToday: dateIso === todayIso,
      workoutCount: wList.length,
      hasCompletedWorkout: wList.some((w) => w.status === 'completed'),
      hasInProgressWorkout: wList.some((w) => w.status === 'in_progress'),
      programSwap: programSwapsByDate ? programSwapsByDate[dateIso] : undefined,
    });
  }

  return items;
}

/**
 * Computes 7 days of the week containing dateIso (Monday-start).
 */
export function buildWeekDays(
  dateIso: string,
  workoutsByDate: Record<string, Workout[]>,
  programSwapsByDate?: Record<string, ProgramBlockWithProgram>
): CalendarDayItem[] {
  const todayIso = getTodayIso();
  const { year, month, day } = parseIsoDate(dateIso);
  const targetDate = new Date(year, month, day);

  const dayOfWeek = (targetDate.getDay() + 6) % 7; // 0=Mon, 6=Sun
  const monday = new Date(year, month, day - dayOfWeek);

  const items: CalendarDayItem[] = [];

  for (let i = 0; i < 7; i++) {
    const current = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const currentIso = toIsoDate(current.getFullYear(), current.getMonth(), current.getDate());
    const wList = workoutsByDate[currentIso] || [];

    items.push({
      dateIso: currentIso,
      dayNumber: current.getDate(),
      isCurrentMonth: current.getMonth() === month,
      isToday: currentIso === todayIso,
      workoutCount: wList.length,
      hasCompletedWorkout: wList.some((w) => w.status === 'completed'),
      hasInProgressWorkout: wList.some((w) => w.status === 'in_progress'),
      programSwap: programSwapsByDate ? programSwapsByDate[currentIso] : undefined,
    });
  }

  return items;
}

export function formatFriendlyDate(dateIso: string): string {
  try {
    const { year, month, day } = parseIsoDate(dateIso);
    const d = new Date(year, month, day);
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateIso;
  }
}

// ============================================================================
// Component
// ============================================================================

export const CalendarScreen: React.FC<CalendarScreenProps> = ({
  workoutRepo,
  exerciseRepo,
  gearRepo,
  userSettingsRepo,
  programBlockService,
  onStartWorkout,
  onSelectWorkout,
  initialExpanded = false,
  onClose,
}) => {
  const todayIso = useMemo(() => getTodayIso(), []);
  const initialParsed = useMemo(() => parseIsoDate(todayIso), [todayIso]);

  const [currentYear, setCurrentYear] = useState<number>(initialParsed.year);
  const [currentMonth, setCurrentMonth] = useState<number>(initialParsed.month);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [isExpanded, setIsExpanded] = useState<boolean>(initialExpanded);
  const viewMode: CalendarViewMode = isExpanded ? 'month' : 'week';

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [programBlocks, setProgramBlocks] = useState<ProgramBlockWithProgram[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [inspectWorkoutId, setInspectWorkoutId] = useState<string | null>(null);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [intensityMetric, setIntensityMetric] = useState<IntensityMetric>('RPE');

  // Load user unit and intensity preferences
  useEffect(() => {
    if (userSettingsRepo) {
      Promise.all([
        userSettingsRepo.getUnitSystem(),
        userSettingsRepo.getIntensityMetric(),
      ])
        .then(([u, i]) => {
          if (u) setUnitSystem(u);
          if (i) setIntensityMetric(i);
        })
        .catch(() => {});
    }
  }, [userSettingsRepo]);

  // Load workouts from repository
  const loadWorkouts = useCallback(async () => {
    try {
      setLoading(true);
      const allWorkouts = await workoutRepo.findAll();
      setWorkouts(allWorkouts.filter(w => w.status === 'completed' || w.status === 'in_progress'));
    } catch {
      // Fallback empty
    } finally {
      setLoading(false);
    }
  }, [workoutRepo]);

  useEffect(() => {
    loadWorkouts();
  }, [loadWorkouts]);

  // Load program blocks for meso-cycle badges and chart shading
  const loadProgramBlocks = useCallback(async () => {
    if (programBlockService) {
      try {
        const blocks = await programBlockService.getAllProgramBlocks();
        setProgramBlocks(blocks);
      } catch {
        // Fallback
      }
    }
  }, [programBlockService]);

  useEffect(() => {
    loadProgramBlocks();
  }, [loadProgramBlocks]);

  // Index program swaps by start_date
  const programSwapsByDate = useMemo(() => {
    const map: Record<string, ProgramBlockWithProgram> = {};
    programBlocks.forEach((b) => {
      map[b.start_date] = b;
    });
    return map;
  }, [programBlocks]);

  // Resolve active program block for selected date
  const selectedDateProgramBlock = useMemo(() => {
    if (!programBlocks.length) return null;
    const match = programBlocks.filter(
      (b) => b.start_date <= selectedDate && (b.end_date === null || b.end_date >= selectedDate)
    );
    if (match.length === 0) return null;
    match.sort((a, b) => b.start_date.localeCompare(a.start_date));
    return match[0];
  }, [programBlocks, selectedDate]);

  // Index workouts by ISO date string
  const workoutsByDate = useMemo(() => {
    const map: Record<string, Workout[]> = {};
    workouts.forEach((w) => {
      if (!map[w.date]) {
        map[w.date] = [];
      }
      map[w.date].push(w);
    });
    return map;
  }, [workouts]);

  // Grid days
  const monthDays = useMemo(() => {
    return buildMonthGrid(currentYear, currentMonth, workoutsByDate, programSwapsByDate);
  }, [currentYear, currentMonth, workoutsByDate, programSwapsByDate]);

  const weekDays = useMemo(() => {
    return buildWeekDays(selectedDate, workoutsByDate, programSwapsByDate);
  }, [selectedDate, workoutsByDate, programSwapsByDate]);

  // Workouts on currently selected date
  const selectedDateWorkouts = useMemo(() => {
    return workoutsByDate[selectedDate] || [];
  }, [workoutsByDate, selectedDate]);

  // Month navigation
  const handlePrevMonth = () => {
    let newYear = currentYear;
    let newMonth = currentMonth - 1;
    if (newMonth < 0) {
      newMonth = 11;
      newYear -= 1;
    }
    setCurrentMonth(newMonth);
    setCurrentYear(newYear);
    setSelectedDate(toIsoDate(newYear, newMonth, 1));
  };

  const handleNextMonth = () => {
    let newYear = currentYear;
    let newMonth = currentMonth + 1;
    if (newMonth > 11) {
      newMonth = 0;
      newYear += 1;
    }
    setCurrentMonth(newMonth);
    setCurrentYear(newYear);
    setSelectedDate(toIsoDate(newYear, newMonth, 1));
  };

  const handleJumpToToday = () => {
    const now = parseIsoDate(todayIso);
    setCurrentYear(now.year);
    setCurrentMonth(now.month);
    setSelectedDate(todayIso);
  };

  // Week navigation
  const handlePrevWeek = () => {
    const { year, month, day } = parseIsoDate(selectedDate);
    const prev = new Date(year, month, day - 7);
    const newIso = toIsoDate(prev.getFullYear(), prev.getMonth(), prev.getDate());
    setSelectedDate(newIso);
    setCurrentYear(prev.getFullYear());
    setCurrentMonth(prev.getMonth());
  };

  const handleNextWeek = () => {
    const { year, month, day } = parseIsoDate(selectedDate);
    const next = new Date(year, month, day + 7);
    const newIso = toIsoDate(next.getFullYear(), next.getMonth(), next.getDate());
    setSelectedDate(newIso);
    setCurrentYear(next.getFullYear());
    setCurrentMonth(next.getMonth());
  };

  const handleWorkoutPress = async (workoutId: string) => {
    const opened = await openCalendarWorkout(workoutRepo, workoutId, setInspectWorkoutId, onSelectWorkout);
    if (!opened) await loadWorkouts();
  };

  return (
    <View style={styles.container}>
      {/* Top Header Bar */}
      <ScreenHeader
        title="Training calendar"
        subtitle={`${MONTH_NAMES[currentMonth]} ${currentYear}`}
        onClose={onClose}
        closeTestID="subscreen-back-btn"
        actions={<View style={styles.viewModeToggle}>
          {(['week', 'month'] as const).map(mode => <TouchableOpacity
            key={mode}
            accessibilityRole="button"
            accessibilityLabel={mode === 'week' ? 'Week View Mode' : 'Month View Mode'}
            accessibilityState={{ selected: viewMode === mode }}
            style={[styles.modeButton, viewMode === mode && styles.modeButtonActive]}
            onPress={() => setIsExpanded(mode === 'month')}
          >
            <Text style={[styles.modeButtonText, viewMode === mode && styles.modeButtonTextActive]}>{mode === 'week' ? 'Week' : 'Month'}</Text>
          </TouchableOpacity>)}
        </View>}
      />

      <ScrollView testID="calendar-scroll-view" style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Navigation Controls Bar */}
        <View style={styles.navBar}>
          <TouchableOpacity
            style={styles.navArrowButton}
            onPress={viewMode === 'month' ? handlePrevMonth : handlePrevWeek}
            accessibilityLabel="Previous Period"
          >
            <Text style={styles.navArrowText}>‹</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.todayButton}
            onPress={handleJumpToToday}
            accessibilityLabel="Jump to Today"
          >
            <Text style={styles.todayButtonText}>Today</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navArrowButton}
            onPress={viewMode === 'month' ? handleNextMonth : handleNextWeek}
            accessibilityLabel="Next Period"
          >
            <Text style={styles.navArrowText}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Weekday Column Headers */}
        <View style={styles.weekdaysHeader}>
          {WEEKDAY_LABELS.map((label) => (
            <Text key={label} style={styles.weekdayLabel}>
              {label}
            </Text>
          ))}
        </View>

        {/* Calendar Grid / Week View */}
        {viewMode === 'month' ? (
          <View style={styles.monthGrid}>
            {monthDays.map((item) => {
              const isSelected = item.dateIso === selectedDate;

              return (
                <TouchableOpacity
                  key={item.dateIso}
                  style={[
                    styles.dayCell,
                    !item.isCurrentMonth && styles.dayCellDimmed,
                    isSelected && styles.dayCellSelected,
                    item.isToday && !isSelected && styles.dayCellToday,
                  ]}
                  onPress={() => setSelectedDate(item.dateIso)}
                  activeOpacity={0.7}
                  accessibilityLabel={`Date ${item.dateIso}`}
                >
                  <Text
                    style={[
                      styles.dayNumberText,
                      !item.isCurrentMonth && styles.dayNumberDimmed,
                      isSelected && styles.dayNumberSelected,
                      item.isToday && !isSelected && styles.dayNumberToday,
                    ]}
                  >
                    {item.dayNumber}
                  </Text>

                  {/* Workout Badge Indicator */}
                  <View style={styles.badgeIndicatorContainer}>
                    {item.hasCompletedWorkout ? (
                      <View style={styles.badgeDotCompleted} />
                    ) : item.hasInProgressWorkout ? (
                      <View style={styles.badgeDotInProgress} />
                    ) : (
                      <View style={styles.badgeDotPlaceholder} />
                    )}
                    {item.programSwap && (
                      <View
                        testID={`program-swap-badge-${item.dateIso}`}
                        style={[
                          styles.programSwapDot,
                          { backgroundColor: item.programSwap.color_hex },
                        ]}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          /* Week View Bar */
          <View style={styles.weekContainer}>
            {weekDays.map((item, idx) => {
              const isSelected = item.dateIso === selectedDate;
              const weekdayName = WEEKDAY_LABELS[idx];

              return (
                <TouchableOpacity
                  key={item.dateIso}
                  style={[
                    styles.weekDayPill,
                    isSelected && styles.weekDayPillSelected,
                    item.isToday && !isSelected && styles.weekDayPillToday,
                  ]}
                  onPress={() => setSelectedDate(item.dateIso)}
                  activeOpacity={0.7}
                  accessibilityLabel={`Date ${item.dateIso}`}
                >
                  <Text
                    style={[
                      styles.weekDayPillLabel,
                      isSelected && styles.weekDayPillTextSelected,
                    ]}
                  >
                    {weekdayName}
                  </Text>
                  <Text
                    style={[
                      styles.weekDayPillNumber,
                      isSelected && styles.weekDayPillTextSelected,
                      item.isToday && !isSelected && styles.dayNumberToday,
                    ]}
                  >
                    {item.dayNumber}
                  </Text>

                  <View style={styles.badgeIndicatorContainer}>
                    {item.hasCompletedWorkout ? (
                      <View style={styles.badgeDotCompleted} />
                    ) : item.hasInProgressWorkout ? (
                      <View style={styles.badgeDotInProgress} />
                    ) : (
                      <View style={styles.badgeDotPlaceholder} />
                    )}
                    {item.programSwap && (
                      <View
                        testID={`program-swap-badge-${item.dateIso}`}
                        style={[
                          styles.programSwapDot,
                          { backgroundColor: item.programSwap.color_hex },
                        ]}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Accordion Expand / Collapse Handle */}
        <TouchableOpacity
          testID="calendar-accordion-handle"
          style={styles.accordionHandleBar}
          onPress={() => setIsExpanded((prev) => !prev)}
          activeOpacity={0.7}
          accessibilityLabel={isExpanded ? 'Collapse to Week View' : 'Expand to Month View'}
        >
          <View style={styles.accordionHandleIndicator} />
          <Text style={styles.accordionHandleText}>
            {isExpanded ? '▲ Collapse to Week' : '▼ Expand to Month'}
          </Text>
        </TouchableOpacity>

        {/* Meso-Cycle / Program Swap Banner for Selected Date */}
        {selectedDateProgramBlock && (
          <View
            testID="calendar-program-swap-banner"
            style={[
              styles.agendaProgramCard,
              { borderLeftColor: selectedDateProgramBlock.color_hex },
            ]}
          >
            <View style={styles.agendaProgramHeader}>
              <View
                style={[
                  styles.agendaProgramPill,
                  { backgroundColor: selectedDateProgramBlock.color_hex },
                ]}
              >
                <Text style={styles.agendaProgramPillText}>
                  {selectedDateProgramBlock.start_date === selectedDate
                    ? '🔄 MESO-CYCLE SWAP'
                    : 'ACTIVE PROGRAM'}
                </Text>
              </View>
              <Text style={styles.agendaProgramName} numberOfLines={1}>
                {selectedDateProgramBlock.program_name}
              </Text>
            </View>
          </View>
        )}

        {/* Selected Date Agenda Header */}
        <View style={styles.agendaHeaderRow}>
          <View>
            <Text style={styles.agendaDateTitle}>
              {formatFriendlyDate(selectedDate)}
            </Text>
            <Text style={styles.agendaDateSubtitle}>
              {selectedDateWorkouts.length === 0
                ? 'No workouts logged'
                : `${selectedDateWorkouts.length} workout${selectedDateWorkouts.length > 1 ? 's' : ''
                } recorded`}
            </Text>
          </View>

          {onStartWorkout && (
            <TouchableOpacity
              style={styles.addWorkoutButton}
              onPress={() => onStartWorkout(selectedDate)}
              accessibilityLabel="Start Workout for Date"
            >
              <Text style={styles.addWorkoutButtonText}>+ New Session</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Workouts List for Selected Date */}
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={uiColors.accent} size="small" />
          </View>
        ) : selectedDateWorkouts.length === 0 ? (
          <View testID="calendar-empty-day-card" style={styles.emptyDayCard}>
            <Text style={styles.emptyDayTitle}>Rest / Recovery Day </Text>
            <Text style={styles.emptyDaySubtitle}>
              No training logged for this day. Rest is when muscle and connective tissue adapt.
            </Text>
            {onStartWorkout && (
              <TouchableOpacity
                testID="calendar-start-empty-day-workout-btn"
                style={styles.startEmptyDayWorkoutBtn}
                onPress={() => onStartWorkout(selectedDate)}
                activeOpacity={0.7}
              >
                <Text style={styles.startEmptyDayWorkoutBtnText}>+ Log Workout</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.workoutsListContent}>
            {selectedDateWorkouts.map((w) => (
              <TouchableOpacity
                key={w.id}
                style={styles.workoutCard}
                onPress={() => handleWorkoutPress(w.id)}
                activeOpacity={0.75}
                accessibilityLabel={`Workout ${w.name}`}
              >
                <View style={styles.workoutCardHeader}>
                  <View style={styles.workoutCardTitleGroup}>
                    <Text style={styles.workoutCardTitle}>{w.name}</Text>
                    <Text style={styles.workoutCardTime}>
                      {w.started_at ? w.started_at.slice(11, 16) : ''} •{' '}
                      {formatDuration(w.duration_seconds)}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.statusPill,
                      w.status === 'completed'
                        ? styles.statusPillCompleted
                        : styles.statusPillInProgress,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        w.status === 'completed'
                          ? styles.statusPillTextCompleted
                          : styles.statusPillTextInProgress,
                      ]}
                    >
                      {w.status.toUpperCase()}
                    </Text>
                  </View>
                </View>

                {w.notes ? (
                  <Text style={styles.workoutCardNotes} numberOfLines={2}>
                    {w.notes}
                  </Text>
                ) : null}

                <View style={styles.workoutCardFooter}>
                  <Text style={styles.tapToInspectText}>{w.status === 'in_progress' ? 'Resume workout ›' : 'View session details ›'}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

      </ScrollView>

      {/* Drill-down Inspection Modal */}
      <SessionDetailModal
        visible={!!inspectWorkoutId}
        workoutId={inspectWorkoutId}
        workoutRepo={workoutRepo}
        exerciseRepo={exerciseRepo}
        userSettingsRepo={userSettingsRepo}
        unitSystem={unitSystem}
        intensityMetric={intensityMetric}
        onClose={() => setInspectWorkoutId(null)}
        onDeleteSession={async (deletedId) => {
          await workoutRepo.delete(deletedId);
          await loadWorkouts();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },
  container: {
    flex: 1,
    backgroundColor: uiColors.background,
    paddingTop: 8,
  },
  viewModeToggle: {
    flexDirection: 'row',
    backgroundColor: uiColors.raised,
    borderRadius: uiRadius.control,
    borderWidth: 1,
    borderColor: uiColors.border,
    padding: 2,
  },
  modeButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: uiRadius.control,
  },
  modeButtonActive: {
    backgroundColor: uiColors.border,
  },
  modeButtonText: {
    color: uiColors.subtle,
    fontSize: 12,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: uiColors.accentText,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  navArrowButton: {
    width: 44,
    height: 44,
    borderRadius: uiRadius.control,
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navArrowText: {
    color: uiColors.text,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
  todayButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: uiRadius.control,
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
  },
  todayButtonText: {
    color: uiColors.secondaryText,
    fontSize: 12,
    fontWeight: '700',
  },
  weekdaysHeader: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.subtle,
    letterSpacing: 0.5,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dayCell: {
    borderWidth: 1.5,
    borderColor: 'transparent',
    width: `${100 / 7}%`,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    marginVertical: 1,
  },
  dayCellDimmed: {
    opacity: 0.28,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  dayCellSelected: {
    backgroundColor: uiColors.raised,
    borderWidth: 1.5,
    borderColor: uiColors.accent,
  },
  dayNumberText: {
    fontSize: 13,
    fontWeight: '700',
    color: uiColors.secondaryText,
  },
  dayNumberDimmed: {
    color: '#52525B',
  },
  dayNumberToday: {
    color: uiColors.accentText,
    fontWeight: '700',
  },
  dayNumberSelected: {
    color: uiColors.text,
    fontWeight: '700',
  },
  badgeDotCompleted: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: uiColors.accent,
    marginTop: 3,
  },
  badgeDotInProgress: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
    marginTop: 3,
  },
  badgeDotPlaceholder: {
    width: 6,
    height: 6,
    marginTop: 3,
  },
  weekContainer: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 8,
    justifyContent: 'space-between',
  },
  weekDayPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    marginHorizontal: 3,
    borderRadius: uiRadius.badge,
    backgroundColor: uiColors.surface,
    borderWidth: 1.5,
    borderColor: uiColors.border,
  },
  weekDayPillToday: {
    borderColor: '#3F3F46',
  },
  weekDayPillSelected: {
    backgroundColor: uiColors.raised,
    borderColor: uiColors.accent,
    borderWidth: 1.5,
  },
  weekDayPillLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: uiColors.subtle,
    marginBottom: 4,
  },
  weekDayPillNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: uiColors.secondaryText,
  },
  weekDayPillTextSelected: {
    color: uiColors.text,
  },
  agendaHeaderRow: {
    flexWrap: 'wrap',
    gap: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
    backgroundColor: uiColors.background,
  },
  agendaDateTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: uiColors.text,
  },
  agendaDateSubtitle: {
    fontSize: 12,
    color: uiColors.subtle,
    marginTop: 2,
  },
  addWorkoutButton: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderWidth: 1,
    borderColor: uiColors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: uiRadius.control,
  },
  addWorkoutButtonText: {
    color: uiColors.accentText,
    fontSize: 12,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  workoutsListContent: {
    padding: 16,
    gap: 10,
  },
  workoutCard: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 14,
  },
  workoutCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  workoutCardTitleGroup: {
    flex: 1,
    marginRight: 10,
  },
  workoutCardTitle: {
    lineHeight: 22,
    fontSize: 16,
    fontWeight: '600',
    color: uiColors.text,
  },
  workoutCardTime: {
    fontSize: 12,
    color: uiColors.muted,
    marginTop: 2,
  },
  statusPill: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
  },
  statusPillCompleted: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderWidth: 1,
    borderColor: uiColors.accent,
  },
  statusPillInProgress: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  statusPillText: {
    lineHeight: 16,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  statusPillTextCompleted: {
    color: uiColors.accentText,
  },
  statusPillTextInProgress: {
    color: '#F59E0B',
  },
  workoutCardNotes: {
    fontSize: 13,
    color: uiColors.muted,
    marginTop: 8,
    lineHeight: 18,
  },
  workoutCardFooter: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: uiColors.border,
    alignItems: 'flex-end',
  },
  tapToInspectText: {
    fontSize: 11,
    color: uiColors.accentText,
    fontWeight: '700',
  },
  badgeIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  programSwapDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  agendaProgramCard: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderLeftWidth: 4,
    borderRadius: uiRadius.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
  },
  agendaProgramHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  agendaProgramPill: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: uiRadius.badge,
  },
  agendaProgramPillText: {
    lineHeight: 16,
    color: uiColors.background,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  agendaProgramName: {
    color: uiColors.text,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  accordionHandleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    gap: 8,
  },
  accordionHandleIndicator: {
    width: 24,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#3F3F46',
  },
  accordionHandleText: {
    color: uiColors.accentText,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  emptyDayCard: {
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 10,
    alignItems: 'center',
  },
  emptyDayTitle: {
    color: uiColors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptyDaySubtitle: {
    color: uiColors.subtle,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 16,
  },
  startEmptyDayWorkoutBtn: {
    backgroundColor: '#14291B',
    borderColor: uiColors.accent,
    borderWidth: 1,
    borderRadius: uiRadius.control,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  startEmptyDayWorkoutBtnText: {
    color: uiColors.accentText,
    fontSize: 12,
    fontWeight: '700',
  },
});
