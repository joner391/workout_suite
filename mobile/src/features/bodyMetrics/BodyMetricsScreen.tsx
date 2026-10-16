import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  IBodyMetricsRepository,
  IUserProfileRepository,
  IUserSettingsRepository,
} from '../../domain/repositories';
import {
  BodyMetric,
  Gender,
  WeightUnit,
  UserProfile,
} from '../../core/types';
import {
  calculateNavyBodyFat,
  calculateEstimatedLeanBodyMass,
  calculateBodyweightRollingAverages,
} from '../../core/math/navyBodyFat';
import {
  cmToInches,
  inchesToCm,
  kgToLbs,
  lbsToKg,
  formatWeight,
  formatLength,
} from '../../core/math/unitConversion';

export interface BodyMetricsScreenProps {
  bodyMetricsRepo: IBodyMetricsRepository;
  userProfileRepo?: IUserProfileRepository;
  userSettingsRepo?: IUserSettingsRepository;
  onOpenPlots?: () => void;
  onClose?: () => void;
}

export const BodyMetricsScreen: React.FC<BodyMetricsScreenProps> = ({
  bodyMetricsRepo,
  userProfileRepo,
  userSettingsRepo,
  onOpenPlots,
  onClose,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [unitSystem, setUnitSystem] = useState<WeightUnit>('kg');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Form State
  const todayStr = new Date().toISOString().split('T')[0];
  const [entryDate, setEntryDate] = useState<string>(todayStr);
  const [bodyweightInput, setBodyweightInput] = useState<string>('');
  const [manualBfInput, setManualBfInput] = useState<string>('');

  // Circumference Inputs (displayed/entered in cm or inches per unitSystem)
  const [waistInput, setWaistInput] = useState<string>('');
  const [neckInput, setNeckInput] = useState<string>('');
  const [hipInput, setHipInput] = useState<string>('');
  const [bicepInput, setBicepInput] = useState<string>('');
  const [chestInput, setChestInput] = useState<string>('');
  const [thighInput, setThighInput] = useState<string>('');
  const [calfInput, setCalfInput] = useState<string>('');

  // History & Rolling Avg State
  const [metricsHistory, setMetricsHistory] = useState<BodyMetric[]>([]);
  const [rollingAvg7, setRollingAvg7] = useState<{
    sma7: number;
    ema7: number;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // 1. Load initial profile and settings
  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      if (userSettingsRepo) {
        const u = await userSettingsRepo.get('unit_system');
        if (u === 'lbs' || u === 'kg') {
          setUnitSystem(u);
        }
      }

      let profile: UserProfile | null = null;
      if (userProfileRepo) {
        profile = await userProfileRepo.getProfile();
        setUserProfile(profile);
      }

      const allMetrics = await bodyMetricsRepo.getAll();
      setMetricsHistory([...allMetrics].reverse()); // Newest first

      // Compute rolling averages
      const validWeightMetrics = allMetrics.filter(
        (m): m is BodyMetric & { bodyweight: number } =>
          m.bodyweight != null && m.bodyweight > 0
      );
      if (validWeightMetrics.length > 0) {
        const smoothed = calculateBodyweightRollingAverages(
          validWeightMetrics.map((m) => ({ date: m.date, bodyweight: m.bodyweight }))
        );
        if (smoothed.length > 0) {
          const latest = smoothed[smoothed.length - 1];
          setRollingAvg7({ sma7: latest.sma7, ema7: latest.ema7 });
        }
      } else {
        setRollingAvg7(null);
      }
    } catch (err) {
      console.error('Failed to load body metrics data:', err);
    } finally {
      setLoading(false);
    }
  }, [bodyMetricsRepo, userProfileRepo, userSettingsRepo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Helper to convert circumference string into centimeters
  const parseCircumferenceToCm = (val: string): number | null => {
    const num = parseFloat(val.trim());
    if (isNaN(num) || num <= 0) return null;
    return unitSystem === 'lbs' ? inchesToCm(num) : num;
  };

  // Helper to convert weight string into canonical kilograms
  const parseWeightToKg = (val: string): number | null => {
    const num = parseFloat(val.trim());
    if (isNaN(num) || num <= 0) return null;
    return unitSystem === 'lbs' ? lbsToKg(num) : num;
  };

  // 1. Resolve latest recorded historical measurements (LOCF fallback)
  const latestRecordedWeightKg =
    metricsHistory.find((m) => m.bodyweight != null && m.bodyweight > 0)?.bodyweight ?? null;
  const latestRecordedWaistCm =
    metricsHistory.find((m) => m.waist_cm != null && m.waist_cm > 0)?.waist_cm ?? null;
  const latestRecordedNeckCm =
    metricsHistory.find((m) => m.neck_cm != null && m.neck_cm > 0)?.neck_cm ?? null;
  const latestRecordedHipCm =
    metricsHistory.find((m) => m.hip_cm != null && m.hip_cm > 0)?.hip_cm ?? null;

  // 2. Real-time Live Navy Body Fat Estimation with Forward-Fill
  const enteredWaistCm = parseCircumferenceToCm(waistInput);
  const enteredNeckCm = parseCircumferenceToCm(neckInput);
  const enteredHipCm = parseCircumferenceToCm(hipInput);
  const enteredWeightKg = parseWeightToKg(bodyweightInput);

  const effectiveWaistCm = enteredWaistCm ?? latestRecordedWaistCm;
  const effectiveNeckCm = enteredNeckCm ?? latestRecordedNeckCm;
  const effectiveHipCm = enteredHipCm ?? latestRecordedHipCm;
  const effectiveWeightKg = enteredWeightKg ?? latestRecordedWeightKg;

  const gender: Gender = userProfile?.gender || 'male';
  const heightCm = userProfile?.height_cm;

  let liveNavyBf: number | null = null;
  if (heightCm && effectiveWaistCm && effectiveNeckCm) {
    liveNavyBf = calculateNavyBodyFat({
      gender,
      heightCm,
      waistCm: effectiveWaistCm,
      neckCm: effectiveNeckCm,
      hipCm: effectiveHipCm,
    });
  }

  // Real-time live eLBM calculation using effective weight & Navy BF%
  const liveNavyElbmKg =
    liveNavyBf != null && effectiveWeightKg != null && effectiveWeightKg > 0
      ? calculateEstimatedLeanBodyMass(effectiveWeightKg, liveNavyBf)
      : null;

  const liveNavyElbmDisplay =
    liveNavyElbmKg != null
      ? unitSystem === 'lbs'
        ? kgToLbs(liveNavyElbmKg)
        : liveNavyElbmKg
      : null;

  // Latest eLBM from historical records incorporating LOCF
  const latestMetricWithNavy = metricsHistory.find(
    (m) => m.navy_body_fat != null && m.navy_body_fat > 0
  );
  const latestElbmKg =
    latestRecordedWeightKg != null &&
    latestMetricWithNavy?.navy_body_fat != null
      ? calculateEstimatedLeanBodyMass(
          latestRecordedWeightKg,
          latestMetricWithNavy.navy_body_fat
        )
      : null;

  // 3. Save Entry Handler
  const handleSaveMetric = async () => {
    const enteredKg = parseWeightToKg(bodyweightInput);
    const targetWeightKg = enteredKg ?? latestRecordedWeightKg;
    if (!targetWeightKg) {
      Alert.alert(
        'Missing Bodyweight',
        `Please enter a bodyweight in ${unitSystem} to record an initial measurement.`
      );
      return;
    }

    if (
      !bodyweightInput.trim() &&
      !waistInput.trim() &&
      !neckInput.trim() &&
      !hipInput.trim() &&
      !bicepInput.trim() &&
      !chestInput.trim() &&
      !thighInput.trim() &&
      !calfInput.trim() &&
      !manualBfInput.trim()
    ) {
      Alert.alert('Empty Entry', 'Please enter at least one measurement to save.');
      return;
    }

    try {
      const manualBf = parseFloat(manualBfInput.trim());
      const newId = `bm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const metricToSave: BodyMetric = {
        id: newId,
        date: entryDate.trim() || todayStr,
        bodyweight: Number(targetWeightKg.toFixed(2)),
        body_fat_manual:
          !isNaN(manualBf) && manualBf > 0 && manualBf < 100
            ? Number(manualBf.toFixed(1))
            : null,
        waist_cm: enteredWaistCm != null ? Number(enteredWaistCm.toFixed(1)) : null,
        neck_cm: enteredNeckCm != null ? Number(enteredNeckCm.toFixed(1)) : null,
        hip_cm: enteredHipCm != null ? Number(enteredHipCm.toFixed(1)) : null,
        bicep_cm:
          parseCircumferenceToCm(bicepInput) != null
            ? Number(parseCircumferenceToCm(bicepInput)!.toFixed(1))
            : null,
        chest_cm:
          parseCircumferenceToCm(chestInput) != null
            ? Number(parseCircumferenceToCm(chestInput)!.toFixed(1))
            : null,
        thigh_cm:
          parseCircumferenceToCm(thighInput) != null
            ? Number(parseCircumferenceToCm(thighInput)!.toFixed(1))
            : null,
        calf_cm:
          parseCircumferenceToCm(calfInput) != null
            ? Number(parseCircumferenceToCm(calfInput)!.toFixed(1))
            : null,
        navy_body_fat: liveNavyBf,
      };

      await bodyMetricsRepo.save(metricToSave, {
        gender,
        height_cm: heightCm,
      });

      setStatusMessage('Measurement saved successfully! ✓');
      setTimeout(() => setStatusMessage(null), 3000);

      // Reset main inputs while leaving date
      setBodyweightInput('');
      setManualBfInput('');
      setWaistInput('');
      setNeckInput('');
      setHipInput('');
      setBicepInput('');
      setChestInput('');
      setThighInput('');
      setCalfInput('');

      await loadData();
    } catch (err) {
      console.error('Failed to save body metric:', err);
      Alert.alert('Error', 'Failed to save body measurement.');
    }
  };

  // 4. Delete Entry Handler
  const handleDeleteMetric = async (id: string, date: string) => {
    Alert.alert(
      'Delete Entry',
      `Are you sure you want to delete the log for ${date}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await bodyMetricsRepo.delete(id);
              await loadData();
            } catch (err) {
              console.error('Failed to delete metric:', err);
            }
          },
        },
      ]
    );
  };

  const lenUnit = unitSystem === 'lbs' ? 'in' : 'cm';

  return (
    <View testID="body-metrics-screen" style={styles.container}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerSubtitle}>ANTHROPOMETRY & PHYSIQUE</Text>
          <Text style={styles.headerTitle}>Body Composition</Text>
        </View>

        <View style={styles.headerActions}>
          {onOpenPlots && (
            <TouchableOpacity
              testID="view-charts-btn"
              style={styles.actionBtn}
              onPress={onOpenPlots}
            >
              <Text style={styles.actionBtnText}>Charts 📈</Text>
            </TouchableOpacity>
          )}

          {onClose && (
            <TouchableOpacity
              testID="body-metrics-close-btn"
              style={styles.closeBtn}
              onPress={onClose}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Status Toast Feedback */}
        {statusMessage && (
          <View style={styles.statusToast} testID="status-toast">
            <Text style={styles.statusToastText}>{statusMessage}</Text>
          </View>
        )}

        {/* 1. 7-Day Rolling Average Summary Banner */}
        {rollingAvg7 && (
          <View style={styles.rollingBanner} testID="rolling-avg-banner">
            <View style={styles.rollingItem}>
              <Text style={styles.rollingLabel}>7-DAY SMA</Text>
              <Text style={styles.rollingValue}>
                {formatWeight(rollingAvg7.sma7, unitSystem)}
              </Text>
            </View>
            <View style={styles.rollingDivider} />
            <View style={styles.rollingItem}>
              <Text style={styles.rollingLabel}>7-DAY EMA</Text>
              <Text style={styles.rollingValue}>
                {formatWeight(rollingAvg7.ema7, unitSystem)}
              </Text>
            </View>
            {latestElbmKg != null && (
              <>
                <View style={styles.rollingDivider} />
                <View style={styles.rollingItem} testID="rolling-elbm-item">
                  <Text style={styles.rollingLabel}>LATEST eLBM</Text>
                  <Text
                    style={[styles.rollingValue, { color: '#10B981' }]}
                    testID="rolling-elbm-value"
                  >
                    {formatWeight(latestElbmKg, unitSystem)}
                  </Text>
                </View>
              </>
            )}
            <View style={styles.rollingDivider} />
            <View style={styles.rollingItem}>
              <Text style={styles.rollingLabel}>TREND STATUS</Text>
              <Text style={[styles.rollingValue, { color: '#00E676' }]}>
                Smooth Curve
              </Text>
            </View>
          </View>
        )}

        {/* 2. Log New Measurement Card */}
        <View style={styles.card}>
          <Text style={styles.cardHeaderTitle}>LOG NEW MEASUREMENT</Text>

          {/* Date & Bodyweight Row */}
          <View style={styles.inputRow}>
            <View style={[styles.inputGroup, { flex: 1.1 }]}>
              <Text style={styles.inputLabel}>Date (YYYY-MM-DD)</Text>
              <TextInput
                testID="input-date"
                style={styles.textInput}
                value={entryDate}
                onChangeText={setEntryDate}
                placeholder="2026-10-15"
                placeholderTextColor="#555555"
              />
            </View>

            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>Weight ({unitSystem}) *</Text>
              <TextInput
                testID="input-bodyweight"
                style={[styles.textInput, styles.primaryInput]}
                value={bodyweightInput}
                onChangeText={setBodyweightInput}
                placeholder={
                  latestRecordedWeightKg != null
                    ? formatWeight(latestRecordedWeightKg, unitSystem, { showUnit: false })
                    : unitSystem === 'lbs'
                    ? '180.5'
                    : '82.0'
                }
                placeholderTextColor="#555555"
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Manual Body Fat % */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>
              Manual Body Fat % (Optional: DEXA / Calipers)
            </Text>
            <TextInput
              testID="input-manual-bf"
              style={styles.textInput}
              value={manualBfInput}
              onChangeText={setManualBfInput}
              placeholder="e.g. 14.5"
              placeholderTextColor="#555555"
              keyboardType="numeric"
            />
          </View>

          {/* Live Navy Body Fat & eLBM Estimation Card */}
          <View style={styles.navyEstimateCard} testID="navy-estimate-card">
            <View style={styles.navyEstimateHeader}>
              <Text style={styles.navyEstimateTitle}>
                🔬 U.S. NAVY FORMULA (BF% & eLBM)
              </Text>
            </View>

            <View style={styles.navyEstimateStatsRow}>
              <View style={styles.navyStatItem}>
                <Text style={styles.navyStatLabel}>BODY FAT %</Text>
                <Text style={styles.navyEstimateValue} testID="live-navy-bf-value">
                  {liveNavyBf != null ? `${liveNavyBf.toFixed(1)}%` : '—'}
                </Text>
              </View>

              <View style={styles.navyStatDivider} />

              <View style={styles.navyStatItem}>
                <Text style={styles.navyStatLabel}>LEAN MASS (eLBM)</Text>
                <Text style={styles.navyEstimateElbmValue} testID="live-navy-elbm-value">
                  {liveNavyElbmDisplay != null
                    ? `${liveNavyElbmDisplay.toFixed(1)} ${unitSystem}`
                    : '—'}
                </Text>
              </View>
            </View>

            <Text style={styles.navyEstimateSubtext} testID="navy-estimate-subtext">
              {userProfile?.height_cm
                ? liveNavyBf != null
                  ? `Computed from Neck (${formatLength(effectiveNeckCm, unitSystem)}${enteredNeckCm ? '' : ' [last]'}), Waist (${formatLength(effectiveWaistCm, unitSystem)}${enteredWaistCm ? '' : ' [last]'})${gender === 'female' && effectiveHipCm ? `, Hip (${formatLength(effectiveHipCm, unitSystem)}${enteredHipCm ? '' : ' [last]'})` : ''} & Height (${userProfile.height_cm} cm)${effectiveWeightKg ? ` with Weight (${formatWeight(effectiveWeightKg, unitSystem)}${enteredWeightKg ? '' : ' [last]'})` : ''}.`
                  : `Enter Waist and Neck (${gender === 'female' ? 'plus Hips' : ''}) below to auto-calculate.`
                : 'Configure your height in Profile to enable automatic Navy body fat calculation.'}
            </Text>
          </View>

          {/* Primary Navy Circumferences */}
          <Text style={styles.subSectionTitle}>
            PRIMARY CIRCUMFERENCES ({lenUnit.toUpperCase()})
          </Text>

          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Waist (at navel) *</Text>
              <TextInput
                testID="input-waist"
                style={styles.textInput}
                value={waistInput}
                onChangeText={setWaistInput}
                placeholder={
                  latestRecordedWaistCm != null
                    ? formatLength(latestRecordedWaistCm, unitSystem, { showUnit: false })
                    : unitSystem === 'lbs'
                    ? '32.5'
                    : '82.0'
                }
                placeholderTextColor="#555555"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Neck (below Adam's) *</Text>
              <TextInput
                testID="input-neck"
                style={styles.textInput}
                value={neckInput}
                onChangeText={setNeckInput}
                placeholder={
                  latestRecordedNeckCm != null
                    ? formatLength(latestRecordedNeckCm, unitSystem, { showUnit: false })
                    : unitSystem === 'lbs'
                    ? '15.0'
                    : '38.0'
                }
                placeholderTextColor="#555555"
                keyboardType="numeric"
              />
            </View>

            {gender === 'female' && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Hips (widest) *</Text>
                <TextInput
                  testID="input-hip"
                  style={styles.textInput}
                  value={hipInput}
                  onChangeText={setHipInput}
                  placeholder={
                    latestRecordedHipCm != null
                      ? formatLength(latestRecordedHipCm, unitSystem, { showUnit: false })
                      : unitSystem === 'lbs'
                      ? '36.0'
                      : '92.0'
                  }
                  placeholderTextColor="#555555"
                  keyboardType="numeric"
                />
              </View>
            )}
          </View>

          {/* Secondary Limb Circumferences */}
          <Text style={styles.subSectionTitle}>
            LIMB MEASUREMENTS ({lenUnit.toUpperCase()})
          </Text>

          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Arm / Bicep</Text>
              <TextInput
                testID="input-bicep"
                style={styles.textInput}
                value={bicepInput}
                onChangeText={setBicepInput}
                placeholder={unitSystem === 'lbs' ? '15.0' : '38.0'}
                placeholderTextColor="#555555"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Chest</Text>
              <TextInput
                testID="input-chest"
                style={styles.textInput}
                value={chestInput}
                onChangeText={setChestInput}
                placeholder={unitSystem === 'lbs' ? '41.0' : '104.0'}
                placeholderTextColor="#555555"
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Thigh</Text>
              <TextInput
                testID="input-thigh"
                style={styles.textInput}
                value={thighInput}
                onChangeText={setThighInput}
                placeholder={unitSystem === 'lbs' ? '24.0' : '61.0'}
                placeholderTextColor="#555555"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Calf</Text>
              <TextInput
                testID="input-calf"
                style={styles.textInput}
                value={calfInput}
                onChangeText={setCalfInput}
                placeholder={unitSystem === 'lbs' ? '15.5' : '39.0'}
                placeholderTextColor="#555555"
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Save Button */}
          <TouchableOpacity
            testID="save-metric-btn"
            style={styles.saveBtn}
            onPress={handleSaveMetric}
          >
            <Text style={styles.saveBtnText}>Save Anthropometry Entry ✓</Text>
          </TouchableOpacity>
        </View>

        {/* 3. Historical Logs Section */}
        <View style={styles.historySection}>
          <Text style={styles.sectionTitle}>
            HISTORICAL LOGS ({metricsHistory.length})
          </Text>

          {loading ? (
            <ActivityIndicator size="small" color="#00E676" />
          ) : metricsHistory.length === 0 ? (
            <View style={styles.emptyCard} testID="history-empty-card">
              <Text style={styles.emptyCardText}>
                No body measurements recorded yet. Enter your weight and tape
                measurements above.
              </Text>
            </View>
          ) : (
            metricsHistory.map((m, index) => {
              const effectiveRowBf =
                m.navy_body_fat ??
                metricsHistory
                  .slice(index + 1)
                  .find(
                    (prev) =>
                      prev.navy_body_fat != null &&
                      prev.navy_body_fat > 0
                  )?.navy_body_fat ??
                null;

              const effectiveRowWeight =
                m.bodyweight != null && m.bodyweight > 0
                  ? m.bodyweight
                  : metricsHistory
                      .slice(index + 1)
                      .find(
                        (prev) =>
                          prev.bodyweight != null &&
                          prev.bodyweight > 0
                      )?.bodyweight ?? null;

              const elbmKg =
                effectiveRowWeight != null && effectiveRowBf != null
                  ? calculateEstimatedLeanBodyMass(
                      effectiveRowWeight,
                      effectiveRowBf
                    )
                  : null;

              return (
                <View
                  key={m.id}
                  style={styles.historyRowCard}
                  testID={`history-item-${m.id}`}
                >
                  <View style={styles.historyRowLeft}>
                    <Text style={styles.historyDate}>{m.date}</Text>
                    <Text style={styles.historyWeight}>
                      {m.bodyweight != null && m.bodyweight > 0
                        ? formatWeight(m.bodyweight, unitSystem)
                        : effectiveRowWeight != null
                        ? `${formatWeight(effectiveRowWeight, unitSystem)} [last]`
                        : '—'}
                    </Text>
                    <View style={styles.historyPillRow}>
                      {effectiveRowBf != null && (
                        <View style={styles.historyNavyPill}>
                          <Text style={styles.historyNavyPillText}>
                            Navy: {effectiveRowBf.toFixed(1)}%
                          </Text>
                        </View>
                      )}
                      {elbmKg != null && (
                        <View
                          style={styles.historyElbmPill}
                          testID={`history-elbm-pill-${m.id}`}
                        >
                          <Text style={styles.historyElbmPillText}>
                            eLBM: {formatWeight(elbmKg, unitSystem)}
                          </Text>
                        </View>
                      )}
                      {m.body_fat_manual != null && (
                        <View style={styles.historyManualPill}>
                          <Text style={styles.historyManualPillText}>
                            Manual: {m.body_fat_manual.toFixed(1)}%
                          </Text>
                        </View>
                      )}
                    </View>
                  {/* Tape measurement subtext */}
                  {(m.waist_cm != null || m.bicep_cm != null) && (
                    <Text style={styles.historyTapeSubtext}>
                      {m.waist_cm != null
                        ? `Waist: ${formatLength(m.waist_cm, unitSystem)}  `
                        : ''}
                      {m.neck_cm != null
                        ? `Neck: ${formatLength(m.neck_cm, unitSystem)}  `
                        : ''}
                      {m.bicep_cm != null
                        ? `Arm: ${formatLength(m.bicep_cm, unitSystem)}`
                        : ''}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  testID={`delete-metric-${m.id}`}
                  style={styles.deleteBtn}
                  onPress={() => handleDeleteMetric(m.id, m.date)}
                >
                  <Text style={styles.deleteBtnText}>🗑</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0A0A0A',
    flex: 1,
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  headerSubtitle: {
    color: '#00E676',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  actionBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  closeBtn: {
    backgroundColor: '#1C1C1E',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#AAAAAA',
    fontSize: 16,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  statusToast: {
    backgroundColor: '#14291B',
    borderColor: '#00E676',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    alignItems: 'center',
  },
  statusToastText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '700',
  },
  rollingBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#141414',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#262626',
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  rollingItem: {
    alignItems: 'center',
    flex: 1,
  },
  rollingDivider: {
    width: 1,
    backgroundColor: '#262626',
    marginVertical: 2,
  },
  rollingLabel: {
    color: '#777777',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  rollingValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  card: {
    backgroundColor: '#141414',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    padding: 14,
    marginBottom: 16,
  },
  cardHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  subSectionTitle: {
    color: '#888888',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 10,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  inputGroup: {
    flex: 1,
    marginBottom: 8,
  },
  inputLabel: {
    color: '#999999',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333333',
    color: '#FFFFFF',
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  primaryInput: {
    borderColor: '#00E676',
    fontWeight: '700',
  },
  navyEstimateCard: {
    backgroundColor: '#0F1E14',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#194A27',
    padding: 10,
    marginVertical: 8,
  },
  navyEstimateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navyEstimateTitle: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  navyEstimateStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
  },
  navyStatItem: {
    flex: 1,
  },
  navyStatLabel: {
    color: '#88B896',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  navyStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#194A27',
    marginHorizontal: 12,
  },
  navyEstimateValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  navyEstimateElbmValue: {
    color: '#10B981',
    fontSize: 16,
    fontWeight: '800',
  },
  navyEstimateSubtext: {
    color: '#88B896',
    fontSize: 11,
    marginTop: 4,
    lineHeight: 14,
  },
  saveBtn: {
    backgroundColor: '#00E676',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  saveBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  historySection: {
    marginTop: 4,
  },
  sectionTitle: {
    color: '#777777',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  emptyCard: {
    backgroundColor: '#141414',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#242424',
    padding: 20,
    alignItems: 'center',
  },
  emptyCardText: {
    color: '#777777',
    fontSize: 12,
    textAlign: 'center',
  },
  historyRowCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222222',
    padding: 12,
    marginBottom: 8,
  },
  historyRowLeft: {
    flex: 1,
  },
  historyDate: {
    color: '#888888',
    fontSize: 11,
    fontWeight: '600',
  },
  historyWeight: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    marginVertical: 2,
  },
  historyPillRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
    marginBottom: 2,
  },
  historyNavyPill: {
    backgroundColor: '#14291B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  historyNavyPillText: {
    color: '#00E676',
    fontSize: 10,
    fontWeight: '700',
  },
  historyElbmPill: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  historyElbmPillText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '700',
  },
  historyManualPill: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  historyManualPillText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700',
  },
  historyTapeSubtext: {
    color: '#666666',
    fontSize: 10,
    marginTop: 2,
  },
  deleteBtn: {
    padding: 8,
  },
  deleteBtnText: {
    fontSize: 16,
  },
});
