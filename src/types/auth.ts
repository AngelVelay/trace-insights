export type AuthMethod = "google" | "local";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  photoUrl?: string;
  method: AuthMethod;
}