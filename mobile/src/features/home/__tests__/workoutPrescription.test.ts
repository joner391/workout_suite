import React from 'react';
import { WorkoutPrescription } from '../WorkoutPrescription';
import { ExercisePrescription } from '../../../services/workoutPreviewService';

function find(tree: React.ReactNode, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any>[] {
  if (!React.isValidElement<any>(tree)) return [];
  const element = tree as React.ReactElement<{ children?: React.ReactNode }>;
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => find(child, predicate))];
}

function row(id: string, groupId: string | null = null): ExercisePrescription {
  return { id, name: id, groupId, summary: '3 × 8–12 · 15 kg · 2 RIR', target: '3 × 8–12', load: '15 kg',
    explanation: '', proposal: null, templateExercise: {} as ExercisePrescription['templateExercise'], bodyweightKg: null, sets: [] };
}

beforeEach(() => {
  jest.spyOn(React, 'useState').mockImplementation(() => [null, jest.fn()] as any);
});
afterEach(() => jest.restoreAllMocks());

test('shows compact prescriptions and keeps a superset together at the Home limit', () => {
  const tree = WorkoutPrescription({ rows: [row('one'), row('two'), row('curl', 'pair'), row('pushdown', 'pair'), row('five')], limit: 3 });
  expect(find(tree, node => node.props.children === 'Superset')).toHaveLength(1);
  for (const name of ['one', 'two', 'curl', 'pushdown']) {
    expect(find(tree, node => node.props.children === name)).toHaveLength(1);
  }
  expect(find(tree, node => node.props.children === 'five')).toHaveLength(0);
  expect(find(tree, node => node.props.children === '3 × 8–12 · 15 kg · 2 RIR')).toHaveLength(4);
  expect(find(tree, node => Array.isArray(node.props.children) && node.props.children.includes(' more exercises · View workout'))[0].props.children).toContain(1);
});

test('keeps progression explanations behind an accessible expandable exercise', () => {
  const planned = { ...row('bench'), explanation: 'Target reps achieved across all sets.' };
  const tree = WorkoutPrescription({ rows: [planned] });
  const button = find(tree, node => node.props.accessibilityRole === 'button')[0];
  expect(button.props.accessibilityState.expanded).toBe(false);
  expect(button.props.accessibilityLabel).toContain('View plan details');
  expect(find(tree, node => node.props.children === planned.explanation)).toHaveLength(0);
  const setExpanded = jest.fn();
  jest.mocked(React.useState).mockImplementation(() => ['bench', setExpanded] as any);
  const expanded = WorkoutPrescription({ rows: [planned] });
  expect(find(expanded, node => node.props.children === planned.explanation)).toHaveLength(1);
  find(expanded, node => node.props.accessibilityRole === 'button')[0].props.onPress();
  expect(setExpanded).toHaveBeenCalledWith(null);
});

test('does not label an orphaned prescription as a superset', () => {
  const tree = WorkoutPrescription({ rows: [row('alone', 'orphan')] });
  expect(find(tree, node => node.props.children === 'Superset')).toHaveLength(0);
});
