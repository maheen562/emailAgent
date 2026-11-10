// The profile is stored in the database once saved. Until then it comes from
// profile.json (personal, git-ignored) or profile.example.json at the repo root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_PROFILE_FILES = ['profile.json', 'profile.example.json'].map((f) => path.join(REPO_ROOT, f));

export function loadProfileFile(files = DEFAULT_PROFILE_FILES) {
  for (const file of files) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return {}; // the agent fills in defaults for anything missing
}

export function createProfileStore({ repo, files }) {
  return {
    get: () => repo.getSetting('profile') ?? loadProfileFile(files),
    save: (profile) => repo.setSetting('profile', profile),
  };
}
