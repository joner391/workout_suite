import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  LayoutChangeEvent,
  useWindowDimensions,
} from 'react-native';
import Svg, {
  Rect,
  Line,
  Path,
  Circle,
  Text as SvgText,
  G,
} from 'react-native-svg';
import { parseIsoDateToMs } from '../../core/math/navyBodyFat';
import { Program, ProgramBlock } from '../../core/types';

/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling algorithm.
 * Reduces raw data point density while strictly preserving local extrema, peaks, and troughs.
 */
export function downsampleLTTB(data: ChartDataPoint[], threshold: number): ChartDataPoint[] {
  if (data.length <= threshold || threshold < 3) {
    return data;
  }

  const sampled: ChartDataPoint[] = [];
  const every = (data.length - 2) / (threshold - 2);

  let a = 0;
  sampled.push(data[a]);

  for (let i = 0; i < threshold - 2; i++) {
    let avgX = 0;
    let avgY = 0;
    const avgRangeStart = Math.floor((i + 1) * every) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * every) + 1, data.length);
    const avgRangeLength = avgRangeEnd - avgRangeStart;

    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += parseIsoDateToMs(data[j].date);
      avgY += data[j].value;
    }
    avgX /= (avgRangeLength || 1);
    avgY /= (avgRangeLength || 1);

    const rangeOffs = Math.floor(i * every) + 1;
    const rangeTo = Math.min(Math.floor((i + 1) * every) + 1, data.length);

    const pointAX = parseIsoDateToMs(data[a].date);
    const pointAY = data[a].value;

    let maxArea = -1;
    let maxAreaPointIdx = rangeOffs;

    for (let j = rangeOffs; j < rangeTo; j++) {
      const currentX = parseIsoDateToMs(data[j].date);
      const currentY = data[j].value;

      const area = Math.abs(
        (pointAX - avgX) * (currentY - pointAY) - (pointAX - currentX) * (avgY - pointAY)
      ) * 0.5;

      if (area > maxArea) {
        maxArea = area;
        maxAreaPointIdx = j;
      }
    }

    sampled.push(data[maxAreaPointIdx]);
    a = maxAreaPointIdx;
  }

  sampled.push(data[data.length - 1]);
  return sampled;
}

export interface ChartDataPoint {
  date: string; // ISO8601 YYYY-MM-DD
  value: number;
}

export interface ChartSeries {
  id: string;
  name: string;
  color: string;
  data: ChartDataPoint[];
  strokeWidth?: number;
  strokeDasharray?: string;
  dotRadius?: number;
}

export interface ChartBarPoint {
  date: string; // ISO8601 YYYY-MM-DD
  value: number;
  label?: string;
  color?: string;
}

export interface ProgramEraInfo {
  id: string;
  program_id: string;
  start_date: string;
  end_date: string | null;
  program?: {
    id: string;
    name: string;
    color_hex: string;
  };
}

export interface ProgramEraShadedChartProps {
  series?: ChartSeries[];
  bars?: ChartBarPoint[];
  programEras?: ProgramEraInfo[];
  yAxisUnit?: string;
  height?: number;
  emptyMessage?: string;
  formatValue?: (val: number) => string;
}

export const ProgramEraShadedChart: React.FC<ProgramEraShadedChartProps> = ({
  series = [],
  bars = [],
  programEras = [],
  yAxisUnit = '',
  height = 220,
  emptyMessage = 'No data available for this timeframe.',
  formatValue = (v) => v.toFixed(1),
}) => {
  const { width: windowWidth } = useWindowDimensions();
  const responsiveInitialWidth = Math.max(280, Math.min(windowWidth ? windowWidth - 32 : 340, 600));
  const [containerWidth, setContainerWidth] = useState<number>(responsiveInitialWidth);
  const [selectedPoint, setSelectedPoint] = useState<{
    date: string;
    value: number;
    seriesName: string;
    color: string;
    eraName?: string;
    eraColor?: string;
  } | null>(null);

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - containerWidth) > 2) {
      setContainerWidth(w);
    }
  };

  // Downsample line series data if points > 60 using LTTB (Phase 5)
  const downsampledSeries = useMemo(() => {
    return series.map((s) => ({
      ...s,
      data: s.data.length > 60 ? downsampleLTTB(s.data, 60) : s.data,
    }));
  }, [series]);

  // 1. Gather all date and value data points
  const allDatesMs: number[] = [];
  const allValues: number[] = [];

  for (const s of downsampledSeries) {
    for (const pt of s.data) {
      const ms = parseIsoDateToMs(pt.date);
      if (!isNaN(ms) && !isNaN(pt.value)) {
        allDatesMs.push(ms);
        allValues.push(pt.value);
      }
    }
  }

  for (const b of bars) {
    const ms = parseIsoDateToMs(b.date);
    if (!isNaN(ms) && !isNaN(b.value)) {
      allDatesMs.push(ms);
      allValues.push(b.value);
    }
  }

  // Check if we have valid data
  if (allDatesMs.length === 0) {
    return (
      <View
        testID="chart-empty-state"
        style={[styles.emptyContainer, { height }]}
        onLayout={handleLayout}
      >
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.emptyText}>{emptyMessage}</Text>
      </View>
    );
  }

  // 2. Chart dimensions and coordinates
  const padding = { top: 20, right: 16, bottom: 28, left: 46 };
  const plotWidth = Math.max(100, containerWidth - padding.left - padding.right);
  const plotHeight = Math.max(80, height - padding.top - padding.bottom);

  // Time boundaries (ensure at least 1 day range)
  let minDateMs = Math.min(...allDatesMs);
  let maxDateMs = Math.max(...allDatesMs);
  if (minDateMs === maxDateMs) {
    minDateMs -= 86_400_000 * 3;
    maxDateMs += 86_400_000 * 3;
  }

  // Value boundaries with 8% padding
  let rawMinVal = Math.min(...allValues);
  let rawMaxVal = Math.max(...allValues);
  if (bars.length > 0) {
    rawMinVal = Math.min(0, rawMinVal); // Volume bars should anchor to 0
  }
  const valRange = rawMaxVal - rawMinVal || 10;
  const minVal = Math.max(0, rawMinVal - valRange * 0.08);
  const maxVal = rawMaxVal + valRange * 0.08;

  const getX = (dateMs: number) => {
    const clamped = Math.max(minDateMs, Math.min(maxDateMs, dateMs));
    const ratio = (clamped - minDateMs) / (maxDateMs - minDateMs);
    return padding.left + ratio * plotWidth;
  };

  const getY = (val: number) => {
    const clamped = Math.max(minVal, Math.min(maxVal, val));
    const ratio = (clamped - minVal) / (maxVal - minVal);
    return padding.top + plotHeight - ratio * plotHeight;
  };

  // Helper to find active program era for a given timestamp
  const getEraForDate = (dateMs: number) => {
    for (const era of programEras) {
      const sMs = parseIsoDateToMs(era.start_date);
      const eMs = era.end_date ? parseIsoDateToMs(era.end_date) : Date.now();
      if (dateMs >= sMs && dateMs <= eMs) {
        return era.program;
      }
    }
    return undefined;
  };

  // 3. Generate horizontal gridlines (4 steps)
  const gridLines = [];
  const numGridSteps = 4;
  for (let i = 0; i <= numGridSteps; i++) {
    const stepVal = minVal + (i / numGridSteps) * (maxVal - minVal);
    const yPos = getY(stepVal);
    gridLines.push({
      y: yPos,
      value: stepVal,
    });
  }

  // 4. Generate X-axis date markers
  const dateMarkers = [];
  const numDateMarkers = 3;
  for (let i = 0; i < numDateMarkers; i++) {
    const markerMs = minDateMs + (i / (numDateMarkers - 1)) * (maxDateMs - minDateMs);
    const d = new Date(markerMs);
    const monthStr = d.toLocaleDateString('en-US', { month: 'short' });
    const dayStr = d.getDate();
    dateMarkers.push({
      x: getX(markerMs),
      label: `${monthStr} ${dayStr}`,
    });
  }

  return (
    <View
      testID="program-era-shaded-chart"
      style={styles.container}
      onLayout={handleLayout}
    >
      {/* Active Callout Overlay (if point selected) */}
      {selectedPoint && (
        <View style={styles.calloutCard} testID="chart-callout-card">
          <View style={styles.calloutHeader}>
            <View
              style={[styles.calloutDot, { backgroundColor: selectedPoint.color }]}
            />
            <Text style={styles.calloutSeriesName}>
              {selectedPoint.seriesName}: {formatValue(selectedPoint.value)}{' '}
              {yAxisUnit}
            </Text>
          </View>
          <View style={styles.calloutFooter}>
            <Text style={styles.calloutDate}>{selectedPoint.date}</Text>
            {selectedPoint.eraName && (
              <View
                style={[
                  styles.calloutEraBadge,
                  {
                    backgroundColor:
                      selectedPoint.eraColor || 'rgba(0, 230, 118, 0.2)',
                  },
                ]}
              >
                <Text style={styles.calloutEraText}>{selectedPoint.eraName}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* SVG Canvas */}
      <Svg width={containerWidth} height={height} style={styles.svgCanvas}>
        {/* ================================================================= */}
        {/* 1. PROGRAM ERA VERTICAL BACKGROUND SHADED BANDS                   */}
        {/* ================================================================= */}
        {programEras.map((era) => {
          const startMs = parseIsoDateToMs(era.start_date);
          const endMs = era.end_date
            ? parseIsoDateToMs(era.end_date)
            : maxDateMs;

          if (isNaN(startMs)) return null;
          if (endMs < minDateMs || startMs > maxDateMs) return null;

          const clampedStartMs = Math.max(minDateMs, startMs);
          const clampedEndMs = Math.min(maxDateMs, endMs);

          const xStart = getX(clampedStartMs);
          const xEnd = getX(clampedEndMs);
          const bandWidth = Math.max(3, xEnd - xStart);
          const color = era.program?.color_hex || '#3B82F6';

          return (
            <G key={`era-band-${era.id}`}>
              {/* Semi-transparent vertical background span */}
              <Rect
                x={xStart}
                y={padding.top}
                width={bandWidth}
                height={plotHeight}
                fill={color}
                opacity={0.16}
              />
              {/* Top Accent Bar */}
              <Line
                x1={xStart}
                y1={padding.top}
                x2={xStart + bandWidth}
                y2={padding.top}
                stroke={color}
                strokeWidth={2}
                opacity={0.8}
              />
            </G>
          );
        })}

        {/* ================================================================= */}
        {/* 2. HORIZONTAL GRIDLINES & Y-AXIS LABELS                           */}
        {/* ================================================================= */}
        {gridLines.map((line, idx) => (
          <G key={`grid-line-${idx}`}>
            <Line
              x1={padding.left}
              y1={line.y}
              x2={padding.left + plotWidth}
              y2={line.y}
              stroke="#2A2A2A"
              strokeDasharray="3,3"
              strokeWidth={1}
            />
            <SvgText
              x={padding.left - 6}
              y={line.y + 3}
              fill="#888888"
              fontSize={9}
              fontWeight="600"
              textAnchor="end"
            >
              {Math.round(line.value)}
            </SvgText>
          </G>
        ))}

        {/* Y-Axis Unit Header */}
        {yAxisUnit !== '' && (
          <SvgText
            x={padding.left}
            y={padding.top - 7}
            fill="#777777"
            fontSize={9}
            fontWeight="bold"
            textAnchor="start"
          >
            {yAxisUnit}
          </SvgText>
        )}

        {/* ================================================================= */}
        {/* 3. BAR SERIES (e.g. Weekly Volume Tonnage)                        */}
        {/* ================================================================= */}
        {bars.map((bar, idx) => {
          const ms = parseIsoDateToMs(bar.date);
          if (isNaN(ms)) return null;
          const cx = getX(ms);
          const cy = getY(bar.value);
          const barHeight = padding.top + plotHeight - cy;
          const barWidth = Math.max(6, Math.min(22, (plotWidth / bars.length) * 0.6));
          const color = bar.color || '#00E676';

          return (
            <Rect
              key={`bar-${idx}`}
              x={cx - barWidth / 2}
              y={cy}
              width={barWidth}
              height={Math.max(2, barHeight)}
              fill={color}
              rx={2}
              opacity={0.85}
              onPress={() => {
                const era = getEraForDate(ms);
                setSelectedPoint({
                  date: bar.date,
                  value: bar.value,
                  seriesName: bar.label || 'Volume',
                  color,
                  eraName: era?.name,
                  eraColor: era?.color_hex,
                });
              }}
            />
          );
        })}

        {/* ================================================================= */}
        {/* 4. LINE SERIES & SCATTER POINTS                                   */}
        {/* ================================================================= */}
        {downsampledSeries.map((s) => {
          if (s.data.length === 0) return null;

          // Build SVG path
          const pathCommands: string[] = [];
          s.data.forEach((pt, idx) => {
            const ms = parseIsoDateToMs(pt.date);
            if (isNaN(ms)) return;
            const px = getX(ms);
            const py = getY(pt.value);
            if (idx === 0) {
              pathCommands.push(`M ${px} ${py}`);
            } else {
              pathCommands.push(`L ${px} ${py}`);
            }
          });

          // Decoupled circle rendering (Phase 5): only render individual SVG circles when points <= 35
          const shouldRenderCircles = s.data.length <= 35;

          return (
            <G key={`series-group-${s.id}`}>
              {/* Continuous Line */}
              {pathCommands.length > 0 && (
                <Path
                  d={pathCommands.join(' ')}
                  stroke={s.color}
                  strokeWidth={s.strokeWidth ?? 2.5}
                  strokeDasharray={s.strokeDasharray}
                  fill="none"
                />
              )}

              {/* Data Point Circles */}
              {shouldRenderCircles
                ? s.data.map((pt, pIdx) => {
                    const ms = parseIsoDateToMs(pt.date);
                    if (isNaN(ms)) return null;
                    const px = getX(ms);
                    const py = getY(pt.value);
                    const isSelected =
                      selectedPoint?.date === pt.date &&
                      selectedPoint?.seriesName === s.name;

                    return (
                      <Circle
                        key={`point-${s.id}-${pIdx}`}
                        cx={px}
                        cy={py}
                        r={isSelected ? 6 : s.dotRadius ?? 3.5}
                        fill={isSelected ? '#FFFFFF' : s.color}
                        stroke={isSelected ? s.color : '#121212'}
                        strokeWidth={isSelected ? 2 : 1}
                        onPress={() => {
                          const era = getEraForDate(ms);
                          setSelectedPoint({
                            date: pt.date,
                            value: pt.value,
                            seriesName: s.name,
                            color: s.color,
                            eraName: era?.name,
                            eraColor: era?.color_hex,
                          });
                        }}
                      />
                    );
                  })
                : selectedPoint &&
                  selectedPoint.seriesName === s.name && (
                    <Circle
                      cx={getX(parseIsoDateToMs(selectedPoint.date))}
                      cy={getY(selectedPoint.value)}
                      r={6}
                      fill="#FFFFFF"
                      stroke={selectedPoint.color}
                      strokeWidth={2}
                    />
                  )}
            </G>
          );
        })}

        {/* ================================================================= */}
        {/* 5. X-AXIS LABELS                                                  */}
        {/* ================================================================= */}
        {dateMarkers.map((marker, idx) => (
          <SvgText
            key={`date-marker-${idx}`}
            x={marker.x}
            y={height - 8}
            fill="#888888"
            fontSize={9}
            fontWeight="500"
            textAnchor={idx === 0 ? 'start' : idx === dateMarkers.length - 1 ? 'end' : 'middle'}
          >
            {marker.label}
          </SvgText>
        ))}
      </Svg>

      {/* Program Era Legend Bar */}
      {programEras.length > 0 && (
        <View style={styles.legendRow}>
          <Text style={styles.legendLabel}>PROGRAM ERAS:</Text>
          <View style={styles.legendErasContainer}>
            {programEras.map((era) => (
              <View key={`legend-era-${era.id}`} style={styles.legendEraChip}>
                <View
                  style={[
                    styles.legendEraSwatch,
                    { backgroundColor: era.program?.color_hex || '#3B82F6' },
                  ]}
                />
                <Text style={styles.legendEraText}>
                  {era.program?.name || 'Program'}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#121212',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    paddingVertical: 8,
    marginVertical: 4,
    overflow: 'hidden',
  },
  svgCanvas: {
    alignSelf: 'center',
  },
  emptyContainer: {
    backgroundColor: '#161616',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  emptyText: {
    color: '#888888',
    fontSize: 13,
    textAlign: 'center',
  },
  calloutCard: {
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 8,
    backgroundColor: '#1F1F1F',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333333',
  },
  calloutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  calloutDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  calloutSeriesName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  calloutFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calloutDate: {
    color: '#AAAAAA',
    fontSize: 11,
  },
  calloutEraBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  calloutEraText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1F1F1F',
    flexWrap: 'wrap',
    gap: 6,
  },
  legendLabel: {
    color: '#666666',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  legendErasContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendEraChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendEraSwatch: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  legendEraText: {
    color: '#CCCCCC',
    fontSize: 11,
  },
});
