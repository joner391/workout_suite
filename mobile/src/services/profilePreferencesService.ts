import { UserProfile } from '../core/types';

export type ProfileEditorSection = 'training' | 'details' | 'equipment' | 'programs';

/** Focused editors must preserve fields owned by other editors and onboarding. */
export function mergeProfileEditorChanges(existing: UserProfile | null, draft: UserProfile, section: ProfileEditorSection, hasActiveProgram: boolean): UserProfile {
  const profile = { ...(existing ?? draft), updated_at: draft.updated_at };
  if (section === 'details') {
    profile.gender = draft.gender; profile.height_cm = draft.height_cm;
    profile.birthdate = draft.birthdate; profile.experience_level = draft.experience_level;
  } else if (section === 'equipment') {
    profile.equipment_access = draft.equipment_access;
  } else if (section === 'training') {
    profile.training_mentality = draft.training_mentality;
    profile.training_enjoyment = draft.training_enjoyment; profile.intensity_style = draft.intensity_style;
    profile.primary_goal = draft.primary_goal; profile.secondary_goals = draft.secondary_goals;
    profile.preferred_days_per_week = draft.preferred_days_per_week;
    profile.preferred_session_duration_mins = draft.preferred_session_duration_mins;
    profile.pending_meso_mood = hasActiveProgram || !!existing?.pending_meso_mood;
  }
  return profile;
}
