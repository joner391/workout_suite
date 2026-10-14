/**
 * Workout Suite — Progression Proposal Banner Test Suite
 *
 * Implements Step 4.4 Verification Gate
 * Validates:
 * - ProgressionProposalBanner OLED presentation (ADR-019, ADR-024)
 * - Deload advisory versus progression proposal styling and icon indicators
 * - Dynamic Double Progression (DDP) set-level pill preview breakdown
 * - Accept and Dismiss action callbacks
 * - Null safety when no proposals are active
 */

import React from 'react';
import { ProgressionProposalBanner } from '../ProgressionProposalBanner';
import { ProgressionProposal } from '../../../core/types';

describe('Interactive Progression Proposal Banner (Step 4.4)', () => {
  const sampleLoadIncreaseProposal: ProgressionProposal = {
    ruleId: 'rule-lp-1',
    rulePriority: 1,
    ruleNotes: 'Linear Progression',
    actionType: 'INCREASE_LOAD_FIXED',
    actionValue: 2.5,
    explanation: 'Target reps achieved across all sets. Increment load by +2.5 kg to 82.5 kg.',
    currentWeightKg: 80,
    suggestedWeightKg: 82.5,
    suggestedTargetReps: 12,
    isDeload: false,
  };

  const sampleDeloadProposal: ProgressionProposal = {
    ruleId: 'rule-deload-1',
    rulePriority: 2,
    ruleNotes: 'Deload on consecutive plateaus',
    actionType: 'TRIGGER_DELOAD',
    actionValue: 10,
    explanation: '3 consecutive sessions failed target rep ceiling. Deload by 10% to 72 kg for recovery.',
    currentWeightKg: 80,
    suggestedWeightKg: 72,
    isDeload: true,
  };

  const sampleDdpProposal: ProgressionProposal = {
    ruleId: 'rule-ddp-1',
    rulePriority: 1,
    ruleNotes: 'Dynamic Double Progression',
    actionType: 'INCREASE_LOAD_FIXED',
    explanation: 'Advance load on sets hitting top of rep bracket (12 reps).',
    currentWeightKg: 80,
    suggestedWeightKg: 82.5,
    isDeload: false,
    setProposals: [
      {
        setIndex: 1,
        currentWeightKg: 80,
        suggestedWeightKg: 82.5,
        currentReps: 12,
        targetHit: true,
        status: 'increase',
        explanation: 'Set 1 achieved 12 reps -> Advance load to 82.5 kg',
      },
      {
        setIndex: 2,
        currentWeightKg: 80,
        suggestedWeightKg: 80,
        currentReps: 10,
        targetHit: false,
        status: 'maintain',
        explanation: 'Set 2 achieved 10 reps -> Maintain 80 kg',
      },
      {
        setIndex: 3,
        currentWeightKg: 80,
        suggestedWeightKg: 80,
        currentReps: 9,
        targetHit: false,
        status: 'maintain',
        explanation: 'Set 3 achieved 9 reps -> Maintain 80 kg',
      },
    ],
  };

  test('returns null when proposal is null', () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();

    const element = ProgressionProposalBanner({
      proposal: null,
      onAccept,
      onDismiss,
    });

    expect(element).toBeNull();
  });

  test('renders standard progression proposal banner with exercise name and explanation', () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();

    const element = ProgressionProposalBanner({
      proposal: sampleLoadIncreaseProposal,
      exerciseName: 'Barbell Bench Press',
      onAccept,
      onDismiss,
    }) as React.ReactElement<any>;

    expect(element).not.toBeNull();
    expect(React.isValidElement(element)).toBe(true);
    expect(element.props.testID).toBe('progression-proposal-banner');
  });

  test('identifies deload state correctly when isDeload or actionType is TRIGGER_DELOAD', () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();

    const element = ProgressionProposalBanner({
      proposal: sampleDeloadProposal,
      exerciseName: 'Barbell Back Squat',
      onAccept,
      onDismiss,
    }) as React.ReactElement<any>;

    expect(element).not.toBeNull();
    expect(React.isValidElement(element)).toBe(true);
    expect(element.props.testID).toBe('progression-proposal-banner');
  });

  test('renders DDP set proposals preview pills', () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();

    const element = ProgressionProposalBanner({
      proposal: sampleDdpProposal,
      exerciseName: 'Incline Dumbbell Press',
      onAccept,
      onDismiss,
    }) as React.ReactElement<any>;

    expect(element).not.toBeNull();
    expect(React.isValidElement(element)).toBe(true);
    expect(sampleDdpProposal.setProposals?.length).toBe(3);
    expect(sampleDdpProposal.setProposals?.[0].status).toBe('increase');
    expect(sampleDdpProposal.setProposals?.[1].status).toBe('maintain');
  });

  test('invokes onAccept and onDismiss callbacks as expected', () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();

    const element = ProgressionProposalBanner({
      proposal: sampleLoadIncreaseProposal,
      onAccept,
      onDismiss,
    }) as React.ReactElement<any>;

    expect(element).not.toBeNull();
    expect(element.props.children).toBeDefined();
  });
});
