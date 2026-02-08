export type EventStatus = "LIVE" | "SOON" | "LATER" | "ENDED";

const DEFAULT_SOON_HOURS = 6;
const HOUR_MS = 60 * 60 * 1000;

export function getEventStatus(
  start: string | null | undefined,
  end: string | null | undefined,
  now: Date,
  soonHours = DEFAULT_SOON_HOURS
): EventStatus {
  const startDate = parseDate(start);
  const endDate = parseDate(end);

  if (!startDate) {
    return "LATER";
  }

  const nowMs = now.getTime();
  const startMs = startDate.getTime();

  if (endDate && nowMs >= endDate.getTime()) {
    return "ENDED";
  }

  if (nowMs >= startMs && (!endDate || nowMs < endDate.getTime())) {
    return "LIVE";
  }

  if (startMs > nowMs && startMs - nowMs <= soonHours * HOUR_MS) {
    return "SOON";
  }

  return "LATER";
}

export function formatEventTime(
  start: string | null | undefined,
  end: string | null | undefined,
  now: Date,
  soonHours = DEFAULT_SOON_HOURS
): string {
  const startDate = parseDate(start);
  if (!startDate) {
    return "Time TBA";
  }

  const status = getEventStatus(start, end, now, soonHours);
  if (status === "LIVE") {
    const endDate = parseDate(end);
    if (!endDate) {
      return "Now";
    }
    return `Now • until ${formatClockTime(endDate)}`;
  }

  if (status === "SOON") {
    const diffMs = startDate.getTime() - now.getTime();
    const hours = Math.max(1, Math.ceil(diffMs / HOUR_MS));
    return `In ${hours}h`;
  }

  const timeLabel = formatClockTime(startDate);

  if (isSameLocalDay(startDate, now)) {
    return `Today ${timeLabel}`;
  }

  const weekday = startDate.toLocaleDateString([], { weekday: "short" });
  return `${weekday} ${timeLabel}`;
}

export function formatPrice(price: number | null | undefined): string | null {
  if (price == null || !Number.isFinite(price) || price < 0) {
    return null;
  }

  if (price === 0) {
    return "Free";
  }

  if (Number.isInteger(price)) {
    return `€${price}`;
  }

  return `€${price.toFixed(1)}`;
}

export function pickTopTags(
  tags: string[] | null | undefined,
  maxVisible = 2
): { visibleTags: string[]; extraCount: number } {
  if (!tags?.length || maxVisible <= 0) {
    return { visibleTags: [], extraCount: 0 };
  }

  const seen = new Set<string>();
  const deduped: string[] = [];

  tags.forEach((tag) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(trimmed);
  });

  const visibleTags = deduped.slice(0, maxVisible);
  const extraCount = Math.max(0, deduped.length - visibleTags.length);
  return { visibleTags, extraCount };
}

export function formatLocationLabel(
  distanceKm: number | null | undefined,
  address: string | null | undefined,
  locationName: string | null | undefined
): string | null {
  if (distanceKm != null && Number.isFinite(distanceKm) && distanceKm >= 0) {
    return `${distanceKm.toFixed(1)} km away`;
  }

  const city = parseCityFromAddress(address);
  if (city) {
    return city;
  }

  const location = locationName?.trim();
  return location || null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function parseCityFromAddress(address: string | null | undefined): string | null {
  if (!address) {
    return null;
  }

  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return parts[parts.length - 1] ?? null;
}
