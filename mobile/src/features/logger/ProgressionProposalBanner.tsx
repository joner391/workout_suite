/**
 * Workout Suite — ProgressionProposalBanner
 *
 * Implements Step 4.4: Interactive Progression Proposal Banner in Active Logger
 * Implements ADR-004: Declarative Condition-Action Schema for Progression Builder
 * Implements ADR-037: Pure Evaluator & DDP Set-Level Proposals
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ProgressionProposal } from '../../core/types';

export interface ProgressionProposalBannerProps {
  proposal: ProgressionProposal | null;
  exerciseName?: string;
  onAccept: (proposal: ProgressionProposal) => void;
  onDismiss: () => void;
}

export const ProgressionProposalBanner: React.FC<ProgressionProposalBannerProps> = ({
  proposal,
  exerciseName,
  onAccept,
  onDismiss,
}) => {
  if (!proposal) {
    return null;
  }

  const isDeload = proposal.isDeload || proposal.actionType === 'TRIGGER_DELOAD';

  return (
    <View
      testID="progression-proposal-banner"
      style={[
        styles.bannerContainer,
        isDeload ? styles.bannerDeload : styles.bannerProgress,
      ]}
    >
      <View style={styles.contentRow}>
        <Text style={styles.icon}>{isDeload ? '🛡️' : '📈'}</Text>
        <View style={styles.textContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.categoryBadge}>
              {isDeload ? 'DELOAD ADVISORY' : 'PROGRESSION PROPOSAL'}
            </Text>
            {exerciseName && (
              <Text style={styles.exerciseNameText}>• {exerciseName}</Text>
            )}
          </View>
          <Text testID="proposal-explanation-text" style={styles.explanationText}>
            {proposal.explanation}
          </Text>

          {/* DDP Set-level preview breakdown */}
          {proposal.setProposals && proposal.setProposals.length > 0 && (
            <View style={styles.ddpSetRow}>
              {proposal.setProposals.map((sp) => (
                <View
                  key={sp.setIndex}
                  style={[
                    styles.ddpSetPill,
                    sp.status === 'increase' && styles.ddpSetPillIncrease,
                  ]}
                >
                  <Text style={styles.ddpSetPillText}>
                    Set {sp.setIndex}: {sp.suggestedWeightKg} kg{' '}
                    {sp.status === 'increase' ? '↑' : '='}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          testID="dismiss-proposal-btn"
          style={styles.dismissBtn}
          onPress={onDismiss}
          activeOpacity={0.7}
        >
          <Text style={styles.dismissBtnText}>Dismiss</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="accept-proposal-btn"
          style={[styles.acceptBtn, isDeload && styles.acceptBtnDeload]}
          onPress={() => onAccept(proposal)}
          activeOpacity={0.8}
        >
          <Text style={styles.acceptBtnText}>
            {isDeload ? 'Apply Deload' : 'Accept Proposal ✓'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bannerContainer: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
  },
  bannerProgress: {
    backgroundColor: '#052E16',
    borderColor: '#22C55E',
  },
  bannerDeload: {
    backgroundColor: '#451A03',
    borderColor: '#F59E0B',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  icon: {
    fontSize: 20,
    marginRight: 10,
    marginTop: 2,
  },
  textContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 2,
  },
  categoryBadge: {
    color: '#86EFAC',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  exerciseNameText: {
    color: '#FAFAFA',
    fontSize: 12,
    fontWeight: '700',
  },
  explanationText: {
    color: '#E4E4E7',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  ddpSetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  ddpSetPill: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ddpSetPillIncrease: {
    borderWidth: 1,
    borderColor: '#22C55E',
  },
  ddpSetPillText: {
    color: '#D4D4D8',
    fontSize: 10,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  dismissBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  dismissBtnText: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
  },
  acceptBtn: {
    backgroundColor: '#22C55E',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  acceptBtnDeload: {
    backgroundColor: '#F59E0B',
  },
  acceptBtnText: {
    color: '#0A0A0A',
    fontSize: 12,
    fontWeight: '800',
  },
});
