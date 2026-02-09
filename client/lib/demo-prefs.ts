import * as SecureStore from "expo-secure-store";

export type PersistedQuickFilters = {
  free: boolean;
  tonight: boolean;
  highRated: boolean;
};

export type DiscoverSortMode = "soonest" | "toprated" | "distance" | "price";

export type PersistedDiscoverPrefs = {
  sortMode: DiscoverSortMode;
  selectedRailCategory: string;
  userLocation: { latitude: number; longitude: number } | null;
  quickFilters: PersistedQuickFilters;
  dateIso: string | null;
  updatedAt: number;
};

const DISCOVER_PREFS_KEY = "discover_prefs_v1";
const TASTE_PROFILE_KEY = "taste_profile_v1";

const DEFAULT_DISCOVER_PREFS: PersistedDiscoverPrefs = {
  sortMode: "soonest",
  selectedRailCategory: "all",
  userLocation: null,
  quickFilters: {
    free: false,
    tonight: false,
    highRated: false,
  },
  dateIso: null,
  updatedAt: 0,
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidSortMode(value: unknown): value is DiscoverSortMode {
  return value === "soonest" || value === "toprated" || value === "distance" || value === "price";
}

function sanitizeDateIso(rawDate: unknown): string | null {
  if (typeof rawDate !== "string" || !rawDate) return null;
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (parsed.getTime() < startOfToday.getTime()) {
    return null;
  }
  return rawDate;
}

function sanitizeUserLocation(input: unknown): PersistedDiscoverPrefs["userLocation"] {
  if (!isObjectRecord(input)) return null;
  const lat = input.latitude;
  const lng = input.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

function sanitizeQuickFilters(input: unknown): PersistedQuickFilters {
  if (!isObjectRecord(input)) {
    return { ...DEFAULT_DISCOVER_PREFS.quickFilters };
  }
  return {
    free: Boolean(input.free),
    tonight: Boolean(input.tonight),
    highRated: Boolean(input.highRated),
  };
}

function sanitizeDiscoverPrefs(input: unknown): PersistedDiscoverPrefs {
  if (!isObjectRecord(input)) {
    return { ...DEFAULT_DISCOVER_PREFS };
  }

  return {
    sortMode: isValidSortMode(input.sortMode) ? input.sortMode : DEFAULT_DISCOVER_PREFS.sortMode,
    selectedRailCategory:
      typeof input.selectedRailCategory === "string" && input.selectedRailCategory
        ? input.selectedRailCategory
        : DEFAULT_DISCOVER_PREFS.selectedRailCategory,
    userLocation: sanitizeUserLocation(input.userLocation),
    quickFilters: sanitizeQuickFilters(input.quickFilters),
    dateIso: sanitizeDateIso(input.dateIso),
    updatedAt: typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
  };
}

export async function loadDiscoverPrefs(): Promise<PersistedDiscoverPrefs | null> {
  const raw = await SecureStore.getItemAsync(DISCOVER_PREFS_KEY);
  if (!raw) return null;
  try {
    return sanitizeDiscoverPrefs(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveDiscoverPrefs(prefs: PersistedDiscoverPrefs): Promise<void> {
  const payload: PersistedDiscoverPrefs = {
    ...sanitizeDiscoverPrefs(prefs),
    updatedAt: Date.now(),
  };
  await SecureStore.setItemAsync(DISCOVER_PREFS_KEY, JSON.stringify(payload));
}

export async function clearDiscoverPrefs(): Promise<void> {
  await SecureStore.deleteItemAsync(DISCOVER_PREFS_KEY);
}

export async function loadTasteProfilePrefs<T>(): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(TASTE_PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function saveTasteProfilePrefs<T>(profile: T): Promise<void> {
  await SecureStore.setItemAsync(TASTE_PROFILE_KEY, JSON.stringify(profile));
}

export async function clearTasteProfilePrefs(): Promise<void> {
  await SecureStore.deleteItemAsync(TASTE_PROFILE_KEY);
}
