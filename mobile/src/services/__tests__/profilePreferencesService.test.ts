import { mergeProfileEditorChanges } from '../profilePreferencesService';
import { UserProfile } from '../../core/types';

const existing: UserProfile = {
  id: 'athlete', gender: 'female', birthdate: '1990-03-04', height_cm: 170,
  training_mentality: 'precision', primary_goal: 'strength', secondary_goals: ['hypertrophy'],
  preferred_days_per_week: 4, preferred_session_duration_mins: 60, equipment_access: 'garage_gym',
  experience_level: 'advanced', has_axial_fatigue_sensitivity: true, is_caloric_deficit: true,
  created_at: '2025-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const draft: UserProfile = { ...existing, gender: 'male', height_cm: 180, birthdate: null, training_mentality: 'fury', primary_goal: 'hypertrophy', preferred_days_per_week: 3, preferred_session_duration_mins: 45, equipment_access: 'commercial_gym', experience_level: 'beginner', has_axial_fatigue_sensitivity: false, is_caloric_deficit: false, created_at: '2026-10-21T00:00:00Z', updated_at: '2026-10-21T00:00:00Z' };

test('saving training preferences stages the next cycle while preserving demographics, equipment, and onboarding flags', () => {
  const result = mergeProfileEditorChanges(existing, draft, 'training', true);
  expect(result).toMatchObject({ training_mentality: 'fury', preferred_days_per_week: 3, pending_meso_mood: true, gender: 'female', height_cm: 170, birthdate: existing.birthdate, equipment_access: 'garage_gym', experience_level: 'advanced', has_axial_fatigue_sensitivity: true, is_caloric_deficit: true, created_at: existing.created_at });
  expect(existing.training_mentality).toBe('precision');
});

test('saving personal details does not overwrite training preferences or pending changes', () => {
  const result = mergeProfileEditorChanges({ ...existing, pending_meso_mood: true }, draft, 'details', true);
  expect(result).toMatchObject({ gender: 'male', height_cm: 180, birthdate: null, experience_level: 'beginner', training_mentality: 'precision', primary_goal: 'strength', equipment_access: 'garage_gym', pending_meso_mood: true });
});

test('saving equipment access changes only the owned field and update timestamp', () => {
  expect(mergeProfileEditorChanges(existing, draft, 'equipment', false)).toEqual({ ...existing, equipment_access: 'commercial_gym', updated_at: draft.updated_at });
});

test('a first profile can be saved without claiming changes are staged for an active program', () => {
  expect(mergeProfileEditorChanges(null, draft, 'training', false)).toEqual({ ...draft, pending_meso_mood: false });
});
