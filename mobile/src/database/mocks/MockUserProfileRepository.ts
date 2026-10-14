import { IUserProfileRepository } from '../../domain/repositories/IUserProfileRepository';
import { UserProfile } from '../../core/types';

/**
 * In-memory mock implementation of IUserProfileRepository for testing.
 */
export class MockUserProfileRepository implements IUserProfileRepository {
  public profiles: Map<string, UserProfile> = new Map();

  public clear(): void {
    this.profiles.clear();
  }

  async getProfile(): Promise<UserProfile | null> {
    const list = Array.from(this.profiles.values()).sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at)
    );
    return list.length > 0 ? { ...list[0] } : null;
  }

  async findById(id: string): Promise<UserProfile | null> {
    const p = this.profiles.get(id);
    return p ? { ...p } : null;
  }

  async saveProfile(profile: UserProfile): Promise<UserProfile> {
    this.profiles.set(profile.id, { ...profile });
    return { ...profile };
  }

  async deleteProfile(id: string): Promise<void> {
    this.profiles.delete(id);
  }

  async hasProfile(): Promise<boolean> {
    return this.profiles.size > 0;
  }
}
