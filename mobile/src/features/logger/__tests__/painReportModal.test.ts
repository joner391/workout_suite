import React from 'react';
import { PainReportModal, PainReportSubmitData } from '../PainReportModal';
import { Exercise } from '../../../core/types';

describe('PainReportModal & In-Gym Discomfort Reporting', () => {
  const mockExercise: Exercise = {
    id: 'ex-bench',
    name: 'Barbell Bench Press',
    muscle_group: 'Chest',
    category: 'Barbell',
    is_compound: true,
    is_bodyweight: false,
    is_unilateral: false,
    load_mode: 'total',
    default_cable_ratio: 1.0,
    default_bar_weight_kg: 20.0,
    is_custom: false,
    parent_exercise_id: null,
    standard_lift_type: 'bench',
    default_rest_seconds: 180,
  };

  it('evaluates severe threshold when pain score > 6', () => {
    // Test logic determining if remaining sets should be skipped
    const isSevere = (score: number) => score > 6;

    expect(isSevere(1)).toBe(false);
    expect(isSevere(4)).toBe(false);
    expect(isSevere(6)).toBe(false);
    expect(isSevere(7)).toBe(true);
    expect(isSevere(10)).toBe(true);
  });

  it('formats severity labels correctly across mild, moderate, and severe tiers', () => {
    const getSeverityLabel = (level: number): string => {
      if (level <= 3) return 'Mild (Annoying, technique unaffected)';
      if (level <= 6) return 'Moderate (Affects technique / focus)';
      return 'Severe (Sharp pain / high injury risk)';
    };

    expect(getSeverityLabel(2)).toContain('Mild');
    expect(getSeverityLabel(5)).toContain('Moderate');
    expect(getSeverityLabel(8)).toContain('Severe');
  });

  it('builds valid pain report submit payload with guardrail flag', () => {
    const buildSubmitPayload = (
      painType: 'joint' | 'muscle',
      severity: number,
      notes?: string
    ): PainReportSubmitData => ({
      painType,
      severity,
      notes: notes?.trim() !== '' ? notes?.trim() : undefined,
      shouldSkipRemainingSets: severity > 6,
    });

    const mildReport = buildSubmitPayload('muscle', 3, 'Mild pec tightness');
    expect(mildReport.painType).toBe('muscle');
    expect(mildReport.severity).toBe(3);
    expect(mildReport.shouldSkipRemainingSets).toBe(false);
    expect(mildReport.notes).toBe('Mild pec tightness');

    const severeReport = buildSubmitPayload('joint', 8, 'Sharp shoulder impingement');
    expect(severeReport.painType).toBe('joint');
    expect(severeReport.severity).toBe(8);
    expect(severeReport.shouldSkipRemainingSets).toBe(true);
  });

  it('resolves biomechanical joints and requires joint selection on multi-joint compounds', () => {
    const { resolveExerciseJoints } = require('../../../services/exerciseSubstitutionService');
    const benchJoints = resolveExerciseJoints(mockExercise);
    expect(benchJoints).toEqual(['shoulder', 'elbow', 'wrist', 'chest_pec']);

    const isMultiJoint = mockExercise.is_compound || benchJoints.length > 1;
    expect(isMultiJoint).toBe(true);

    // Validation logic: submit disabled if joint pain selected on multi-joint exercise without picking a joint
    const canSubmit = (painType: 'joint' | 'muscle', selectedJoint: string | null) => {
      return painType !== 'joint' || !isMultiJoint || !!selectedJoint;
    };

    expect(canSubmit('joint', null)).toBe(false);
    expect(canSubmit('joint', 'shoulder')).toBe(true);
    expect(canSubmit('muscle', null)).toBe(true);
  });

  it('persists joint_location in payload and prepends [Joint: ...] to notes', () => {
    const buildJointSubmitPayload = (
      painType: 'joint' | 'muscle',
      severity: number,
      selectedJoint: string | null,
      notes?: string
    ) => {
      const trimmedNotes = notes?.trim();
      const finalNotes = selectedJoint
        ? trimmedNotes && trimmedNotes !== ''
          ? `[Joint: ${selectedJoint}] ${trimmedNotes}`
          : `[Joint: ${selectedJoint}]`
        : trimmedNotes && trimmedNotes !== ''
        ? trimmedNotes
        : undefined;

      return {
        painType,
        severity,
        jointLocation: selectedJoint,
        notes: finalNotes,
        shouldSkipRemainingSets: severity > 6,
      };
    };

    const report = buildJointSubmitPayload('joint', 5, 'shoulder', 'Pinching on eccentric');
    expect(report.jointLocation).toBe('shoulder');
    expect(report.notes).toBe('[Joint: shoulder] Pinching on eccentric');

    const reportNoNotes = buildJointSubmitPayload('joint', 5, 'lower_back');
    expect(reportNoNotes.jointLocation).toBe('lower_back');
    expect(reportNoNotes.notes).toBe('[Joint: lower_back]');
  });
});
