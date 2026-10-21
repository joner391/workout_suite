/**
 * Workout Suite — Biomechanical & Preference Formatters
 *
 * Implements Step 9.4: Biomechanical Badges & Preference Sentiment UI
 * Visual styling rules for ROM tiers, axial loading classes, regional muscle biases,
 * and exercise planner sentiment pills in accordance with pure OLED high-contrast conventions.
 */

import { AxialLoading, ExerciseSentiment, RomTier } from '../../core/types';

export interface BadgeStyle {
  bg: string;
  border: string;
  text: string;
}

/**
 * Formats ROM Tier enum to user-facing badge text.
 */
export function formatRomTier(rom?: RomTier | null): string {
  switch (rom) {
    case 'deep_stretch':
      return 'Deep Stretch';
    case 'shortened_restricted':
      return 'Restricted';
    case 'standard_full':
    default:
      return 'Full ROM';
  }
}

/**
 * Returns color tokens for ROM Tier badge.
 */
export function getRomTierBadgeStyle(rom?: RomTier | null): BadgeStyle {
  switch (rom) {
    case 'deep_stretch':
      return { bg: '#251433', border: '#9C27B0', text: '#E1BEE7' };
    case 'shortened_restricted':
      return { bg: '#2E1E0F', border: '#FF9800', text: '#FFE0B2' };
    case 'standard_full':
    default:
      return { bg: '#0D223A', border: '#2196F3', text: '#BBDEFB' };
  }
}

/**
 * Formats Axial Loading enum to user-facing badge text.
 */
export function formatAxialLoading(axial?: AxialLoading | null): string {
  switch (axial) {
    case 'high':
      return 'Axial: High';
    case 'moderate':
      return 'Axial: Mod';
    case 'low':
      return 'Axial: Low';
    case 'none':
    default:
      return 'Axial: None';
  }
}

/**
 * Returns color tokens for Axial Loading badge.
 */
export function getAxialLoadingBadgeStyle(axial?: AxialLoading | null): BadgeStyle {
  switch (axial) {
    case 'high':
      return { bg: '#331414', border: '#F44336', text: '#FFCDD2' };
    case 'moderate':
      return { bg: '#332810', border: '#FFC107', text: '#FFF9C4' };
    case 'low':
      return { bg: '#142E1F', border: '#4CAF50', text: '#C8E6C9' };
    case 'none':
    default:
      return { bg: '#1E1E24', border: '#52525B', text: '#A1A1AA' };
  }
}

/**
 * Formats snake_case muscle bias identifiers to human-readable anatomical chips.
 */
export function formatMuscleBias(bias: string): string {
  const dictionary: Record<string, string> = {
    upper_clavicular: 'Upper Chest',
    mid_sternal: 'Mid Sternal',
    lower_costal: 'Lower Chest',
    long_head: 'Long Head',
    short_head: 'Short Head',
    lateral_head: 'Lateral Head',
    medial_head: 'Medial Head',
    iliac: 'Iliac Lats',
    thoracic: 'Thoracic Lats',
    lumbar: 'Lumbar Lats',
    stretched: 'Deep Stretch',
    shortened: 'Shortened Peak',
  };

  if (dictionary[bias]) {
    return dictionary[bias];
  }

  // Fallback: title-case snake_case string
  return bias
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Returns color tokens for Planner Sentiment Pill row items.
 */
export function getSentimentPillStyle(
  sentiment: ExerciseSentiment,
  isActive: boolean
): BadgeStyle {
  if (!isActive) {
    return {
      bg: '#18181B',
      border: '#27272A',
      text: '#71717A',
    };
  }

  switch (sentiment) {
    case 'liked':
      return { bg: '#132E1C', border: '#00E676', text: '#00E676' };
    case 'neutral':
      return { bg: '#27272A', border: '#A1A1AA', text: '#FAFAFA' };
    case 'disliked':
      return { bg: '#331414', border: '#FF5252', text: '#FF5252' };
    case 'blacklisted':
      return { bg: '#3D0A0A', border: '#D50000', text: '#FF8A80' };
  }
}
