import { AppIcon } from '../../ui/AppIcon';
import { colors as uiColors, radius as uiRadius } from '../../ui/theme';
/**
 * Workout Suite — SBDBalanceRadarChart
 *
 * Implements Step 3.3: SBD Performance Intelligence & Symmetry Radar
 * Implements ADR-011: Multi-Lift Allometric Strength Balance & Radar Modeling
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 *
 * Capabilities:
 * - 3-Axis Normalized Radar Chart (Squat, Bench, Deadlift) rendered via react-native-svg
 * - Concentric equilateral polygon grid webs (25%, 50%, 75%, 100%)
 * - SBD Symmetry & Balance classification (Dominant vs Lagging lift vs Balanced Triad)
 * - Powerlifting SBD Total (kg/lbs) and composite DOTS score
 * - Dedicated modal/card presentation with close action
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import Svg, { Polygon, Line, Circle, Text as SvgText } from 'react-native-svg';
import {
  Gender,
  SBDBalanceProfile,
  WeightUnit,
} from '../../core/types';
import { formatWeight } from '../../core/math/unitConversion';

export interface SBDBalanceRadarChartProps {
  balanceProfile: SBDBalanceProfile | null;
  gender: Gender;
  bodyweightKg: number | null;
  unitSystem: WeightUnit;
  onClose?: () => void;
  onOpenProfile?: () => void;
}

export const SBDBalanceRadarChart: React.FC<SBDBalanceRadarChartProps> = ({
  balanceProfile,
  gender,
  bodyweightKg,
  unitSystem,
  onClose,
  onOpenProfile,
}) => {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const maxRadius = 90;

  // Angles in radians:
  // Squat: -PI/2 (top)
  // Bench: PI/6 (bottom right, 30 deg)
  // Deadlift: 5*PI/6 (bottom left, 150 deg)
  const angleSquat = -Math.PI / 2;
  const angleBench = Math.PI / 6;
  const angleDeadlift = (5 * Math.PI) / 6;

  const getPoint = (radius: number, angle: number): [number, number] => {
    return [
      Math.round((cx + radius * Math.cos(angle)) * 10) / 10,
      Math.round((cy + radius * Math.sin(angle)) * 10) / 10,
    ];
  };

  // Concentric polygon web rings (25, 50, 75, 100)
  const rings = [0.25, 0.5, 0.75, 1.0];
  const ringPolygons = rings.map((factor) => {
    const r = maxRadius * factor;
    const pSquat = getPoint(r, angleSquat);
    const pBench = getPoint(r, angleBench);
    const pDeadlift = getPoint(r, angleDeadlift);
    return `${pSquat[0]},${pSquat[1]} ${pBench[0]},${pBench[1]} ${pDeadlift[0]},${pDeadlift[1]}`;
  });

  // User polygon points
  const squatScore = balanceProfile ? Math.min(100, Math.max(5, balanceProfile.radarCoordinates.squat)) : 10;
  const benchScore = balanceProfile ? Math.min(100, Math.max(5, balanceProfile.radarCoordinates.bench)) : 10;
  const deadliftScore = balanceProfile ? Math.min(100, Math.max(5, balanceProfile.radarCoordinates.deadlift)) : 10;

  const rSquat = (squatScore / 100) * maxRadius;
  const rBench = (benchScore / 100) * maxRadius;
  const rDeadlift = (deadliftScore / 100) * maxRadius;

  const userPointSquat = getPoint(rSquat, angleSquat);
  const userPointBench = getPoint(rBench, angleBench);
  const userPointDeadlift = getPoint(rDeadlift, angleDeadlift);
  const userPolygon = `${userPointSquat[0]},${userPointSquat[1]} ${userPointBench[0]},${userPointBench[1]} ${userPointDeadlift[0]},${userPointDeadlift[1]}`;

  // Outer axis tips
  const tipSquat = getPoint(maxRadius, angleSquat);
  const tipBench = getPoint(maxRadius, angleBench);
  const tipDeadlift = getPoint(maxRadius, angleDeadlift);

  // Symmetry analysis text
  const dominantText = balanceProfile?.dominantLift !== 'balanced'
    ? `${balanceProfile?.dominantLift.toUpperCase()} DOMINANT`
    : 'BALANCED TRIAD';

  const laggingText = balanceProfile?.laggingLift !== 'none'
    ? `${balanceProfile?.laggingLift.toUpperCase()} LAGGING`
    : 'NO LAGGING LIFTS';

  // SBD Total in user unit
  const totalKg = balanceProfile?.totalKg ?? 0;
  const displayTotal = formatWeight(totalKg, unitSystem);

  return (
    <View style={styles.container} testID="sbd-balance-radar-chart">
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleCol}>
          <Text style={styles.superTitle}>PERFORMANCE INTELLIGENCE</Text>
          <Text style={styles.title}>SBD Strength Balance Radar</Text>
          <Text style={styles.subtitle}>
            Normalized symmetry profile across Squat, Bench & Deadlift
          </Text>
        </View>

        {onClose && (
          <TouchableOpacity
            testID="close-sbd-radar-btn"
            style={styles.closeBtn}
            onPress={onClose}
            activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close"
          >
            <AppIcon name="close" size={20} color={uiColors.accentText} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* SVG Radar Visualization */}
        <View style={styles.radarWrapper}>
          <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Background Grid Web Rings */}
            {ringPolygons.map((pointsStr, idx) => (
              <Polygon
                key={`grid-ring-${idx}`}
                points={pointsStr}
                fill={idx === 3 ? uiColors.surface : 'transparent'}
                stroke={uiColors.border}
                strokeWidth={idx === 3 ? 1.5 : 1}
              />
            ))}

            {/* Radial Axis Lines */}
            <Line
              x1={cx}
              y1={cy}
              x2={tipSquat[0]}
              y2={tipSquat[1]}
              stroke="#3F3F46"
              strokeWidth={1.5}
            />
            <Line
              x1={cx}
              y1={cy}
              x2={tipBench[0]}
              y2={tipBench[1]}
              stroke="#3F3F46"
              strokeWidth={1.5}
            />
            <Line
              x1={cx}
              y1={cy}
              x2={tipDeadlift[0]}
              y2={tipDeadlift[1]}
              stroke="#3F3F46"
              strokeWidth={1.5}
            />

            {/* User Data Polygon */}
            <Polygon
              points={userPolygon}
              fill="rgba(0, 230, 118, 0.28)"
              stroke={uiColors.accent}
              strokeWidth={2.5}
            />

            {/* Vertex Markers */}
            <Circle
              cx={userPointSquat[0]}
              cy={userPointSquat[1]}
              r={5}
              fill={uiColors.accent}
              stroke={uiColors.background}
              strokeWidth={2}
            />
            <Circle
              cx={userPointBench[0]}
              cy={userPointBench[1]}
              r={5}
              fill={uiColors.accent}
              stroke={uiColors.background}
              strokeWidth={2}
            />
            <Circle
              cx={userPointDeadlift[0]}
              cy={userPointDeadlift[1]}
              r={5}
              fill={uiColors.accent}
              stroke={uiColors.background}
              strokeWidth={2}
            />

            {/* Axis Corner Labels */}
            <SvgText
              x={tipSquat[0]}
              y={tipSquat[1] - 12}
              fill={uiColors.text}
              fontSize={11}
              fontWeight="bold"
              textAnchor="middle"
            >
              SQUAT ({balanceProfile?.squatScore.toFixed(0) ?? 0})
            </SvgText>

            <SvgText
              x={tipBench[0] + 8}
              y={tipBench[1] + 16}
              fill={uiColors.text}
              fontSize={11}
              fontWeight="bold"
              textAnchor="start"
            >
              BENCH ({balanceProfile?.benchScore.toFixed(0) ?? 0})
            </SvgText>

            <SvgText
              x={tipDeadlift[0] - 8}
              y={tipDeadlift[1] + 16}
              fill={uiColors.text}
              fontSize={11}
              fontWeight="bold"
              textAnchor="end"
            >
              DEADLIFT ({balanceProfile?.deadliftScore.toFixed(0) ?? 0})
            </SvgText>
          </Svg>
        </View>

        {/* Symmetry Assessment Badges Row */}
        <View style={styles.symmetryBadgesRow}>
          <View
            style={[
              styles.symmetryBadge,
              balanceProfile?.dominantLift !== 'balanced'
                ? styles.symmetryBadgeAccent
                : styles.symmetryBadgeNeutral,
            ]}
          >
            <Text
              style={[
                styles.symmetryBadgeText,
                balanceProfile?.dominantLift !== 'balanced' && styles.symmetryBadgeTextAccent,
              ]}
            >
              {dominantText}
            </Text>
          </View>

          <View
            style={[
              styles.symmetryBadge,
              balanceProfile?.laggingLift !== 'none'
                ? styles.symmetryBadgeWarning
                : styles.symmetryBadgeNeutral,
            ]}
          >
            <Text
              style={[
                styles.symmetryBadgeText,
                balanceProfile?.laggingLift !== 'none' && styles.symmetryBadgeTextWarning,
              ]}
            >
              {laggingText}
            </Text>
          </View>
        </View>

        {/* Metrics Grid Cards */}
        <View style={styles.metricsGrid}>
          {/* SBD Total */}
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>SBD TOTAL e1RM</Text>
            <Text style={styles.metricValuePrimary}>{displayTotal}</Text>
            <Text style={styles.metricSubtext}>Squat + Bench + Deadlift</Text>
          </View>

          {/* Average Normalized Score */}
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>AVERAGE SCORE</Text>
            <Text style={styles.metricValueAccent}>
              {balanceProfile?.averageScore.toFixed(1) ?? '0.0'}
              <Text style={styles.metricValueUnit}> / 100</Text>
            </Text>
            <Text style={styles.metricSubtext}>Composite Power Index</Text>
          </View>
        </View>

        {/* DOTS Score Box (ONLY IF bodyweight entered) */}
        {bodyweightKg && bodyweightKg > 0 && balanceProfile?.dotsScore ? (
          <View style={styles.dotsCard} testID="sbd-radar-dots-card">
            <View style={styles.dotsCardHeader}>
              <View style={styles.dotsHeaderLeft}>
                <Text style={styles.dotsCardIcon}>🏆</Text>
                <View>
                  <Text style={styles.dotsCardTitle}>Estimated SBD DOTS Score</Text>
                  <Text style={styles.dotsCardSubtext}>
                    Based on best e1RM estimates ({gender}, {formatWeight(bodyweightKg, unitSystem)})
                  </Text>
                </View>
              </View>
              <Text style={styles.dotsCardScore}>
                {balanceProfile.dotsScore.toFixed(1)}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.noBwCard} testID="sbd-radar-no-bw">
              <AppIcon name="scale" size={20} color={uiColors.accentText} />
            <View style={styles.noBwContent}>
              <Text style={styles.noBwTitle}>DOTS Score Requires Bodyweight</Text>
              <Text style={styles.noBwSubtext}>
                Log your bodyweight to calculate an estimated DOTS score from your lift estimates.
              </Text>
            </View>
            {onOpenProfile && (
              <TouchableOpacity style={styles.noBwActionBtn} onPress={onOpenProfile}>
                <Text style={styles.noBwActionBtnText}>Set BW</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Educational Info Box */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>About Lift Balance & Symmetry</Text>
          <Text style={styles.infoText}>
            A balanced triad indicates proportional force production across your anterior and posterior chains.
            When an individual lift spreads by ≥ 8.0 points from your other lifts, it is identified as
            dominant or lagging to inform targeted programming.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: uiColors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.border,
  },
  headerTitleCol: {
    minWidth: 0,
    flex: 1,
    paddingRight: 10,
  },
  superTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: uiColors.subtle,
    letterSpacing: 0.6,
  },
  title: {
    lineHeight: 28,
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '700',
    color: uiColors.text,
    marginTop: 2,
  },
  subtitle: {
    fontSize: 12,
    color: uiColors.muted,
    marginTop: 2,
  },
  closeBtn: {
    flexShrink: 0,
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: uiColors.raised,
    borderWidth: 1,
    borderColor: uiColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 16,
    alignItems: 'center',
    paddingBottom: 32,
  },
  radarWrapper: {
    marginVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symmetryBadgesRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  symmetryBadge: {
    minHeight: 26,
    justifyContent: 'center',
    borderRadius: uiRadius.badge,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
  },
  symmetryBadgeAccent: {
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    borderColor: uiColors.accent,
  },
  symmetryBadgeWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: '#F59E0B',
  },
  symmetryBadgeNeutral: {
    backgroundColor: uiColors.raised,
    borderColor: uiColors.border,
  },
  symmetryBadgeText: {
    lineHeight: 16,
    fontSize: 11,
    fontWeight: '600',
    color: uiColors.muted,
    letterSpacing: 0.4,
  },
  symmetryBadgeTextAccent: {
    color: uiColors.accentText,
  },
  symmetryBadgeTextWarning: {
    color: '#F59E0B',
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginVertical: 10,
  },
  metricCard: {
    flex: 1,
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 12,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: uiColors.subtle,
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  metricValuePrimary: {
    fontSize: 18,
    fontWeight: '700',
    color: uiColors.text,
  },
  metricValueAccent: {
    fontSize: 18,
    fontWeight: '700',
    color: uiColors.accentText,
  },
  metricValueUnit: {
    fontSize: 12,
    fontWeight: '600',
    color: uiColors.subtle,
  },
  metricSubtext: {
    fontSize: 10,
    color: uiColors.subtle,
    marginTop: 4,
  },
  dotsCard: {
    width: '100%',
    backgroundColor: 'rgba(0, 230, 118, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.3)',
    borderRadius: uiRadius.card,
    padding: 14,
    marginVertical: 6,
  },
  dotsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dotsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  dotsCardIcon: {
    fontSize: 22,
  },
  dotsCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: uiColors.text,
  },
  dotsCardSubtext: {
    fontSize: 10,
    color: uiColors.muted,
    marginTop: 2,
  },
  dotsCardScore: {
    fontSize: 22,
    fontWeight: '700',
    color: uiColors.accentText,
    marginLeft: 8,
  },
  noBwCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: uiColors.surface,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: uiRadius.card,
    padding: 12,
    gap: 10,
    marginVertical: 6,
  },
  noBwContent: {
    flex: 1,
  },
  noBwTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.text,
  },
  noBwSubtext: {
    fontSize: 10,
    color: uiColors.subtle,
    marginTop: 2,
    lineHeight: 14,
  },
  noBwActionBtn: {
    backgroundColor: uiColors.accent,
    borderRadius: uiRadius.control,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  noBwActionBtnText: {
    color: uiColors.background,
    fontSize: 11,
    fontWeight: '700',
  },
  infoBox: {
    width: '100%',
    backgroundColor: uiColors.background,
    borderWidth: 1,
    borderColor: uiColors.border,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  infoTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.muted,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 11,
    color: uiColors.subtle,
    lineHeight: 16,
  },
});
