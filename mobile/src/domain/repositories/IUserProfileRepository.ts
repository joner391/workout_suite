import { UserProfile } from '../../core/types';

/**
 * Repository interface for athlete psychological profile, goals, and training constraints.
 */
export interface IUserProfileRepository {
  /**
   * Retrieves the current primary user profile, or null if no profile has been created yet.
   */
  getProfile(): Promise<UserProfile | null>;

  /**
   * Retrieves a specific user profile by its unique identifier.
   */
  findById(id: string): Promise<UserProfile | null>;

  /**
   * Inserts or updates a user profile.
   */
  saveProfile(profile: UserProfile): Promise<UserProfile>;

  /**
   * Deletes a user profile by ID.
   */
  deleteProfile(id: string): Promise<void>;

  /**
   * Returns true if at least one user profile exists in storage.
   */
  hasProfile(): Promise<boolean>;
}
