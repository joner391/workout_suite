/**
 * Workout Suite — SBDStandardsCard
 *
 * Implements Step 3.3: SBD Tier Widget & Demographic Bell Curve Placement
 * Implements ADR-011: Allometric Strength Standards Bilinear Interpolation
 * Implements ADR-024: Pure Utility Mode (OLED-friendly high-contrast styling)
 *
 * Capabilities:
 * - Current classification tier badge (Untrained, Novice, Intermediate, Advanced, Elite)
 * - Continuous strength score (0.0 - 100.0+)
 * - Next tier progress bar with exact kilograms needed (+X.X kg needed)
 * - Offline demographic percentile bell curve placement rendered via react-native-svg
 * - Conditional DOTS score display: ONLY displayed if user has entered bodyweight
 * - Inline gender and bodyweight editor
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from 'react-native';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import {
  Gender,
  StandardLiftType,
  StrengthStandardResult,
  StrengthStandardTier,
  WeightUnit,
} from '../../core/types';
import { formatWeight, kgToLbs, lbsToKg } from '../../core/math/unitConversion';
import { calculateDotsScore } from '../../core/math/dotsCoefficients';

export interface SBDStandardsCardProps {
  liftType: StandardLiftType;
  standardResult?: StrengthStandardResult;
  userGender: Gender;
  userBodyweightKg: number | null;
  unitSystem: WeightUnit;
  onUpdateProfile?: (gender: Gender, bodyweightKg: number | null) => void;
  onOpenRadar?: () => void;
}

const TIER_COLORS: Record<StrengthStandardTier, { bg: string; border: string; text: string }> = {
  untrained: { bg: 'rgba(113, 113, 122, 0.15)', border: '#52525B', text: '#A1A1AA' },
  novice: { bg: 'rgba(59, 130, 246, 0.15)', border: '#3B82F6', text: '#60A5FA' },
  intermediate: { bg: 'rgba(16, 185, 129, 0.15)', border: '#10B981', text: '#34D399' },
  advanced: { bg: 'rgba(245, 158, 11, 0.15)', border: '#F59E0B', text: '#FBBF24' },
  elite: { bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444', text: '#F87171' },
};

export const SBDStandardsCard: React.FC<SBDStandardsCardProps> = ({
  liftType,
  standardResult,
  userGender,
  userBodyweightKg,
  unitSystem,
  onUpdateProfile,
  onOpenRadar,
}) => {
  const [editingProfile, setEditingProfile] = useState<boolean>(false);
  const [tempGender, setTempGender] = useState<Gender>(userGender);
  const [tempBwInput, setTempBwInput] = useState<string>(
    userBodyweightKg
      ? (unitSystem === 'lbs' ? kgToLbs(userBodyweightKg) : userBodyweightKg).toFixed(1)
      : ''
  );

  const tier = standardResult?.tier ?? 'untrained';
  const tierColor = TIER_COLORS[tier];

  const handleSaveProfile = () => {
    let newBwKg: number | null = null;
    const parsed = parseFloat(tempBwInput.replace(',', '.'));
    if (!isNaN(parsed) && parsed > 0) {
      newBwKg = unitSystem === 'lbs' ? lbsToKg(parsed) : parsed;
    }
    if (onUpdateProfile) {
      onUpdateProfile(tempGender, newBwKg);
    }
    setEditingProfile(false);
  };

  // Convert kg needed to current display unit
  const kgNeeded = standardResult?.kgNeededForNextTier ?? 0;
  const loadNeededDisplay = formatWeight(kgNeeded, unitSystem);

  // Continuous score percentage through current tier (0 - 100%)
  const score = standardResult?.continuousScore ?? 0;
  // Each tier spans 20 score points (0-20, 20-40, 40-60, 60-80, 80+)
  const progressInTier = Math.min(100, Math.max(5, ((score % 20) / 20) * 100));

  // Single-lift DOTS coefficient (if bodyweight is entered)
  const singleLiftDots =
    userBodyweightKg && userBodyweightKg > 0 && standardResult?.e1rmKg
      ? calculateDotsScore(userGender, userBodyweightKg, standardResult.e1rmKg)
      : null;

  // Render SVG Bell Curve
  const renderBellCurve = (percentile: number) => {
    const width = 280;
    const height = 54;
    const padding = 10;
    const chartWidth = width - padding * 2;
    const chartHeight = height - 12;

    const points: [number, number][] = [];
    const steps = 50;
    for (let i = 0; i <= steps; i++) {
      const pct = (i / steps) * 100;
      const x = padding + (pct / 100) * chartWidth;
      // Normal bell curve centered at 50, stdev 18
      const z = (pct - 50) / 18;
      const yVal = Math.exp(-0.5 * z * z);
      const y = chartHeight - yVal * (chartHeight - 6) + 4;
      points.push([x, y]);
    }

    const pathD = points.reduce((acc, [x, y], idx) => {
      return idx === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `${acc} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }, '');

    // Shaded path under curve up to user's percentile
    const clampedPct = Math.min(99.9, Math.max(0.1, percentile));
    const userX = padding + (clampedPct / 100) * chartWidth;
    const userZ = (clampedPct - 50) / 18;
    const userY = chartHeight - Math.exp(-0.5 * userZ * userZ) * (chartHeight - 6) + 4;

    const shadedPoints = points.filter(([x]) => x <= userX);
    shadedPoints.push([userX, userY]);
    const shadedD = `${shadedPoints.reduce((acc, [x, y], idx) => {
      return idx === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `${acc} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }, '')} L ${userX.toFixed(1)} ${chartHeight + 4} L ${padding} ${chartHeight + 4} Z`;

    return (
      <View style={styles.bellCurveWrapper} testID="sbd-bell-curve">
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {/* Shaded Area */}
          <Path d={shadedD} fill="rgba(0, 230, 118, 0.22)" />
          {/* Main Bell Curve Outline */}
          <Path d={pathD} fill="none" stroke="#52525B" strokeWidth="2" />
          {/* Baseline */}
          <Line
            x1={padding}
            y1={chartHeight + 4}
            x2={width - padding}
            y2={chartHeight + 4}
            stroke="#27272A"
            strokeWidth="1.5"
          />
          {/* Vertical Indicator at user percentile */}
          <Line
            x1={userX}
            y1={userY}
            x2={userX}
            y2={chartHeight + 4}
            stroke="#00E676"
            strokeWidth="2"
            strokeDasharray="2,2"
          />
          {/* Point on curve */}
          <Circle cx={userX} cy={userY} r="4" fill="#00E676" stroke="#000000" strokeWidth="1.5" />
        </Svg>
        <View style={styles.bellCurveAxisRow}>
          <Text style={styles.bellCurveAxisLabel}>General Population</Text>
          <Text style={styles.bellCurveCenterLabel}>Gym Average</Text>
          <Text style={styles.bellCurveAxisLabel}>Top 1% Elite</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.card} testID="sbd-standards-card">
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.headerTitleCol}>
          <Text style={styles.cardSuperTitle}>ALLOMETRIC STRENGTH CLASSIFICATION</Text>
          <Text style={styles.cardTitle}>
            {liftType.toUpperCase()} STANDARD
          </Text>
        </View>

        {/* User Profile Quick-Pills */}
        <TouchableOpacity
          testID="sbd-profile-toggle-btn"
          style={styles.profileBadgeBtn}
          onPress={() => setEditingProfile(!editingProfile)}
          activeOpacity={0.7}
        >
          <Text style={styles.profileBadgeText}>
            {userGender === 'male' ? '♂ Male' : '♀ Female'} •{' '}
            {userBodyweightKg
              ? formatWeight(userBodyweightKg, unitSystem)
              : 'Set BW'}
          </Text>
          <Text style={styles.profileEditIcon}>✏️</Text>
        </TouchableOpacity>
      </View>

      {/* Inline Gender & Bodyweight Editor Drawer */}
      {editingProfile && (
        <View style={styles.editProfileDrawer} testID="sbd-edit-profile-drawer">
          <Text style={styles.drawerTitle}>Athlete Demographic Profile</Text>
          <Text style={styles.drawerSubtitle}>
            Bodyweight & biological gender scale allometric strength tiers & DOTS coefficients.
          </Text>

          <View style={styles.drawerControlsRow}>
            {/* Gender Toggle */}
            <View style={styles.drawerGenderRow}>
              <TouchableOpacity
                testID="sbd-gender-male-btn"
                style={[
                  styles.drawerGenderBtn,
                  tempGender === 'male' && styles.drawerGenderBtnActive,
                ]}
                onPress={() => setTempGender('male')}
              >
                <Text
                  style={[
                    styles.drawerGenderBtnText,
                    tempGender === 'male' && styles.drawerGenderBtnTextActive,
                  ]}
                >
                  ♂ Male
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="sbd-gender-female-btn"
                style={[
                  styles.drawerGenderBtn,
                  tempGender === 'female' && styles.drawerGenderBtnActive,
                ]}
                onPress={() => setTempGender('female')}
              >
                <Text
                  style={[
                    styles.drawerGenderBtnText,
                    tempGender === 'female' && styles.drawerGenderBtnTextActive,
                  ]}
                >
                  ♀ Female
                </Text>
              </TouchableOpacity>
            </View>

            {/* Bodyweight Input */}
            <View style={styles.drawerInputContainer}>
              <TextInput
                testID="sbd-bodyweight-input"
                style={styles.drawerInput}
                keyboardType="numeric"
                placeholder={`BW (${unitSystem})`}
                placeholderTextColor="#71717A"
                value={tempBwInput}
                onChangeText={setTempBwInput}
              />
              <Text style={styles.drawerInputUnit}>{unitSystem}</Text>
            </View>

            {/* Save Button */}
            <TouchableOpacity
              testID="sbd-save-profile-btn"
              style={styles.drawerSaveBtn}
              onPress={handleSaveProfile}
            >
              <Text style={styles.drawerSaveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* NO BODYWEIGHT ENTERED STATE */}
      {!userBodyweightKg ? (
        <View style={styles.noBwBanner} testID="sbd-no-bw-banner">
          <Text style={styles.noBwIcon}>⚖️</Text>
          <View style={styles.noBwContent}>
            <Text style={styles.noBwTitle}>Bodyweight Needed for Standards</Text>
            <Text style={styles.noBwSubtext}>
              Allometric strength tiers and DOTS scores scale with body mass. Tap &quot;Set BW&quot; above to unlock your tier.
            </Text>
          </View>
          <TouchableOpacity
            testID="sbd-prompt-set-bw-btn"
            style={styles.noBwActionBtn}
            onPress={() => setEditingProfile(true)}
          >
            <Text style={styles.noBwActionBtnText}>Enter BW</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* CLASSIFICATION & METRICS */
        <View style={styles.standardsContent}>
          {/* Tier Badge & Continuous Score Row */}
          <View style={styles.tierStatusRow}>
            <View
              testID="sbd-tier-badge"
              style={[
                styles.tierBadge,
                { backgroundColor: tierColor.bg, borderColor: tierColor.border },
              ]}
            >
              <Text style={[styles.tierBadgeText, { color: tierColor.text }]}>
                {tier.toUpperCase()}
              </Text>
            </View>

            <View style={styles.scoreCol}>
              <Text style={styles.scoreNumberText}>
                {standardResult?.continuousScore.toFixed(1) ?? '0.0'}
                <Text style={styles.scoreMaxText}> / 100</Text>
              </Text>
              <Text style={styles.scoreSubLabel}>Strength Score</Text>
            </View>
          </View>

          {/* Progress Bar to Next Tier */}
          <View style={styles.progressContainer}>
            <View style={styles.progressHeaderRow}>
              <Text style={styles.progressTitle}>
                {standardResult?.nextTierName
                  ? `Next Tier: ${standardResult.nextTierName.toUpperCase()}`
                  : 'Highest Tier Achieved'}
              </Text>
              <Text style={styles.progressDeltaText}>
                {standardResult?.nextTierName
                  ? `+${loadNeededDisplay} needed`
                  : '★ Elite Achieved'}
              </Text>
            </View>

            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${tier === 'elite' ? 100 : progressInTier}%`,
                    backgroundColor: tierColor.border,
                  },
                ]}
              />
            </View>
          </View>

          {/* Demographic Percentile Bell Curve */}
          {standardResult && (
            <View style={styles.percentileSection}>
              <View style={styles.percentileHeaderRow}>
                <Text style={styles.percentileTitle}>POPULATION DISTRIBUTION</Text>
                <Text style={styles.percentileRankText}>
                  Top {(100 - standardResult.demographicPercentile).toFixed(1)}% of Lifters
                  <Text style={styles.percentileSubrankText}>
                    {' '}({standardResult.demographicPercentile.toFixed(1)}th percentile)
                  </Text>
                </Text>
              </View>

              {renderBellCurve(standardResult.demographicPercentile)}
            </View>
          )}

          {/* DOTS Score Highlight Row (Strictly shown only if BW was entered) */}
          {singleLiftDots !== null && (
            <View style={styles.dotsHighlightRow} testID="sbd-dots-box">
              <View style={styles.dotsIconBox}>
                <Text style={styles.dotsIconText}>🎯</Text>
              </View>
              <View style={styles.dotsInfoCol}>
                <View style={styles.dotsScoreHeader}>
                  <Text style={styles.dotsTitle}>Official DOTS Coefficient</Text>
                  <Text style={styles.dotsScoreText}>
                    {singleLiftDots.toFixed(1)} pts
                  </Text>
                </View>
                <Text style={styles.dotsSubtext}>
                  Non-linear 4th-order polynomial score for {userGender} ({formatWeight(userBodyweightKg, unitSystem)}).
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Button to open multi-lift SBD Balance Radar if Squat/Bench/Deadlift */}
      {onOpenRadar && (liftType === 'squat' || liftType === 'bench' || liftType === 'deadlift') && (
        <TouchableOpacity
          testID="open-sbd-radar-btn"
          style={styles.openRadarBtn}
          onPress={onOpenRadar}
          activeOpacity={0.8}
        >
          <Text style={styles.openRadarBtnText}>
            View 3-Lift SBD Balance & Symmetry Radar ➔
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 14,
    padding: 16,
    marginVertical: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitleCol: {
    flex: 1,
  },
  cardSuperTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FAFAFA',
    marginTop: 2,
  },
  profileBadgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  profileBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#00E676',
  },
  profileEditIcon: {
    fontSize: 10,
    marginLeft: 4,
  },
  editProfileDrawer: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  drawerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  drawerSubtitle: {
    fontSize: 11,
    color: '#A1A1AA',
    marginTop: 2,
    marginBottom: 10,
    lineHeight: 15,
  },
  drawerControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  drawerGenderRow: {
    flexDirection: 'row',
    backgroundColor: '#121215',
    borderRadius: 6,
    padding: 2,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  drawerGenderBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  drawerGenderBtnActive: {
    backgroundColor: '#27272A',
  },
  drawerGenderBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71717A',
  },
  drawerGenderBtnTextActive: {
    color: '#00E676',
  },
  drawerInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    paddingHorizontal: 8,
    height: 36,
    flex: 1,
    minWidth: 90,
  },
  drawerInput: {
    flex: 1,
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
    padding: 0,
  },
  drawerInputUnit: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '600',
  },
  drawerSaveBtn: {
    backgroundColor: '#00E676',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  drawerSaveBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  noBwBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  noBwIcon: {
    fontSize: 22,
  },
  noBwContent: {
    flex: 1,
  },
  noBwTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  noBwSubtext: {
    fontSize: 11,
    color: '#71717A',
    marginTop: 2,
    lineHeight: 15,
  },
  noBwActionBtn: {
    backgroundColor: '#00E676',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  noBwActionBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  standardsContent: {
    gap: 12,
  },
  tierStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tierBadge: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  tierBadgeText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  scoreCol: {
    alignItems: 'flex-end',
  },
  scoreNumberText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FAFAFA',
  },
  scoreMaxText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#71717A',
  },
  scoreSubLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 0.4,
  },
  progressContainer: {
    backgroundColor: '#18181B',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  progressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A1A1AA',
  },
  progressDeltaText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00E676',
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#27272A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  percentileSection: {
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  percentileHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
  },
  percentileTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.5,
  },
  percentileRankText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#00E676',
  },
  percentileSubrankText: {
    fontSize: 10,
    color: '#71717A',
    fontWeight: '600',
  },
  bellCurveWrapper: {
    alignItems: 'center',
  },
  bellCurveAxisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 260,
    marginTop: 4,
  },
  bellCurveAxisLabel: {
    fontSize: 9,
    color: '#71717A',
    fontWeight: '600',
  },
  bellCurveCenterLabel: {
    fontSize: 9,
    color: '#A1A1AA',
    fontWeight: '700',
  },
  dotsHighlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 230, 118, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.25)',
    borderRadius: 10,
    padding: 10,
    gap: 10,
  },
  dotsIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotsIconText: {
    fontSize: 16,
  },
  dotsInfoCol: {
    flex: 1,
  },
  dotsScoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dotsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  dotsScoreText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#00E676',
  },
  dotsSubtext: {
    fontSize: 10,
    color: '#A1A1AA',
    marginTop: 2,
    lineHeight: 14,
  },
  openRadarBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  openRadarBtnText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '800',
  },
});
