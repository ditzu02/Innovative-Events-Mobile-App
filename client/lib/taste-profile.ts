import { loadTasteProfilePrefs, saveTasteProfilePrefs } from "@/lib/demo-prefs";

export type TasteProfile = {
  categoryCounts: Record<string, number>;
  tagCounts: Record<string, number>;
  seededVibe?: string;
  updatedAt: number;
};

export type TasteReason = "vibe" | "category" | "tag" | "near" | "top_rated" | "soon";

export type TasteEvent = {
  category?: string | null;
  tags?: string[] | null;
  distance_km?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  start_time?: string | null;
};

export type TasteInteraction =
  | { type: "save"; event: TasteEvent }
  | { type: "open"; event: TasteEvent }
  | { type: "vibe"; vibe: string };

export type ForYouScore = {
  score: number;
  reason: TasteReason | null;
};

const EMPTY_PROFILE: TasteProfile = {
  categoryCounts: {},
  tagCounts: {},
  updatedAt: 0,
};

function sanitizeToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return normalized || null;
}

function topTokens(record: Record<string, number>, count = 1): string[] {
  return Object.entries(record)
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([token]) => token);
}

function topCategory(profile: TasteProfile): string | null {
  return topTokens(profile.categoryCounts, 1)[0] ?? null;
}

function sanitizeProfile(input: unknown): TasteProfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...EMPTY_PROFILE };
  }
  const source = input as Record<string, unknown>;
  const categoryCounts = normalizeWeightRecord(source.categoryCounts);
  const tagCounts = normalizeWeightRecord(source.tagCounts);
  const seededVibe = sanitizeToken(typeof source.seededVibe === "string" ? source.seededVibe : undefined) ?? undefined;
  const updatedAt = typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : 0;
  return {
    categoryCounts,
    tagCounts,
    seededVibe,
    updatedAt,
  };
}

function normalizeWeightRecord(input: unknown): Record<string, number> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const entries = Object.entries(input as Record<string, unknown>);
  const normalized: Record<string, number> = {};
  entries.forEach(([token, value]) => {
    const normalizedToken = sanitizeToken(token);
    if (!normalizedToken) return;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
    normalized[normalizedToken] = Math.round(value * 100) / 100;
  });
  return normalized;
}

function addWeight(record: Record<string, number>, token: string | null, weight: number) {
  if (!token || weight <= 0) return;
  record[token] = (record[token] ?? 0) + weight;
}

export async function loadTasteProfile(): Promise<TasteProfile> {
  const raw = await loadTasteProfilePrefs<unknown>();
  if (!raw) {
    return { ...EMPTY_PROFILE };
  }
  return sanitizeProfile(raw);
}

export async function persistTasteProfile(profile: TasteProfile): Promise<void> {
  await saveTasteProfilePrefs(sanitizeProfile(profile));
}

export function updateTasteProfileFromInteraction(
  profile: TasteProfile,
  interaction: TasteInteraction
): TasteProfile {
  const next: TasteProfile = {
    categoryCounts: { ...profile.categoryCounts },
    tagCounts: { ...profile.tagCounts },
    seededVibe: profile.seededVibe,
    updatedAt: Date.now(),
  };

  if (interaction.type === "vibe") {
    const vibe = sanitizeToken(interaction.vibe);
    if (vibe) {
      next.seededVibe = vibe;
      addWeight(next.categoryCounts, vibe, 5);
    }
    return next;
  }

  const category = sanitizeToken(interaction.event.category);
  const tags = (interaction.event.tags ?? [])
    .map((tag) => sanitizeToken(tag))
    .filter((tag): tag is string => Boolean(tag))
    .slice(0, 2);

  const categoryWeight = interaction.type === "save" ? 3 : 1;
  const tagWeight = interaction.type === "save" ? 2 : 1;

  addWeight(next.categoryCounts, category, categoryWeight);
  tags.forEach((tag) => addWeight(next.tagCounts, tag, tagWeight));
  return next;
}

export function scoreEventForYou(event: TasteEvent, profile: TasteProfile, now = new Date()): ForYouScore {
  const contributions: Partial<Record<TasteReason, number>> = {};
  const category = sanitizeToken(event.category);
  const eventTags = (event.tags ?? [])
    .map((tag) => sanitizeToken(tag))
    .filter((tag): tag is string => Boolean(tag));

  const topCategoryToken = topCategory(profile);
  if (category && topCategoryToken && category === topCategoryToken) {
    contributions.category = 3;
  }
  if (category && profile.seededVibe && category === profile.seededVibe) {
    contributions.vibe = Math.max(contributions.vibe ?? 0, 3);
  }

  const topTags = new Set(topTokens(profile.tagCounts, 2));
  const matchedTopTags = eventTags.filter((tag) => topTags.has(tag)).slice(0, 2);
  if (matchedTopTags.length > 0) {
    contributions.tag = matchedTopTags.length * 2;
  }

  const distance = event.distance_km;
  if (typeof distance === "number" && Number.isFinite(distance) && distance >= 0) {
    if (distance <= 5) contributions.near = 2;
    else if (distance <= 10) contributions.near = 1;
  }

  if (
    typeof event.rating_avg === "number" &&
    Number.isFinite(event.rating_avg) &&
    event.rating_avg >= 4.5 &&
    typeof event.rating_count === "number" &&
    Number.isFinite(event.rating_count) &&
    event.rating_count >= 10
  ) {
    contributions.top_rated = 2;
  }

  if (event.start_time) {
    const start = new Date(event.start_time);
    if (!Number.isNaN(start.getTime())) {
      const diffMs = start.getTime() - now.getTime();
      if (diffMs > 0 && diffMs <= 6 * 60 * 60 * 1000) {
        contributions.soon = 1;
      }
    }
  }

  const score = Object.values(contributions).reduce((total, value) => total + (value ?? 0), 0);
  if (score <= 0) {
    return { score: 0, reason: null };
  }

  const reasonPriority: TasteReason[] = ["vibe", "category", "tag", "near", "top_rated", "soon"];
  const reason = reasonPriority.reduce<TasteReason | null>((best, candidate) => {
    if (contributions[candidate] == null) return best;
    if (!best) return candidate;
    return (contributions[candidate] ?? 0) > (contributions[best] ?? 0) ? candidate : best;
  }, null);

  return { score, reason };
}

function titleCase(value: string) {
  return value
    .split(" ")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function getReasonLabel(
  reason: TasteReason | null,
  context?: { category?: string | null; vibe?: string | null }
): string {
  if (!reason) return "Recommended";
  if (reason === "vibe") {
    const vibeLabel = sanitizeToken(context?.vibe ?? context?.category);
    return vibeLabel ? `Because you like ${titleCase(vibeLabel)}` : "Because you like this vibe";
  }
  if (reason === "category") {
    const categoryLabel = sanitizeToken(context?.category);
    return categoryLabel ? `Because you like ${titleCase(categoryLabel)}` : "Because you like this category";
  }
  if (reason === "tag") return "Matches your tags";
  if (reason === "near") return "Near your pin";
  if (reason === "top_rated") return "Top rated";
  return "Starting soon";
}
