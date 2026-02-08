export type PriceBand = "any" | "free" | "lt25" | "btw25and50" | "gt50";
export type AudienceSegment = "family" | "nightlife" | "professional" | null;

export type DiscoverFilters = {
  date: Date | null;
  categoryId: string | null;
  subcategoryId: string | null;
  tagId: string | null;
  radiusKm: number | null;
  minRating: number | null;
  priceBand: PriceBand;
  venueFeatures: string[];
  audience: AudienceSegment;
};

export type EventForClientFiltering = {
  title?: string | null;
  description?: string | null;
  category?: string | null;
  price?: number | null;
  rating_avg?: number | null;
  tags?: string[] | null;
  location?: {
    name?: string | null;
    features?: unknown;
  } | null;
};

const AUDIENCE_KEYWORDS: Record<Exclude<AudienceSegment, null>, string[]> = {
  family: ["family", "kid", "kids", "children", "child", "all ages", "family friendly"],
  nightlife: ["night", "club", "party", "dj", "bar", "lounge", "afterhours", "late"],
  professional: ["network", "conference", "business", "workshop", "summit", "expo", "professional", "meetup"],
};

export const DEFAULT_DISCOVER_FILTERS: DiscoverFilters = {
  date: null,
  categoryId: null,
  subcategoryId: null,
  tagId: null,
  radiusKm: null,
  minRating: null,
  priceBand: "any",
  venueFeatures: [],
  audience: null,
};

export function getActiveFilterCount(filters: DiscoverFilters): number {
  let count = 0;
  if (filters.date) count += 1;
  if (filters.categoryId) count += 1;
  if (filters.subcategoryId) count += 1;
  if (filters.tagId) count += 1;
  if (filters.radiusKm != null) count += 1;
  if (filters.minRating != null) count += 1;
  if (filters.priceBand !== "any") count += 1;
  if (filters.venueFeatures.length > 0) count += 1;
  if (filters.audience) count += 1;
  return count;
}

export function normalizeLocationFeatures(features: unknown): string[] {
  const values = new Set<string>();

  const visit = (input: unknown) => {
    if (typeof input === "string") {
      const normalized = normalizeFeatureToken(input);
      if (normalized) values.add(normalized);
      return;
    }

    if (Array.isArray(input)) {
      input.forEach((entry) => visit(entry));
      return;
    }

    if (input && typeof input === "object") {
      Object.values(input as Record<string, unknown>).forEach((entry) => visit(entry));
    }
  };

  visit(features);
  return Array.from(values);
}

export function collectVenueFeatureOptions(events: EventForClientFiltering[]): string[] {
  const values = new Set<string>();
  events.forEach((event) => {
    normalizeLocationFeatures(event.location?.features).forEach((feature) => values.add(feature));
  });
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

export function applyClientSideFilters<T extends EventForClientFiltering>(events: T[], filters: DiscoverFilters): T[] {
  return events.filter((event) => {
    if (!matchesPriceBand(event.price ?? null, filters.priceBand)) {
      return false;
    }

    if (!matchesVenueFeatures(event.location?.features, filters.venueFeatures)) {
      return false;
    }

    if (!matchesAudience(event, filters.audience)) {
      return false;
    }

    return true;
  });
}

export function formatFeatureLabel(value: string): string {
  return value
    .split(" ")
    .map((chunk) => (chunk ? chunk.charAt(0).toUpperCase() + chunk.slice(1) : chunk))
    .join(" ");
}

function matchesPriceBand(price: number | null, priceBand: PriceBand): boolean {
  if (priceBand === "any") {
    return true;
  }

  if (price == null) {
    return false;
  }

  if (priceBand === "free") {
    return price === 0;
  }

  if (priceBand === "lt25") {
    return price > 0 && price < 25;
  }

  if (priceBand === "btw25and50") {
    return price >= 25 && price <= 50;
  }

  return price > 50;
}

function matchesVenueFeatures(features: unknown, selectedFeatures: string[]): boolean {
  if (selectedFeatures.length === 0) {
    return true;
  }

  const available = new Set(normalizeLocationFeatures(features));
  return selectedFeatures.every((feature) => available.has(feature));
}

function matchesAudience(event: EventForClientFiltering, segment: AudienceSegment): boolean {
  if (!segment) {
    return true;
  }

  const haystack = [
    event.title,
    event.description,
    event.category,
    event.location?.name,
    ...(event.tags ?? []),
    ...normalizeLocationFeatures(event.location?.features),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const keywords = AUDIENCE_KEYWORDS[segment];
  return keywords.some((keyword) => haystack.includes(keyword));
}

function normalizeFeatureToken(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  return normalized || null;
}
