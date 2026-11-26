const GUEST_SESSION_KEY = "podbrew_guest_session_token";
const GUEST_NAME_KEY = "podbrew_guest_display_name";

const ADJECTIVES = [
  "Swift", "Amber", "Neon", "Cosmic", "Silver", "Jade", "Crimson", "Azure",
  "Golden", "Velvet", "Onyx", "Coral", "Indigo", "Sage", "Russet", "Ivory",
  "Cerulean", "Tawny", "Vivid", "Misty"
];
const NOUNS = [
  "Fox", "Wolf", "Panda", "Raven", "Hawk", "Lynx", "Otter", "Crane",
  "Badger", "Falcon", "Heron", "Jaguar", "Mink", "Osprey", "Quail", "Robin",
  "Sparrow", "Thrush", "Viper", "Wren"
];

function generateDisplayName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

function getOrCreateToken(): string {
  const stored = localStorage.getItem(GUEST_SESSION_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.token) return parsed.token;
    } catch {
      if (typeof stored === "string" && !stored.startsWith("{")) return stored;
    }
  }
  const token = crypto.randomUUID();
  localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify({ token, createdAt: Date.now() }));
  return token;
}

export interface GuestIdentity {
  id: string;
  displayName: string;
}

export function getGuestIdentity(): GuestIdentity {
  const id = getOrCreateToken();
  let displayName = localStorage.getItem(GUEST_NAME_KEY);
  if (!displayName) {
    displayName = generateDisplayName();
    localStorage.setItem(GUEST_NAME_KEY, displayName);
  }
  return { id, displayName };
}

export function setGuestDisplayName(name: string): void {
  localStorage.setItem(GUEST_NAME_KEY, name.trim());
}

export function getGuestDisplayName(): string {
  return localStorage.getItem(GUEST_NAME_KEY) || generateDisplayName();
}

export function getGuestToken(): string {
  return getOrCreateToken();
}
