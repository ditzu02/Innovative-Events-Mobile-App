import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import Slider from "@react-native-community/slider";
import MapView, { Region } from "react-native-maps";
import { useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { CategoryRail, RailCategoryKey, RailChip } from "@/components/CategoryRail";
import { EventMap, EventMapEvent } from "@/components/EventMap";
import { EventCard, EventCardViewModel } from "@/components/EventCard";
import { ForYouMiniCard } from "@/components/ForYouMiniCard";
import { useAuth } from "@/context/auth";
import { SavedEventSummary, useSaved } from "@/context/saved";
import { loadDiscoverPrefs, PersistedQuickFilters, saveDiscoverPrefs } from "@/lib/demo-prefs";
import {
  applyClientSideFilters,
  AudienceSegment,
  collectVenueFeatureOptions,
  DEFAULT_DISCOVER_FILTERS,
  DiscoverFilters,
  formatFeatureLabel,
  getActiveFilterCount,
  PriceBand,
} from "@/lib/discover-filters";
import {
  EventStatus,
  formatEventTime,
  formatLocationLabel,
  formatPrice,
  getEventStatus,
  pickTopTags,
} from "@/lib/event-formatting";
import { request } from "@/lib/api";
import {
  getReasonLabel,
  loadTasteProfile,
  persistTasteProfile,
  scoreEventForYou,
  TasteInteraction,
  TasteProfile,
  updateTasteProfileFromInteraction,
} from "@/lib/taste-profile";

type Event = {
  id: string;
  title: string;
  category: string | null;
  start_time: string | null;
  end_time: string | null;
  description?: string | null;
  cover_image_url?: string | null;
  location?: {
    name?: string | null;
    address?: string | null;
    features?: unknown;
  } | null;
  price?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  tags?: string[];
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
};

type TaxonomyNode = { id: string; name: string; slug: string };
type TaxonomySubcategory = TaxonomyNode & { tags: TaxonomyNode[] };
type TaxonomyCategory = TaxonomyNode & { subcategories: TaxonomySubcategory[] };
type FiltersResponse = {
  tags: string[];
  categories: string[];
  taxonomy_version?: string;
  taxonomy?: { categories: TaxonomyCategory[] };
};

type Option = {
  label: string;
  value: string;
};

type DiscoverCardViewModel = EventCardViewModel & { event: Event };

type SortMode = "soonest" | "toprated" | "distance" | "price";

type SortChip = {
  key: SortMode;
  label: string;
};

type QuickFilterKey = keyof PersistedQuickFilters;

type ActiveFilterChip = {
  key: string;
  label: string;
};

type ForYouItem = {
  model: DiscoverCardViewModel;
  reasonLabel: string;
  score: number;
};

type MapMarkerModel = EventMapEvent & {
  event: Event;
};

type SelectedMarkerAnchor = {
  id: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
};

const FALLBACK_TAG_OPTIONS = ["Rock", "Jazz", "Outdoor", "Dj", "Live", "Electronic"];
const FALLBACK_CATEGORY_OPTIONS = ["Music", "Party", "Art"];
const RADIUS_OPTIONS = [5, 10, 25, 50];
const DEFAULT_REGION: Region = {
  latitude: 48.2082,
  longitude: 16.3738,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};
const CTA_FALLBACK_HEIGHT = 60;
const SHEET_FALLBACK_HEIGHT = 136;
const BOTTOM_GAP = 12;
const CAMERA_TOP_PADDING = 80;
const CAMERA_SIDE_PADDING = 40;
const CAMERA_BOTTOM_BUFFER = 120;
const MAP_MARKER_LIMIT = 10;
const CATEGORY_DEBOUNCE_MS = 180;
const MAP_FIT_EDGE_PADDING = { top: 88, right: 64, bottom: 96, left: 64 };
const PRICE_OPTIONS: Option[] = [
  { label: "Any", value: "any" },
  { label: "Free", value: "free" },
  { label: "Under 25", value: "lt25" },
  { label: "25-50", value: "btw25and50" },
  { label: "50+", value: "gt50" },
];
const AUDIENCE_OPTIONS: Option[] = [
  { label: "Family", value: "family" },
  { label: "Nightlife", value: "nightlife" },
  { label: "Professional", value: "professional" },
];
const PALETTE = {
  background: "#0b0a12",
  surface: "#151321",
  surfaceAlt: "#1c1930",
  line: "#2c2740",
  text: "#f5f3ff",
  muted: "#a2a1b4",
  accent: "#8f6bff",
  accentSoft: "#2b2446",
  danger: "#ff6b6b",
};
const RAIL_CATEGORY_CONFIG: {
  key: Exclude<RailCategoryKey, "all">;
  label: string;
  aliases: string[];
}[] = [
  { key: "music", label: "Music", aliases: ["music"] },
  { key: "food", label: "Food", aliases: ["food", "food-drink"] },
  { key: "nightlife", label: "Nightlife", aliases: ["nightlife"] },
  { key: "arts", label: "Arts", aliases: ["arts", "arts-culture"] },
  { key: "outdoor", label: "Outdoor", aliases: ["outdoor"] },
];
const SORT_CHIPS: SortChip[] = [
  { key: "soonest", label: "Soonest" },
  { key: "toprated", label: "Top Rated" },
  { key: "distance", label: "Nearest" },
  { key: "price", label: "Price" },
];
const DEFAULT_QUICK_FILTERS: PersistedQuickFilters = {
  free: false,
  tonight: false,
  highRated: false,
};
const VIBE_OPTIONS: { label: string; value: Exclude<RailCategoryKey, "all"> }[] = [
  { label: "Music", value: "music" },
  { label: "Food", value: "food" },
  { label: "Nightlife", value: "nightlife" },
  { label: "Arts", value: "arts" },
  { label: "Outdoor", value: "outdoor" },
];
const EMPTY_TASTE_PROFILE: TasteProfile = {
  categoryCounts: {},
  tagCounts: {},
  updatedAt: 0,
};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function slugifyLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function labelsToNodes(labels: string[], prefix: string): TaxonomyNode[] {
  const counts = new Map<string, number>();
  return labels.map((label) => {
    const slug = slugifyLabel(label);
    const next = (counts.get(slug) ?? 0) + 1;
    counts.set(slug, next);
    return {
      id: `${prefix}-${slug || "item"}-${next}`,
      name: label,
      slug: slug || `${prefix}-${next}`,
    };
  });
}

function toDiscoverErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown error";
  if (message === "Request timed out") {
    return "Cannot reach the server. Check EXPO_PUBLIC_API_URL and make sure the backend is running.";
  }
  return message;
}

function cloneFilters(filters: DiscoverFilters): DiscoverFilters {
  return {
    ...filters,
    date: filters.date ? new Date(filters.date) : null,
    venueFeatures: [...filters.venueFeatures],
  };
}

function filtersEqual(a: DiscoverFilters, b: DiscoverFilters) {
  const aDate = a.date ? a.date.getTime() : null;
  const bDate = b.date ? b.date.getTime() : null;
  if (aDate !== bDate) return false;
  if (a.categoryId !== b.categoryId) return false;
  if (a.subcategoryId !== b.subcategoryId) return false;
  if (a.tagId !== b.tagId) return false;
  if (a.radiusKm !== b.radiusKm) return false;
  if (a.minRating !== b.minRating) return false;
  if (a.priceBand !== b.priceBand) return false;
  if (a.audience !== b.audience) return false;
  if (a.venueFeatures.length !== b.venueFeatures.length) return false;
  return a.venueFeatures.every((item, index) => item === b.venueFeatures[index]);
}

function getPlaceholderToken(category: string | null, title: string): string {
  const safeCategory = typeof category === "string" ? category.trim() : "";
  const safeTitle = typeof title === "string" ? title.trim() : "";
  const source = safeCategory || safeTitle;
  if (!source) return "EV";
  const match = source.match(/[A-Za-z0-9]/);
  return (match?.[0] ?? "E").toUpperCase();
}

function getStatusLabel(
  status: Exclude<EventStatus, "ENDED">,
  startTime: string | null | undefined,
  now: Date
): string | null {
  if (status === "LIVE") {
    return "LIVE NOW";
  }

  if (status === "SOON") {
    if (!startTime) {
      return "Starts Soon";
    }
    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) {
      return "Starts Soon";
    }
    const hours = Math.max(1, Math.ceil((start.getTime() - now.getTime()) / (60 * 60 * 1000)));
    return `Starts in ${hours}h`;
  }

  return null;
}

type CoordinateLike = {
  latitude?: number | null;
  longitude?: number | null;
};

function hasValidCoordinate<T extends CoordinateLike>(
  coordinate: T | null | undefined
): coordinate is T & { latitude: number; longitude: number } {
  if (!coordinate) return false;
  const { latitude, longitude } = coordinate;
  if (latitude == null || longitude == null) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return true;
}

function eventTimestamp(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return parsed.getTime();
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function sanitizeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function sanitizeEvent(value: unknown): Event | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  const id = sanitizeString(input.id);
  if (!id) return null;

  const title = sanitizeString(input.title) ?? "Untitled event";
  const category = sanitizeString(input.category);
  const start_time = sanitizeString(input.start_time);
  const end_time = sanitizeString(input.end_time);
  const description = sanitizeString(input.description);
  const cover_image_url = sanitizeString(input.cover_image_url);
  const price = sanitizeNumber(input.price);
  const rating_avg = sanitizeNumber(input.rating_avg);
  const rating_count = sanitizeNumber(input.rating_count);
  const latitude = sanitizeNumber(input.latitude);
  const longitude = sanitizeNumber(input.longitude);
  const distance_km = sanitizeNumber(input.distance_km);

  const tags = Array.isArray(input.tags)
    ? input.tags
      .map((tag) => sanitizeString(tag))
      .filter((tag): tag is string => Boolean(tag))
    : [];

  let location: Event["location"] = null;
  if (input.location && typeof input.location === "object" && !Array.isArray(input.location)) {
    const rawLocation = input.location as Record<string, unknown>;
    location = {
      name: sanitizeString(rawLocation.name),
      address: sanitizeString(rawLocation.address),
      features: rawLocation.features,
    };
  }

  return {
    id,
    title,
    category,
    start_time,
    end_time,
    description,
    cover_image_url,
    location,
    price,
    rating_avg,
    rating_count,
    tags,
    latitude,
    longitude,
    distance_km,
  };
}

function sanitizeEventsPayload(value: unknown): Event[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((event) => sanitizeEvent(event))
    .filter((event): event is Event => Boolean(event));
}

function isSameLocalDay(date: Date, reference: Date): boolean {
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

function toSavedSummary(event: Event): SavedEventSummary {
  return {
    id: event.id,
    title: event.title,
    category: event.category,
    start_time: event.start_time ?? null,
    end_time: event.end_time ?? null,
    description: event.description ?? null,
    cover_image_url: event.cover_image_url ?? null,
    location: event.location ?? null,
    price: event.price ?? null,
    rating_avg: event.rating_avg ?? null,
    rating_count: event.rating_count ?? null,
    tags: event.tags ?? [],
    latitude: event.latitude ?? null,
    longitude: event.longitude ?? null,
    distance_km: event.distance_km ?? null,
  };
}

function isRailCategoryKey(value: string): value is RailCategoryKey {
  return value === "all" || value === "music" || value === "food" || value === "nightlife" || value === "arts" || value === "outdoor";
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthed } = useAuth();
  const { isEventSaved, pendingSaveIds, toggleSave } = useSaved();

  const [events, setEvents] = useState<Event[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedQuery, setDebouncedQuery] = useState<string>("");

  const [appliedFilters, setAppliedFilters] = useState<DiscoverFilters>(() => cloneFilters(DEFAULT_DISCOVER_FILTERS));
  const [draftFilters, setDraftFilters] = useState<DiscoverFilters>(() => cloneFilters(DEFAULT_DISCOVER_FILTERS));

  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [mapExpanded, setMapExpanded] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedMarkerAnchor, setSelectedMarkerAnchor] = useState<SelectedMarkerAnchor | null>(null);
  const [pendingNavId, setPendingNavId] = useState<string | null>(null);
  const [showListOverlay, setShowListOverlay] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region>(DEFAULT_REGION);
  const [expandedMapMounted, setExpandedMapMounted] = useState(false);
  const [expandedMapReady, setExpandedMapReady] = useState(false);
  const [ctaHeight, setCtaHeight] = useState(CTA_FALLBACK_HEIGHT);
  const [selectedCardHeight, setSelectedCardHeight] = useState(SHEET_FALLBACK_HEIGHT);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const [taxonomyCategories, setTaxonomyCategories] = useState<TaxonomyCategory[] | null>(null);
  const [taxonomyVersion, setTaxonomyVersion] = useState<string | null>(null);
  const [availableTags, setAvailableTags] = useState<TaxonomyNode[]>(() => labelsToNodes(FALLBACK_TAG_OPTIONS, "tag"));
  const [availableCategories, setAvailableCategories] = useState<TaxonomyNode[]>(() =>
    labelsToNodes(FALLBACK_CATEGORY_OPTIONS, "category")
  );
  const [filtersError, setFiltersError] = useState<string | null>(null);

  const [isUsingCachedResults, setIsUsingCachedResults] = useState(false);
  const [cachedIndicator, setCachedIndicator] = useState<string | null>(null);
  const [selectedRailCategory, setSelectedRailCategory] = useState<RailCategoryKey>("all");
  const [railNotice, setRailNotice] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState<number>(() => Date.now());
  const [sortMode, setSortMode] = useState<SortMode>("soonest");
  const [quickFilters, setQuickFilters] = useState<PersistedQuickFilters>(DEFAULT_QUICK_FILTERS);
  const [tasteProfile, setTasteProfile] = useState<TasteProfile>(EMPTY_TASTE_PROFILE);
  const [prefsHydrated, setPrefsHydrated] = useState(false);

  const mapRef = useRef<MapView | null>(null);
  const expandedMapMountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSelectionCameraKeyRef = useRef<string | null>(null);
  const mapRegionRef = useRef<Region>(DEFAULT_REGION);
  const hasAutoCenteredRef = useRef(false);
  const selectedRailCategoryRef = useRef<RailCategoryKey>("all");
  const fetchSeqRef = useRef(0);
  const activeFetchSeqRef = useRef(0);
  const eventsAbortRef = useRef<AbortController | null>(null);
  const lastSuccessfulEventsRef = useRef<Event[] | null>(null);
  const mountedRef = useRef(true);
  const layoutAnimationReadyRef = useRef(Platform.OS !== "android");

  const taxonomyEnabled = !!taxonomyCategories?.length;

  const allSubcategories = useMemo(() => {
    if (!taxonomyCategories) return [];
    return taxonomyCategories.flatMap((category) => category.subcategories);
  }, [taxonomyCategories]);

  const allHierarchyTags = useMemo(() => {
    if (!taxonomyCategories) return [];
    return taxonomyCategories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags));
  }, [taxonomyCategories]);

  const categoryById = useMemo(() => {
    const map = new Map<string, TaxonomyNode>();
    availableCategories.forEach((item) => map.set(item.id, item));
    return map;
  }, [availableCategories]);

  const subcategoryById = useMemo(() => {
    const map = new Map<string, TaxonomyNode>();
    allSubcategories.forEach((item) => map.set(item.id, item));
    return map;
  }, [allSubcategories]);

  const hierarchyTagById = useMemo(() => {
    const map = new Map<string, TaxonomyNode>();
    allHierarchyTags.forEach((item) => map.set(item.id, item));
    return map;
  }, [allHierarchyTags]);

  const fallbackTagById = useMemo(() => {
    const map = new Map<string, TaxonomyNode>();
    availableTags.forEach((item) => map.set(item.id, item));
    return map;
  }, [availableTags]);

  const railChips = useMemo<RailChip[]>(() => {
    const categoriesBySlug = new Map<string, TaxonomyNode>();
    availableCategories.forEach((category) => {
      const normalizedSlug = category.slug.trim().toLowerCase();
      if (normalizedSlug && !categoriesBySlug.has(normalizedSlug)) {
        categoriesBySlug.set(normalizedSlug, category);
      }
    });

    const fixedChips: RailChip[] = RAIL_CATEGORY_CONFIG.map((definition) => {
      const resolved =
        definition.aliases
          .map((alias) => categoriesBySlug.get(alias))
          .find(Boolean) ?? null;

      return {
        key: definition.key,
        label: definition.label,
        categoryId: resolved?.id ?? null,
        slug: resolved?.slug ?? null,
        disabled: resolved == null,
      };
    });

    return [
      { key: "all", label: "All", categoryId: null, slug: null },
      ...fixedChips,
    ];
  }, [availableCategories]);

  const railCategoryById = useMemo(() => {
    const map = new Map<string, RailCategoryKey>();
    railChips.forEach((chip) => {
      if (chip.categoryId) {
        map.set(chip.categoryId, chip.key);
      }
    });
    return map;
  }, [railChips]);

  const draftSelectedCategoryTree = useMemo(
    () => taxonomyCategories?.find((item) => item.id === draftFilters.categoryId) ?? null,
    [taxonomyCategories, draftFilters.categoryId]
  );
  const draftSubcategoryOptions = useMemo(
    () => draftSelectedCategoryTree?.subcategories ?? [],
    [draftSelectedCategoryTree]
  );
  const draftSelectedSubcategoryTree = useMemo(
    () => draftSubcategoryOptions.find((item) => item.id === draftFilters.subcategoryId) ?? null,
    [draftSubcategoryOptions, draftFilters.subcategoryId]
  );
  const draftHierarchyTagOptions = draftSelectedSubcategoryTree?.tags ?? [];

  const appliedCategorySlug = useMemo(() => {
    if (!appliedFilters.categoryId) return null;
    return categoryById.get(appliedFilters.categoryId)?.slug ?? null;
  }, [appliedFilters.categoryId, categoryById]);

  const appliedSubcategorySlug = useMemo(() => {
    if (!appliedFilters.subcategoryId) return null;
    return subcategoryById.get(appliedFilters.subcategoryId)?.slug ?? null;
  }, [appliedFilters.subcategoryId, subcategoryById]);

  const appliedTagSlug = useMemo(() => {
    if (!appliedFilters.tagId) return null;
    if (taxonomyEnabled) {
      return hierarchyTagById.get(appliedFilters.tagId)?.slug ?? null;
    }
    return fallbackTagById.get(appliedFilters.tagId)?.slug ?? null;
  }, [appliedFilters.tagId, taxonomyEnabled, hierarchyTagById, fallbackTagById]);
  const debouncedAppliedCategorySlug = useDebouncedValue(appliedCategorySlug, CATEGORY_DEBOUNCE_MS);
  const debouncedAppliedSubcategorySlug = useDebouncedValue(appliedSubcategorySlug, CATEGORY_DEBOUNCE_MS);
  const debouncedAppliedTagSlug = useDebouncedValue(appliedTagSlug, CATEGORY_DEBOUNCE_MS);

  const displayEvents = useMemo(
    () => applyClientSideFilters(events ?? [], appliedFilters),
    [events, appliedFilters]
  );

  const baseCardViewModels = useMemo<DiscoverCardViewModel[]>(() => {
    const now = new Date(clockTick);

    return displayEvents.flatMap((event) => {
      const status = getEventStatus(event.start_time, event.end_time, now);
      if (status === "ENDED") {
        return [];
      }

      const { visibleTags } = pickTopTags(event.tags, 2);
      const ratingCount = event.rating_count ?? 0;
      const ratingLabel =
        event.rating_avg != null && ratingCount > 0
          ? `★ ${event.rating_avg.toFixed(1)} (${ratingCount})`
          : null;

      const model: DiscoverCardViewModel = {
        id: event.id,
        event,
        title: event.title,
        status,
        statusLabel: getStatusLabel(status, event.start_time, now),
        coverImageUrl: event.cover_image_url?.trim() || null,
        placeholderToken: getPlaceholderToken(event.category, event.title),
        timeLabel: formatEventTime(event.start_time, event.end_time, now),
        locationLabel: formatLocationLabel(event.distance_km, event.location?.address, event.location?.name),
        priceLabel: formatPrice(event.price),
        visibleTags,
        ratingLabel,
      };

      return [model];
    });
  }, [displayEvents, clockTick]);

  const filteredCardViewModels = useMemo(() => {
    const now = new Date(clockTick);
    const tonightThreshold = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0);

    return baseCardViewModels.filter((item) => {
      if (quickFilters.free && item.event.price !== 0) {
        return false;
      }
      if (quickFilters.highRated && (item.event.rating_avg ?? 0) < 4.5) {
        return false;
      }
      if (quickFilters.tonight) {
        if (!item.event.start_time) return false;
        const start = new Date(item.event.start_time);
        if (Number.isNaN(start.getTime())) return false;
        if (!isSameLocalDay(start, now)) return false;
        if (start.getTime() < tonightThreshold.getTime()) return false;
      }
      return true;
    });
  }, [baseCardViewModels, clockTick, quickFilters]);

  const sortedCardViewModels = useMemo<DiscoverCardViewModel[]>(() => {
    const next = [...filteredCardViewModels];

    if (sortMode === "toprated") {
      next.sort((a, b) => {
        const ratingDiff = (b.event.rating_avg ?? -1) - (a.event.rating_avg ?? -1);
        if (ratingDiff !== 0) return ratingDiff;
        const countDiff = (b.event.rating_count ?? -1) - (a.event.rating_count ?? -1);
        if (countDiff !== 0) return countDiff;
        return eventTimestamp(a.event.start_time) - eventTimestamp(b.event.start_time);
      });
      return next;
    }

    if (sortMode === "distance") {
      next.sort((a, b) => {
        const aDistance = a.event.distance_km ?? Number.POSITIVE_INFINITY;
        const bDistance = b.event.distance_km ?? Number.POSITIVE_INFINITY;
        if (aDistance !== bDistance) return aDistance - bDistance;
        return eventTimestamp(a.event.start_time) - eventTimestamp(b.event.start_time);
      });
      return next;
    }

    if (sortMode === "price") {
      next.sort((a, b) => {
        const aPrice = a.event.price ?? Number.POSITIVE_INFINITY;
        const bPrice = b.event.price ?? Number.POSITIVE_INFINITY;
        if (aPrice !== bPrice) return aPrice - bPrice;
        return eventTimestamp(a.event.start_time) - eventTimestamp(b.event.start_time);
      });
      return next;
    }

    next.sort((a, b) => eventTimestamp(a.event.start_time) - eventTimestamp(b.event.start_time));
    return next;
  }, [filteredCardViewModels, sortMode]);

  const hasTasteSignals = useMemo(() => {
    return (
      Object.keys(tasteProfile.categoryCounts).length > 0 ||
      Object.keys(tasteProfile.tagCounts).length > 0 ||
      Boolean(tasteProfile.seededVibe)
    );
  }, [tasteProfile]);

  const forYouItems = useMemo<ForYouItem[]>(() => {
    const now = new Date(clockTick);
    return filteredCardViewModels
      .map((model) => {
        const { score, reason } = scoreEventForYou(model.event, tasteProfile, now);
        return {
          model,
          score,
          reasonLabel: getReasonLabel(reason, {
            category: model.event.category,
            vibe: tasteProfile.seededVibe,
          }),
        };
      })
      .filter((item) => item.score >= 3)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return eventTimestamp(a.model.event.start_time) - eventTimestamp(b.model.event.start_time);
      })
      .slice(0, 8);
  }, [filteredCardViewModels, tasteProfile, clockTick]);

  const showForYouRail = forYouItems.length >= 3;

  const activeFilterChips = useMemo<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];
    if (appliedFilters.date) chips.push({ key: "date", label: `Date ${appliedFilters.date.toLocaleDateString()}` });
    if (appliedFilters.categoryId) {
      chips.push({
        key: "category",
        label: `Category ${categoryById.get(appliedFilters.categoryId)?.name ?? "Selected"}`,
      });
    }
    if (appliedFilters.subcategoryId) {
      chips.push({
        key: "subcategory",
        label: `Subcategory ${subcategoryById.get(appliedFilters.subcategoryId)?.name ?? "Selected"}`,
      });
    }
    if (appliedFilters.tagId) {
      const tagName =
        hierarchyTagById.get(appliedFilters.tagId)?.name ??
        fallbackTagById.get(appliedFilters.tagId)?.name ??
        "Selected";
      chips.push({ key: "tag", label: `Tag ${tagName}` });
    }
    if (appliedFilters.radiusKm != null) chips.push({ key: "radius", label: `Radius ${appliedFilters.radiusKm} km` });
    if (appliedFilters.priceBand !== "any") {
      const priceLabel = PRICE_OPTIONS.find((option) => option.value === appliedFilters.priceBand)?.label ?? appliedFilters.priceBand;
      chips.push({ key: "price", label: `Price ${priceLabel}` });
    }
    if (appliedFilters.minRating != null) chips.push({ key: "minRating", label: `Rating ${appliedFilters.minRating}+` });
    if (appliedFilters.audience) chips.push({ key: "audience", label: `Audience ${appliedFilters.audience}` });
    if (appliedFilters.venueFeatures.length > 0) {
      chips.push({ key: "venueFeatures", label: `Venue features (${appliedFilters.venueFeatures.length})` });
    }
    if (quickFilters.tonight) chips.push({ key: "tonight", label: "Tonight" });
    if (quickFilters.highRated) chips.push({ key: "highRated", label: "4.5+" });
    return chips;
  }, [
    appliedFilters,
    quickFilters,
    categoryById,
    subcategoryById,
    hierarchyTagById,
    fallbackTagById,
  ]);

  const discoverEvents = useMemo(
    () => sortedCardViewModels.map((item) => item.event),
    [sortedCardViewModels]
  );
  const allMapMarkers = useMemo<MapMarkerModel[]>(
    () =>
      discoverEvents.flatMap((event) => {
        if (!hasValidCoordinate(event)) {
          return [];
        }
        return [
          {
            id: event.id,
            title: event.title,
            subtitle: event.location?.name ?? "",
            coordinate: {
              latitude: event.latitude,
              longitude: event.longitude,
            },
            event,
          },
        ];
      }),
    [discoverEvents]
  );
  const visibleMapMarkers = useMemo(
    () => allMapMarkers.slice(0, MAP_MARKER_LIMIT),
    [allMapMarkers]
  );
  const visibleMarkerCoordinates = useMemo(
    () => visibleMapMarkers.map((marker) => marker.coordinate),
    [visibleMapMarkers]
  );
  const visibleMapMarkersSignature = useMemo(
    () =>
      visibleMapMarkers
        .map((marker) => `${marker.id}:${marker.coordinate.latitude.toFixed(5)},${marker.coordinate.longitude.toFixed(5)}`)
        .join("|"),
    [visibleMapMarkers]
  );

  const venueFeatureOptions = useMemo(() => collectVenueFeatureOptions(events ?? []), [events]);

  const activeFilterCount = useMemo(
    () => getActiveFilterCount(appliedFilters) + (quickFilters.tonight ? 1 : 0) + (quickFilters.highRated ? 1 : 0),
    [appliedFilters, quickFilters]
  );

  const hasValidUserLocation = hasValidCoordinate(userLocation);

  const locationLabel = hasValidUserLocation
    ? `${userLocation.latitude.toFixed(4)}, ${userLocation.longitude.toFixed(4)}`
    : "Pin not set";
  const resolvedCtaHeight = Math.max(ctaHeight, CTA_FALLBACK_HEIGHT);
  const resolvedSheetHeight = Math.max(selectedCardHeight, SHEET_FALLBACK_HEIGHT);
  const ctaBottomOffset = insets.bottom + (selectedEvent ? resolvedSheetHeight + BOTTOM_GAP : BOTTOM_GAP);

  const runCalmLayout = useCallback(() => {
    if (!layoutAnimationReadyRef.current) {
      return;
    }
    try {
      LayoutAnimation.configureNext({
        duration: 140,
        update: {
          type: LayoutAnimation.Types.easeInEaseOut,
        },
        create: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.opacity,
        },
        delete: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.opacity,
        },
      });
    } catch {
      // Prevent rail interactions from crashing if layout animations are unavailable.
    }
  }, []);

  const triggerLightHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, []);

  const applyTasteInteraction = useCallback((interaction: TasteInteraction) => {
    setTasteProfile((prev) => {
      const next = updateTasteProfileFromInteraction(prev, interaction);
      persistTasteProfile(next).catch(() => undefined);
      return next;
    });
  }, []);

  const handlePickVibe = useCallback((vibe: string) => {
    runCalmLayout();
    triggerLightHaptic();
    applyTasteInteraction({ type: "vibe", vibe });
  }, [applyTasteInteraction, runCalmLayout, triggerLightHaptic]);

  const handleSelectSortChip = useCallback(
    (mode: SortMode) => {
      if (mode === "distance" && !hasValidUserLocation) {
        setRailNotice("Drop a pin to sort by distance.");
        setMapExpanded(true);
        return;
      }
      if (sortMode === mode) return;
      triggerLightHaptic();
      runCalmLayout();
      setSortMode(mode);
    },
    [hasValidUserLocation, sortMode, runCalmLayout, triggerLightHaptic]
  );

  const handleToggleQuickFilter = useCallback(
    (key: QuickFilterKey) => {
      triggerLightHaptic();
      runCalmLayout();
      setQuickFilters((prev) => {
        const next = { ...prev, [key]: !prev[key] };

        if (key === "free") {
          setAppliedFilters((current) => ({
            ...current,
            priceBand: next.free ? "free" : current.priceBand === "free" ? "any" : current.priceBand,
          }));
          setDraftFilters((current) => ({
            ...current,
            priceBand: next.free ? "free" : current.priceBand === "free" ? "any" : current.priceBand,
          }));
        }

        return next;
      });
    },
    [runCalmLayout, triggerLightHaptic]
  );

  const clearAllFilters = useCallback(() => {
    runCalmLayout();
    setAppliedFilters(cloneFilters(DEFAULT_DISCOVER_FILTERS));
    setDraftFilters(cloneFilters(DEFAULT_DISCOVER_FILTERS));
    setQuickFilters({ ...DEFAULT_QUICK_FILTERS });
    setSelectedRailCategory("all");
  }, [runCalmLayout]);

  const handleClearActiveChip = useCallback(
    (chipKey: string) => {
      runCalmLayout();
      if (chipKey === "date") {
        setAppliedFilters((prev) => ({ ...prev, date: null }));
        setDraftFilters((prev) => ({ ...prev, date: null }));
        return;
      }
      if (chipKey === "category") {
        setAppliedFilters((prev) => ({ ...prev, categoryId: null, subcategoryId: null, tagId: null }));
        setDraftFilters((prev) => ({ ...prev, categoryId: null, subcategoryId: null, tagId: null }));
        setSelectedRailCategory("all");
        return;
      }
      if (chipKey === "subcategory") {
        setAppliedFilters((prev) => ({ ...prev, subcategoryId: null, tagId: null }));
        setDraftFilters((prev) => ({ ...prev, subcategoryId: null, tagId: null }));
        return;
      }
      if (chipKey === "tag") {
        setAppliedFilters((prev) => ({ ...prev, tagId: null }));
        setDraftFilters((prev) => ({ ...prev, tagId: null }));
        return;
      }
      if (chipKey === "radius") {
        setAppliedFilters((prev) => ({ ...prev, radiusKm: null }));
        setDraftFilters((prev) => ({ ...prev, radiusKm: null }));
        return;
      }
      if (chipKey === "price") {
        setAppliedFilters((prev) => ({ ...prev, priceBand: "any" }));
        setDraftFilters((prev) => ({ ...prev, priceBand: "any" }));
        setQuickFilters((prev) => ({ ...prev, free: false }));
        return;
      }
      if (chipKey === "minRating") {
        setAppliedFilters((prev) => ({ ...prev, minRating: null }));
        setDraftFilters((prev) => ({ ...prev, minRating: null }));
        return;
      }
      if (chipKey === "audience") {
        setAppliedFilters((prev) => ({ ...prev, audience: null }));
        setDraftFilters((prev) => ({ ...prev, audience: null }));
        return;
      }
      if (chipKey === "venueFeatures") {
        setAppliedFilters((prev) => ({ ...prev, venueFeatures: [] }));
        setDraftFilters((prev) => ({ ...prev, venueFeatures: [] }));
        return;
      }
      if (chipKey === "tonight") {
        setQuickFilters((prev) => ({ ...prev, tonight: false }));
        return;
      }
      if (chipKey === "highRated") {
        setQuickFilters((prev) => ({ ...prev, highRated: false }));
      }
    },
    [runCalmLayout]
  );

  const getPreviewRegion = useCallback(() => {
    if (hasValidUserLocation && userLocation) {
      return {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };
    }

    const firstMarker = visibleMapMarkers[0];
    if (firstMarker) {
      const current = mapRegionRef.current ?? DEFAULT_REGION;
      return {
        latitude: firstMarker.coordinate.latitude,
        longitude: firstMarker.coordinate.longitude,
        latitudeDelta: current.latitudeDelta ?? 0.2,
        longitudeDelta: current.longitudeDelta ?? 0.2,
      };
    }

    return mapRegionRef.current ?? DEFAULT_REGION;
  }, [userLocation, hasValidUserLocation, visibleMapMarkers]);

  const fitMapToMarkers = useCallback(
    (animated: boolean) => {
      if (!expandedMapReady || !mapRef.current) {
        return;
      }

      if (visibleMapMarkers.length === 0) {
        const fallbackRegion = hasValidUserLocation && userLocation
          ? {
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
            latitudeDelta: 0.2,
            longitudeDelta: 0.2,
          }
          : DEFAULT_REGION;

        setMapRegion(fallbackRegion);
        mapRef.current.animateToRegion(fallbackRegion, animated ? 250 : 0);
        return;
      }

      if (visibleMapMarkers.length === 1) {
        const [singleMarker] = visibleMapMarkers;
        const singleRegion = {
          latitude: singleMarker.coordinate.latitude,
          longitude: singleMarker.coordinate.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        };
        setMapRegion(singleRegion);
        mapRef.current.animateToRegion(singleRegion, animated ? 250 : 0);
        return;
      }

      mapRef.current.fitToCoordinates(visibleMarkerCoordinates, {
        edgePadding: MAP_FIT_EDGE_PADDING,
        animated,
      });
    },
    [expandedMapReady, visibleMapMarkers, visibleMarkerCoordinates, hasValidUserLocation, userLocation]
  );

  const handleDropPin = useCallback(
    (coordinate: { latitude: number; longitude: number }) => {
      if (!hasValidCoordinate(coordinate)) {
        return;
      }

      const nextRegion = {
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        latitudeDelta: mapRegionRef.current?.latitudeDelta ?? DEFAULT_REGION.latitudeDelta,
        longitudeDelta: mapRegionRef.current?.longitudeDelta ?? DEFAULT_REGION.longitudeDelta,
      };

      setUserLocation(coordinate);
      setMapRegion(nextRegion);
      if (expandedMapReady) {
        mapRef.current?.animateToRegion(nextRegion, 250);
      }
    },
    [expandedMapReady]
  );

  const handleExpandedMapRegionChangeComplete = useCallback(
    (region: Region) => {
      if (!expandedMapReady) return;
      if (
        !Number.isFinite(region.latitude) ||
        !Number.isFinite(region.longitude) ||
        !Number.isFinite(region.latitudeDelta) ||
        !Number.isFinite(region.longitudeDelta)
      ) {
        return;
      }
      setMapRegion(region);
    },
    [expandedMapReady]
  );

  const handleMapMarkerPress = useCallback(
    (marker: EventMapEvent) => {
      const matched = visibleMapMarkers.find((item) => item.id === marker.id);
      if (!matched) return;
      setSelectedEvent(matched.event);
      setSelectedMarkerAnchor({
        id: matched.id,
        coordinate: matched.coordinate,
      });
    },
    [visibleMapMarkers]
  );

  const visibleEvents = useMemo(() => {
    if (!mapRegion) return discoverEvents;
    const { latitude, longitude, latitudeDelta, longitudeDelta } = mapRegion;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitudeDelta) ||
      !Number.isFinite(longitudeDelta)
    ) {
      return discoverEvents.filter((event) => hasValidCoordinate(event));
    }
    const minLat = latitude - latitudeDelta / 2;
    const maxLat = latitude + latitudeDelta / 2;
    const minLng = longitude - longitudeDelta / 2;
    const maxLng = longitude + longitudeDelta / 2;

    return discoverEvents.filter(
      (event) => {
        if (!hasValidCoordinate(event)) {
          return false;
        }
        return (
          event.latitude >= minLat &&
          event.latitude <= maxLat &&
          event.longitude >= minLng &&
          event.longitude <= maxLng
        );
      }
    );
  }, [mapRegion, discoverEvents]);

  const handleOpenEvent = useCallback((event: Event) => {
    applyTasteInteraction({ type: "open", event });
    setSelectedEvent(null);
    setPendingNavId(event.id);
    setMapExpanded(false);
  }, [applyTasteInteraction]);

  const handleOpenFilters = useCallback(() => {
    setDraftFilters((_) => cloneFilters(appliedFilters));
    setShowDatePicker(false);
    setAdvancedExpanded(false);
    setFilterSheetVisible(true);
  }, [appliedFilters]);

  const handleSelectRailChip = useCallback((chip: RailChip) => {
    if (chip.disabled) {
      setRailNotice("Category unavailable");
      return;
    }

    const nextCategoryId = chip.key === "all" ? null : chip.categoryId;
    if (chip.key !== "all" && !nextCategoryId) {
      setRailNotice("Category unavailable");
      return;
    }

    const appliedAligned =
      appliedFilters.categoryId === nextCategoryId &&
      appliedFilters.subcategoryId == null &&
      appliedFilters.tagId == null;
    const draftAligned =
      draftFilters.categoryId === nextCategoryId &&
      draftFilters.subcategoryId == null &&
      draftFilters.tagId == null;
    if (selectedRailCategory === chip.key && appliedAligned && draftAligned) {
      return;
    }

    setRailNotice(null);
    triggerLightHaptic();
    setSelectedRailCategory(chip.key);

    if (!appliedAligned) {
      setAppliedFilters((prev) => ({
        ...prev,
        categoryId: nextCategoryId,
        subcategoryId: null,
        tagId: null,
      }));
    }

    if (!draftAligned) {
      setDraftFilters((prev) => ({
        ...prev,
        categoryId: nextCategoryId,
        subcategoryId: null,
        tagId: null,
      }));
    }
  }, [
    appliedFilters.categoryId,
    appliedFilters.subcategoryId,
    appliedFilters.tagId,
    draftFilters.categoryId,
    draftFilters.subcategoryId,
    draftFilters.tagId,
    selectedRailCategory,
    triggerLightHaptic,
  ]);

  const handleCancelFilters = useCallback(() => {
    setDraftFilters((_) => cloneFilters(appliedFilters));
    setShowDatePicker(false);
    setFilterSheetVisible(false);
  }, [appliedFilters]);

  const handleResetDraftFilters = useCallback(() => {
    runCalmLayout();
    setDraftFilters(cloneFilters(DEFAULT_DISCOVER_FILTERS));
    setQuickFilters({ ...DEFAULT_QUICK_FILTERS });
    setShowDatePicker(false);
  }, [runCalmLayout]);

  const handleApplyFilters = useCallback(() => {
    triggerLightHaptic();
    runCalmLayout();
    setAppliedFilters((_) => cloneFilters(draftFilters));
    setQuickFilters((prev) => ({
      ...prev,
      free: draftFilters.priceBand === "free",
    }));
    setShowDatePicker(false);
    setFilterSheetVisible(false);
  }, [draftFilters, runCalmLayout, triggerLightHaptic]);

  const handleOpenMapFromFilters = useCallback(() => {
    setFilterSheetVisible(false);
    setShowDatePicker(false);
    setMapExpanded(true);
  }, []);

  const handleExpandedMapShow = useCallback(() => {
    if (expandedMapMountTimerRef.current) {
      clearTimeout(expandedMapMountTimerRef.current);
      expandedMapMountTimerRef.current = null;
    }
    setExpandedMapMounted(false);
    setExpandedMapReady(false);
    expandedMapMountTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setExpandedMapMounted(true);
      expandedMapMountTimerRef.current = null;
    }, 80);
  }, []);

  const handleOpenEventFromList = useCallback(
    (event: Event) => {
      applyTasteInteraction({ type: "open", event });
      router.push(`/event/${event.id}`);
    },
    [applyTasteInteraction, router]
  );

  const handleToggleSaveEvent = useCallback(
    async (event: Event) => {
      if (!isAuthed) {
        setRailNotice("Sign in to save events.");
        router.push("/account");
        return;
      }
      try {
        triggerLightHaptic();
        const savedNow = await toggleSave(toSavedSummary(event));
        if (savedNow) {
          setRailNotice("Saved to your list.");
          applyTasteInteraction({ type: "save", event });
        } else {
          setRailNotice("Removed from saved.");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update saved events";
        setRailNotice(message);
      }
    },
    [isAuthed, router, triggerLightHaptic, toggleSave, applyTasteInteraction]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await request<FiltersResponse>("/api/filters", { timeoutMs: 12000 });
        if (cancelled) return;

        const taxonomy = data.taxonomy?.categories?.length ? data.taxonomy.categories : null;
        setTaxonomyCategories(taxonomy);
        setTaxonomyVersion(data.taxonomy_version ?? null);

        const fallbackTags = data.tags?.length ? data.tags : FALLBACK_TAG_OPTIONS;
        const fallbackCategories = data.categories?.length ? data.categories : FALLBACK_CATEGORY_OPTIONS;

        setAvailableTags(labelsToNodes(fallbackTags, "tag"));
        if (taxonomy) {
          setAvailableCategories(taxonomy.map(({ id, name, slug }) => ({ id, name, slug })));
        } else {
          setAvailableCategories(labelsToNodes(fallbackCategories, "category"));
        }

        setFiltersError(null);
      } catch (err) {
        const message = toDiscoverErrorMessage(err);
        if (!cancelled) {
          setFiltersError(message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const timer = setInterval(() => {
      setClockTick(Date.now());
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") {
      layoutAnimationReadyRef.current = true;
      return;
    }
    if (!UIManager.setLayoutAnimationEnabledExperimental) {
      layoutAnimationReadyRef.current = false;
      return;
    }
    try {
      UIManager.setLayoutAnimationEnabledExperimental(true);
      layoutAnimationReadyRef.current = true;
    } catch {
      layoutAnimationReadyRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedPrefs, storedTaste] = await Promise.all([loadDiscoverPrefs(), loadTasteProfile()]);
      if (cancelled || !mountedRef.current) return;

      if (storedPrefs) {
        if (storedPrefs.userLocation) {
          setUserLocation(storedPrefs.userLocation);
        }
        if (isRailCategoryKey(storedPrefs.selectedRailCategory)) {
          setSelectedRailCategory(storedPrefs.selectedRailCategory);
        }
        setSortMode(storedPrefs.sortMode);
        setQuickFilters(storedPrefs.quickFilters);
        setAppliedFilters((prev) => ({
          ...prev,
          priceBand: storedPrefs.quickFilters.free ? "free" : prev.priceBand,
          date: storedPrefs.dateIso ? new Date(storedPrefs.dateIso) : prev.date,
        }));
        setDraftFilters((prev) => ({
          ...prev,
          priceBand: storedPrefs.quickFilters.free ? "free" : prev.priceBand,
          date: storedPrefs.dateIso ? new Date(storedPrefs.dateIso) : prev.date,
        }));
      }
      setTasteProfile(storedTaste);
      setPrefsHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!prefsHydrated) return;

    const timer = setTimeout(() => {
      saveDiscoverPrefs({
        sortMode,
        selectedRailCategory,
        userLocation,
        quickFilters,
        dateIso: appliedFilters.date ? appliedFilters.date.toISOString() : null,
        updatedAt: Date.now(),
      }).catch(() => undefined);
    }, 450);

    return () => clearTimeout(timer);
  }, [prefsHydrated, sortMode, selectedRailCategory, userLocation, quickFilters, appliedFilters.date]);

  useEffect(() => {
    if (!railNotice) return;
    const timer = setTimeout(() => setRailNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [railNotice]);

  useEffect(() => {
    if (quickFilters.free && appliedFilters.priceBand !== "free") {
      setQuickFilters((prev) => ({ ...prev, free: false }));
    }
  }, [quickFilters.free, appliedFilters.priceBand]);

  useEffect(() => {
    if (sortMode !== "distance") return;
    if (hasValidUserLocation) return;
    setSortMode("soonest");
    setRailNotice("Drop a pin to sort by distance.");
  }, [sortMode, hasValidUserLocation]);

  useEffect(() => {
    if (!quickFilters.tonight) return;
    if (events == null || loading) return;
    if (filteredCardViewModels.length > 0) return;
    setQuickFilters((prev) => ({ ...prev, tonight: false }));
    setRailNotice("No events tonight — showing all.");
  }, [quickFilters.tonight, filteredCardViewModels.length, events, loading]);

  useEffect(() => {
    if (!appliedFilters.categoryId) {
      setSelectedRailCategory((prev) => (prev === "all" ? prev : "all"));
      return;
    }

    const matchedRailCategory = railCategoryById.get(appliedFilters.categoryId);
    if (matchedRailCategory) {
      setSelectedRailCategory((prev) => (prev === matchedRailCategory ? prev : matchedRailCategory));
      return;
    }

    setSelectedRailCategory((prev) => (prev === "all" ? prev : "all"));
  }, [appliedFilters.categoryId, railCategoryById]);

  useEffect(() => {
    if (selectedRailCategory === "all") return;
    if (appliedFilters.categoryId) return;
    const matchedChip = railChips.find((chip) => chip.key === selectedRailCategory);
    if (!matchedChip?.categoryId) return;
    setAppliedFilters((prev) => ({
      ...prev,
      categoryId: matchedChip.categoryId,
      subcategoryId: null,
      tagId: null,
    }));
    setDraftFilters((prev) => ({
      ...prev,
      categoryId: matchedChip.categoryId,
      subcategoryId: null,
      tagId: null,
    }));
  }, [selectedRailCategory, appliedFilters.categoryId, railChips]);

  useEffect(() => {
    selectedRailCategoryRef.current = selectedRailCategory;
  }, [selectedRailCategory]);

  useEffect(() => {
    return () => {
      if (expandedMapMountTimerRef.current) {
        clearTimeout(expandedMapMountTimerRef.current);
        expandedMapMountTimerRef.current = null;
      }
      mountedRef.current = false;
      activeFetchSeqRef.current = fetchSeqRef.current + 1;
      eventsAbortRef.current?.abort();
      eventsAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    mapRegionRef.current = mapRegion;
  }, [mapRegion]);

  useEffect(() => {
    if (mapExpanded) {
      return;
    }
    if (expandedMapMountTimerRef.current) {
      clearTimeout(expandedMapMountTimerRef.current);
      expandedMapMountTimerRef.current = null;
    }
    setExpandedMapMounted(false);
    setExpandedMapReady(false);
    setSelectedEvent(null);
    setSelectedMarkerAnchor(null);
    lastSelectionCameraKeyRef.current = null;
  }, [mapExpanded]);

  useEffect(() => {
    if (!mapExpanded || !expandedMapMounted || !expandedMapReady) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      fitMapToMarkers(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [mapExpanded, expandedMapMounted, expandedMapReady, visibleMapMarkersSignature, fitMapToMarkers]);

  useEffect(() => {
    if (!mapExpanded && pendingNavId) {
      const id = pendingNavId;
      setPendingNavId(null);
      router.push(`/event/${id}`);
    }
  }, [mapExpanded, pendingNavId, router]);

  useEffect(() => {
    if (!selectedEvent) return;
    if (!visibleMapMarkers.some((marker) => marker.id === selectedEvent.id)) {
      setSelectedEvent(null);
    }
  }, [visibleMapMarkers, selectedEvent]);

  useEffect(() => {
    if (selectedEvent) return;
    setSelectedMarkerAnchor(null);
    lastSelectionCameraKeyRef.current = null;
  }, [selectedEvent]);

  useEffect(() => {
    if (!mapExpanded || !expandedMapMounted || !expandedMapReady || !selectedMarkerAnchor) {
      return;
    }
    if (!mapRef.current) {
      return;
    }

    const cameraKey = `${selectedMarkerAnchor.id}:${Math.round(resolvedSheetHeight)}`;
    if (lastSelectionCameraKeyRef.current === cameraKey) {
      return;
    }
    lastSelectionCameraKeyRef.current = cameraKey;

    mapRef.current.fitToCoordinates([selectedMarkerAnchor.coordinate], {
      edgePadding: {
        top: CAMERA_TOP_PADDING,
        right: CAMERA_SIDE_PADDING,
        left: CAMERA_SIDE_PADDING,
        bottom: ctaBottomOffset + resolvedCtaHeight + CAMERA_BOTTOM_BUFFER,
      },
      animated: true,
    });
  }, [
    mapExpanded,
    expandedMapMounted,
    expandedMapReady,
    selectedMarkerAnchor,
    resolvedSheetHeight,
    ctaBottomOffset,
    resolvedCtaHeight,
  ]);

  useEffect(() => {
    if (hasAutoCenteredRef.current) return;
    if (hasValidUserLocation) return;
    if (visibleMapMarkers.length === 0) return;

    const firstMarker = visibleMapMarkers[0];
    if (!firstMarker) {
      return;
    }

    hasAutoCenteredRef.current = true;

    const current = mapRegionRef.current ?? DEFAULT_REGION;
    const nextRegion = {
      latitude: firstMarker.coordinate.latitude,
      longitude: firstMarker.coordinate.longitude,
      latitudeDelta: current.latitudeDelta ?? 0.2,
      longitudeDelta: current.longitudeDelta ?? 0.2,
    };

    setMapRegion(nextRegion);
  }, [visibleMapMarkers, hasValidUserLocation]);

  const sanitizeFilters = useCallback(
    (filters: DiscoverFilters): DiscoverFilters => {
      const next = cloneFilters(filters);
      const validCategoryIds = new Set(availableCategories.map((item) => item.id));
      const validFallbackTagIds = new Set(availableTags.map((item) => item.id));
      const validFeatureSet = new Set(venueFeatureOptions);

      if (next.categoryId && !validCategoryIds.has(next.categoryId)) {
        next.categoryId = null;
      }

      if (taxonomyEnabled) {
        if (!next.categoryId) {
          next.subcategoryId = null;
          next.tagId = null;
        } else {
          const category = taxonomyCategories?.find((item) => item.id === next.categoryId) ?? null;
          const validSubcategoryIds = new Set((category?.subcategories ?? []).map((item) => item.id));

          if (next.subcategoryId && !validSubcategoryIds.has(next.subcategoryId)) {
            next.subcategoryId = null;
          }

          if (!next.subcategoryId) {
            next.tagId = null;
          } else {
            const subcategory = category?.subcategories.find((item) => item.id === next.subcategoryId) ?? null;
            const validTagIds = new Set((subcategory?.tags ?? []).map((item) => item.id));
            if (next.tagId && !validTagIds.has(next.tagId)) {
              next.tagId = null;
            }
          }
        }
      } else {
        next.subcategoryId = null;
        if (next.tagId && !validFallbackTagIds.has(next.tagId)) {
          next.tagId = null;
        }
      }

      if (next.venueFeatures.length > 0) {
        next.venueFeatures = next.venueFeatures.filter((feature) => validFeatureSet.has(feature));
      }

      return next;
    },
    [availableCategories, availableTags, taxonomyEnabled, taxonomyCategories, venueFeatureOptions]
  );

  useEffect(() => {
    setAppliedFilters((prev) => {
      const next = sanitizeFilters(prev);
      return filtersEqual(prev, next) ? prev : next;
    });

    setDraftFilters((prev) => {
      const next = sanitizeFilters(prev);
      return filtersEqual(prev, next) ? prev : next;
    });
  }, [sanitizeFilters]);

  const checkDbHealth = useCallback(async () => {
    try {
      await request<{ status: string; db: string }>("/api/health/db", { timeoutMs: 5000 });
      return true;
    } catch {
      return false;
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    const seq = fetchSeqRef.current + 1;
    fetchSeqRef.current = seq;
    activeFetchSeqRef.current = seq;

    eventsAbortRef.current?.abort();
    const abortController = new AbortController();
    eventsAbortRef.current = abortController;

    const railAtStart = selectedRailCategoryRef.current;
    const isActiveRequest = () => activeFetchSeqRef.current === seq;

    setLoading(true);

    try {
      const searchParams = new URLSearchParams();
      const trimmedSearch = debouncedQuery.trim();

      if (debouncedAppliedTagSlug) searchParams.append("tag", debouncedAppliedTagSlug);
      if (debouncedAppliedCategorySlug) searchParams.append("category", debouncedAppliedCategorySlug);
      if (debouncedAppliedSubcategorySlug) searchParams.append("subcategory", debouncedAppliedSubcategorySlug);
      if (appliedFilters.date) searchParams.append("date", appliedFilters.date.toISOString().split("T")[0]);
      if (appliedFilters.minRating != null) searchParams.append("min_rating", String(appliedFilters.minRating));
      if (trimmedSearch) searchParams.append("q", trimmedSearch);
      searchParams.append("sort", "soonest");

      if (hasValidUserLocation && userLocation) {
        searchParams.append("lat", String(userLocation.latitude));
        searchParams.append("lng", String(userLocation.longitude));
      }

      if (appliedFilters.radiusKm != null && hasValidUserLocation && userLocation) {
        searchParams.append("radius_km", String(appliedFilters.radiusKm));
      }

      const qs = searchParams.toString();
      const data = await request<{ events?: unknown }>(qs ? `/api/events?${qs}` : "/api/events", {
        timeoutMs: 20000,
        signal: abortController.signal,
      });
      if (!isActiveRequest()) {
        return;
      }

      const nextEvents = sanitizeEventsPayload(data.events);

      if (railAtStart !== "all" && nextEvents.length === 0) {
        setRailNotice("No events found — showing all events.");
        setSelectedRailCategory("all");

        setAppliedFilters((prev) => {
          if (prev.categoryId == null && prev.subcategoryId == null && prev.tagId == null) {
            return prev;
          }
          return {
            ...prev,
            categoryId: null,
            subcategoryId: null,
            tagId: null,
          };
        });

        setDraftFilters((prev) => ({
          ...prev,
          categoryId: null,
          subcategoryId: null,
          tagId: null,
        }));

        setError(null);
        setIsUsingCachedResults(false);
        setCachedIndicator(null);
        return;
      }

      setEvents(nextEvents);
      if (nextEvents.length > 0) {
        lastSuccessfulEventsRef.current = nextEvents;
      }

      setError(null);
      setIsUsingCachedResults(false);
      setCachedIndicator(null);
    } catch (err) {
      if (!isActiveRequest()) {
        return;
      }

      const message = toDiscoverErrorMessage(err);
      if (message === "Request canceled") {
        return;
      }

      const dbHealthy = await checkDbHealth();
      if (!isActiveRequest()) {
        return;
      }

      const cachedEvents = lastSuccessfulEventsRef.current;

      if (cachedEvents && cachedEvents.length > 0) {
        setEvents(cachedEvents);
        setError(null);
        setIsUsingCachedResults(true);
        setCachedIndicator(dbHealthy ? "Cached results" : "Offline / Cached results");
      } else {
        setError(message);
        setIsUsingCachedResults(false);
        setCachedIndicator(null);
      }

      console.error("Discover fetch error", message);
    } finally {
      if (!isActiveRequest()) {
        return;
      }
      if (eventsAbortRef.current === abortController) {
        eventsAbortRef.current = null;
      }
      setLoading(false);
    }
  }, [
    debouncedQuery,
    debouncedAppliedTagSlug,
    debouncedAppliedCategorySlug,
    debouncedAppliedSubcategorySlug,
    appliedFilters.date,
    appliedFilters.minRating,
    appliedFilters.radiusKm,
    userLocation,
    hasValidUserLocation,
    checkDbHealth,
  ]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchEvents();
    } finally {
      setRefreshing(false);
    }
  }, [fetchEvents]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={PALETTE.accent}
            colors={[PALETTE.accent]}
          />
        )}
      >
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search events, venues, tags"
          placeholderTextColor={PALETTE.muted}
          style={styles.searchInput}
        />

        <View style={styles.discoverControlStrip}>
          <View style={styles.categoryModeSection}>
            <View style={styles.categoryRailWrap}>
              <CategoryRail chips={railChips} selectedKey={selectedRailCategory} onSelect={handleSelectRailChip} />
              {railNotice && (
                <View style={styles.railNoticePill}>
                  <Text style={styles.railNoticeText}>{railNotice}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.secondaryControlsSection}>
            <View style={styles.smartControlsWrap}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.smartControlsRow}
              >
                {SORT_CHIPS.map((chip) => {
                  const active = sortMode === chip.key;
                  const unavailable = chip.key === "distance" && !hasValidUserLocation;
                  return (
                    <Pressable
                      key={chip.key}
                      onPress={() => handleSelectSortChip(chip.key)}
                      style={[
                        styles.smartChip,
                        active && styles.smartChipActive,
                        unavailable && styles.smartChipDisabled,
                      ]}
                    >
                      <Text style={[styles.smartChipText, active && styles.smartChipTextActive]}>
                        {chip.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.smartControlsRow}>
                <Pressable
                  onPress={() => handleToggleQuickFilter("free")}
                  style={[styles.smartChip, quickFilters.free && styles.smartChipActive]}
                >
                  <Text style={[styles.smartChipText, quickFilters.free && styles.smartChipTextActive]}>Free</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleToggleQuickFilter("tonight")}
                  style={[styles.smartChip, quickFilters.tonight && styles.smartChipActive]}
                >
                  <Text style={[styles.smartChipText, quickFilters.tonight && styles.smartChipTextActive]}>Tonight</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleToggleQuickFilter("highRated")}
                  style={[styles.smartChip, quickFilters.highRated && styles.smartChipActive]}
                >
                  <Text style={[styles.smartChipText, quickFilters.highRated && styles.smartChipTextActive]}>4.5+</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {activeFilterChips.length > 0 && (
            <View style={styles.filterSummarySection}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeFilterRow}>
                {activeFilterChips.map((chip) => (
                  <Pressable key={chip.key} style={styles.activeFilterChip} onPress={() => handleClearActiveChip(chip.key)}>
                    <Text style={styles.activeFilterChipText}>{chip.label} ×</Text>
                  </Pressable>
                ))}
                <Pressable style={styles.activeFilterChip} onPress={clearAllFilters}>
                  <Text style={styles.activeFilterChipText}>Clear all</Text>
                </Pressable>
              </ScrollView>
            </View>
          )}
        </View>

        <View style={styles.embeddedMapContainer}>
          <EventMap
            variant="preview"
            events={visibleMapMarkers}
            userPin={hasValidUserLocation ? userLocation : null}
            defaultRegion={DEFAULT_REGION}
            region={getPreviewRegion()}
          />
          <Pressable style={styles.expandMapCta} onPress={() => setMapExpanded(true)}>
            <Text style={styles.expandMapCtaText}>Expand Map</Text>
          </Pressable>
        </View>

        <Pressable style={styles.filtersButton} onPress={handleOpenFilters}>
          <Text style={styles.filtersButtonText}>
            {activeFilterCount > 0 ? `Filters • ${activeFilterCount}` : "Filters"}
          </Text>
        </Pressable>

        <View style={styles.eventsSection}>
          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>Events</Text>
            {loading && <ActivityIndicator size="small" color={PALETTE.accent} />}
          </View>

          {showForYouRail && (
            <View style={styles.forYouSection}>
              <Text style={styles.forYouTitle}>For You</Text>
              <Text style={styles.forYouSubtitle}>Based on what you save and view</Text>
              <FlatList
                data={forYouItems}
                horizontal
                keyExtractor={(item) => `foryou-${item.model.id}`}
                contentContainerStyle={styles.forYouRow}
                ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
                showsHorizontalScrollIndicator={false}
                renderItem={({ item }) => (
                  <ForYouMiniCard
                    title={item.model.title}
                    timeLabel={item.model.timeLabel}
                    reasonLabel={item.reasonLabel}
                    imageUrl={item.model.coverImageUrl}
                    onPress={() => handleOpenEventFromList(item.model.event)}
                  />
                )}
              />
            </View>
          )}

          {!showForYouRail && !hasTasteSignals && (
            <View style={styles.vibePickerCard}>
              <Text style={styles.vibePickerTitle}>Pick your vibe</Text>
              <Text style={styles.vibePickerSubtitle}>Seed smarter recommendations instantly</Text>
              <View style={styles.vibePickerRow}>
                {VIBE_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    style={styles.vibeChip}
                    onPress={() => handlePickVibe(option.label)}
                  >
                    <Text style={styles.vibeChipText}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {isUsingCachedResults && cachedIndicator && (
            <View style={styles.cachedPill}>
              <Text style={styles.cachedPillText}>{cachedIndicator}</Text>
            </View>
          )}

          {!isUsingCachedResults && error && <Text style={styles.error}>Error: {error}</Text>}

          {loading && events === null && (
            <View style={{ gap: 10 }}>
              {[0, 1, 2].map((item) => (
                <View key={item} style={styles.skeletonCard}>
                  <View style={[styles.skeletonLine, styles.skeletonLineWide]} />
                  <View style={styles.skeletonLine} />
                  <View style={styles.skeletonRow}>
                    <View style={styles.skeletonPill} />
                    <View style={styles.skeletonPill} />
                    <View style={styles.skeletonPill} />
                  </View>
                </View>
              ))}
            </View>
          )}

          {events && sortedCardViewModels.length === 0 && !loading && !error && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No events match the filters.</Text>
              <Text style={styles.emptySubtitle}>Try clearing filters or dropping a pin to widen the search.</Text>
              <View style={styles.emptyActions}>
                <Pressable
                  style={styles.emptyButton}
                  onPress={() => {
                    clearAllFilters();
                    setSearchQuery("");
                    setDebouncedQuery("");
                  }}
                >
                  <Text style={styles.emptyButtonText}>Clear filters</Text>
                </Pressable>
                <Pressable style={styles.emptyButton} onPress={() => setMapExpanded(true)}>
                  <Text style={styles.emptyButtonText}>Drop a pin</Text>
                </Pressable>
              </View>
            </View>
          )}

          {sortedCardViewModels.length > 0 && (
            <FlatList
              data={sortedCardViewModels}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              renderItem={({ item }) => (
                <EventCard
                  model={item}
                  onPress={() => handleOpenEventFromList(item.event)}
                  saved={isEventSaved(item.id)}
                  savePending={pendingSaveIds.has(item.id)}
                  saveDisabledReason={!isAuthed ? "Sign in to save events." : null}
                  onToggleSave={() => handleToggleSaveEvent(item.event)}
                />
              )}
            />
          )}
        </View>

        <Modal visible={filterSheetVisible} transparent animationType="slide" onRequestClose={handleCancelFilters}>
          <View style={styles.filterSheetOverlay}>
            <Pressable style={styles.filterSheetBackdrop} onPress={handleCancelFilters} />
            <View style={styles.filterSheetContainer}>
              <View style={styles.sheetHandle} />
              <View style={styles.filterSheetHeader}>
                <Text style={styles.sheetTitle}>Filters</Text>
                <Text style={styles.sheetSubtitle}>Quick Filters</Text>
              </View>

              {filtersError && (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>Filters unavailable: {filtersError}</Text>
                </View>
              )}

              <ScrollView contentContainerStyle={styles.filterSheetBody}>
                <View style={{ gap: 6 }}>
                  <Text style={styles.chipLabel}>Date</Text>
                  <View style={styles.row}>
                    <Pressable style={styles.badge} onPress={() => setShowDatePicker((prev) => !prev)}>
                      <Text style={styles.badgeText}>
                        {draftFilters.date ? draftFilters.date.toLocaleDateString() : "Pick date"}
                      </Text>
                    </Pressable>
                    {draftFilters.date && (
                      <Pressable
                        style={styles.badge}
                        onPress={() => {
                          setDraftFilters((prev) => ({ ...prev, date: null }));
                        }}
                      >
                        <Text style={styles.badgeText}>Clear</Text>
                      </Pressable>
                    )}
                  </View>
                  {showDatePicker && (
                    <View style={styles.pickerWrap}>
                      <DateTimePicker
                        value={draftFilters.date ?? new Date()}
                        mode="date"
                        display={Platform.OS === "ios" ? "inline" : "calendar"}
                        themeVariant="dark"
                        textColor={PALETTE.text}
                        onChange={(_, date) => {
                          setShowDatePicker(false);
                          if (date) {
                            setDraftFilters((prev) => ({ ...prev, date }));
                          }
                        }}
                      />
                    </View>
                  )}
                </View>

                <NodeFilterChips
                  label="Category"
                  options={availableCategories}
                  selectedId={draftFilters.categoryId}
                  onSelect={(node) => {
                    setDraftFilters((prev) => {
                      if (!node) {
                        return {
                          ...prev,
                          categoryId: null,
                          subcategoryId: null,
                          tagId: null,
                        };
                      }

                      if (prev.categoryId === node.id) {
                        return {
                          ...prev,
                          categoryId: null,
                          subcategoryId: null,
                          tagId: null,
                        };
                      }

                      return {
                        ...prev,
                        categoryId: node.id,
                        subcategoryId: null,
                        tagId: null,
                      };
                    });
                  }}
                />

                <View style={{ gap: 6 }}>
                  <Text style={styles.chipLabel}>Distance</Text>
                  <View style={styles.row}>
                    <Pressable
                      onPress={() => setDraftFilters((prev) => ({ ...prev, radiusKm: null }))}
                      style={[styles.badge, draftFilters.radiusKm == null && styles.badgeSelected]}
                    >
                      <Text style={[styles.badgeText, draftFilters.radiusKm == null && styles.badgeSelectedText]}>Any</Text>
                    </Pressable>
                    {RADIUS_OPTIONS.map((radius) => {
                      const selected = draftFilters.radiusKm === radius;
                      const disabled = !userLocation;
                      return (
                        <Pressable
                          key={radius}
                          onPress={() => {
                            if (!userLocation) {
                              handleOpenMapFromFilters();
                              return;
                            }
                            setDraftFilters((prev) => ({
                              ...prev,
                              radiusKm: selected ? null : radius,
                            }));
                          }}
                          style={[styles.badge, selected && styles.badgeSelected, disabled && styles.badgeDisabled]}
                        >
                          <Text
                            style={[
                              styles.badgeText,
                              selected && styles.badgeSelectedText,
                              disabled && styles.badgeDisabledText,
                            ]}
                          >
                            {radius} km
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.helperText}>Location pin: {locationLabel}</Text>
                    <Pressable style={styles.badge} onPress={handleOpenMapFromFilters}>
                      <Text style={styles.badgeText}>{userLocation ? "Move pin" : "Drop pin"}</Text>
                    </Pressable>
                    {userLocation && (
                      <Pressable
                        style={styles.badge}
                        onPress={() => {
                          setUserLocation(null);
                          setDraftFilters((prev) => ({ ...prev, radiusKm: null }));
                        }}
                      >
                        <Text style={styles.badgeText}>Clear</Text>
                      </Pressable>
                    )}
                  </View>
                </View>

                <OptionChips
                  label="Price"
                  options={PRICE_OPTIONS}
                  selected={draftFilters.priceBand}
                  onSelect={(value) => {
                    setDraftFilters((prev) => ({ ...prev, priceBand: value as PriceBand }));
                  }}
                />

                <Pressable
                  style={styles.advancedToggle}
                  onPress={() => {
                    runCalmLayout();
                    setAdvancedExpanded((prev) => !prev);
                  }}
                >
                  <Text style={styles.advancedToggleText}>Advanced Filters</Text>
                  <Text style={styles.advancedToggleIcon}>{advancedExpanded ? "▲" : "▼"}</Text>
                </Pressable>

                {advancedExpanded && (
                  <View style={styles.advancedBlock}>
                    {taxonomyEnabled ? (
                      <>
                        {draftFilters.categoryId ? (
                          <NodeFilterChips
                            label="Subcategory"
                            options={draftSubcategoryOptions}
                            selectedId={draftFilters.subcategoryId}
                            onSelect={(node) => {
                              setDraftFilters((prev) => ({
                                ...prev,
                                subcategoryId: prev.subcategoryId === node?.id ? null : node?.id ?? null,
                                tagId: null,
                              }));
                            }}
                          />
                        ) : (
                          <Text style={styles.helperText}>Pick a category first to unlock tags.</Text>
                        )}

                        {draftFilters.subcategoryId && (
                          <NodeFilterChips
                            label="Tags"
                            options={draftHierarchyTagOptions}
                            selectedId={draftFilters.tagId}
                            onSelect={(node) => {
                              setDraftFilters((prev) => ({
                                ...prev,
                                tagId: prev.tagId === node?.id ? null : node?.id ?? null,
                              }));
                            }}
                          />
                        )}
                      </>
                    ) : (
                      <NodeFilterChips
                        label="Tags"
                        options={availableTags}
                        selectedId={draftFilters.tagId}
                        onSelect={(node) => {
                          setDraftFilters((prev) => ({
                            ...prev,
                            tagId: prev.tagId === node?.id ? null : node?.id ?? null,
                          }));
                        }}
                      />
                    )}

                    <View style={{ gap: 6 }}>
                      <Text style={styles.chipLabel}>
                        Rating: {draftFilters.minRating != null ? draftFilters.minRating.toFixed(1) : "Any"}
                      </Text>
                      <Slider
                        value={draftFilters.minRating ?? 0}
                        minimumValue={0}
                        maximumValue={5}
                        step={0.5}
                        minimumTrackTintColor={PALETTE.accent}
                        maximumTrackTintColor={PALETTE.line}
                        thumbTintColor={PALETTE.accent}
                        onValueChange={(value) => {
                          setDraftFilters((prev) => ({
                            ...prev,
                            minRating: value === 0 ? null : value,
                          }));
                        }}
                      />
                    </View>

                    <View style={{ gap: 6 }}>
                      <Text style={styles.chipLabel}>Venue features</Text>
                      <View style={styles.badgeRow}>
                        {venueFeatureOptions.length === 0 && (
                          <Text style={styles.helperText}>No feature metadata available yet.</Text>
                        )}
                        {venueFeatureOptions.map((feature) => {
                          const selected = draftFilters.venueFeatures.includes(feature);
                          return (
                            <Pressable
                              key={feature}
                              onPress={() => {
                                setDraftFilters((prev) => {
                                  const exists = prev.venueFeatures.includes(feature);
                                  const venueFeatures = exists
                                    ? prev.venueFeatures.filter((item) => item !== feature)
                                    : [...prev.venueFeatures, feature];
                                  return { ...prev, venueFeatures };
                                });
                              }}
                              style={[styles.badge, selected && styles.badgeSelected]}
                            >
                              <Text style={[styles.badgeText, selected && styles.badgeSelectedText]}>
                                {formatFeatureLabel(feature)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <OptionChips
                      label="Audience"
                      options={AUDIENCE_OPTIONS}
                      selected={draftFilters.audience ?? ""}
                      allowClear
                      onSelect={(value) => {
                        setDraftFilters((prev) => ({
                          ...prev,
                          audience: value ? (value as AudienceSegment) : null,
                        }));
                      }}
                    />

                    {taxonomyVersion && <Text style={styles.helperText}>Taxonomy version: {taxonomyVersion}</Text>}
                  </View>
                )}
              </ScrollView>

              <View style={styles.filterActionRow}>
                <Pressable style={styles.secondaryAction} onPress={handleCancelFilters}>
                  <Text style={styles.secondaryActionText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.secondaryAction} onPress={handleResetDraftFilters}>
                  <Text style={styles.secondaryActionText}>Reset</Text>
                </Pressable>
                <Pressable style={styles.primaryAction} onPress={handleApplyFilters}>
                  <Text style={styles.primaryActionText}>Apply</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={mapExpanded} animationType="slide" onShow={handleExpandedMapShow} onRequestClose={() => setMapExpanded(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalActionsLeft}>
              <Pressable style={styles.modalActionButton} onPress={() => setMapExpanded(false)}>
                <Text style={styles.modalCloseText}>Close Map</Text>
              </Pressable>
              {userLocation && (
                <Pressable
                  style={styles.modalActionButton}
                  onPress={() => {
                    setUserLocation(null);
                    setAppliedFilters((prev) => ({ ...prev, radiusKm: null }));
                    setDraftFilters((prev) => ({ ...prev, radiusKm: null }));
                  }}
                >
                  <Text style={styles.modalCloseText}>Clear pin</Text>
                </Pressable>
              )}
            </View>

            {showListOverlay && (
              <View style={styles.hideListContainer}>
                <Pressable style={styles.modalActionButton} onPress={() => setShowListOverlay(false)}>
                  <Text style={styles.modalCloseText}>Hide list</Text>
                </Pressable>
              </View>
            )}

            <View style={styles.pinHint}>
              <Text style={styles.pinHintText}>
                {userLocation ? "Drag the pin to adjust your location." : "Long-press the map to drop your location pin."}
              </Text>
            </View>

            {expandedMapMounted ? (
              <EventMap
                ref={mapRef}
                variant="full"
                events={visibleMapMarkers}
                userPin={hasValidUserLocation ? userLocation : null}
                defaultRegion={DEFAULT_REGION}
                selectedEventId={selectedEvent?.id ?? null}
                onMapReady={() => setExpandedMapReady(true)}
                onRegionChangeComplete={handleExpandedMapRegionChangeComplete}
                onLongPress={handleDropPin}
                onUserPinDragEnd={handleDropPin}
                onMarkerPress={handleMapMarkerPress}
                showLoadingOverlay
              />
            ) : (
              <View style={styles.expandedMapPlaceholder}>
                <ActivityIndicator size="small" color={PALETTE.accent} />
                <Text style={styles.expandedMapPlaceholderText}>Loading map...</Text>
              </View>
            )}

            {selectedEvent && (
              <View
                style={[
                  styles.sheet,
                  {
                    paddingBottom: 14 + insets.bottom,
                  },
                ]}
                onLayout={(event) => {
                  const nextHeight = event.nativeEvent.layout.height;
                  if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
                    return;
                  }
                  setSelectedCardHeight(nextHeight);
                }}
              >
                <View style={styles.sheetHeaderRow}>
                  <Text style={styles.sheetEventTitle} numberOfLines={1}>
                    {selectedEvent.title}
                  </Text>
                  <Pressable onPress={() => setSelectedEvent(null)} style={styles.sheetClose}>
                    <Text style={styles.sheetCloseText}>Close</Text>
                  </Pressable>
                </View>
                {selectedEvent.location?.name && <Text style={styles.sheetMeta}>{selectedEvent.location.name}</Text>}
                {selectedEvent.category && <Text style={styles.sheetMeta}>{selectedEvent.category}</Text>}
                <Pressable style={styles.sheetButton} onPress={() => handleOpenEvent(selectedEvent)}>
                  <Text style={styles.sheetButtonText}>Open event</Text>
                </Pressable>
              </View>
            )}

            {showListOverlay && (
              <View style={styles.overlayList}>
                <View style={styles.overlayHeader}>
                  <Text style={styles.overlayTitle}>Events in view</Text>
                  <Pressable onPress={() => setShowListOverlay(false)}>
                    <Text style={styles.overlayClose}>Close</Text>
                  </Pressable>
                </View>
                <FlatList
                  data={visibleEvents}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ paddingBottom: insets.bottom + BOTTOM_GAP }}
                  ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                  renderItem={({ item }) => (
                    <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} onPress={() => handleOpenEvent(item)}>
                      <Text style={styles.cardTitle}>{item.title}</Text>
                      {item.category && <Text style={styles.cardMeta}>{item.category}</Text>}
                      <Text style={styles.cardMeta}>{item.location?.name ?? "Unknown location"}</Text>
                      {item.distance_km != null && <Text style={styles.cardMeta}>{item.distance_km.toFixed(1)} km away</Text>}
                    </Pressable>
                  )}
                />
              </View>
            )}

            {!showListOverlay && (
              <View style={[styles.listToggleContainer, { bottom: ctaBottomOffset }]}>
                <Pressable
                  style={styles.modalActionButton}
                  onLayout={(event) => {
                    const nextHeight = event.nativeEvent.layout.height;
                    if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
                      return;
                    }
                    setCtaHeight(nextHeight);
                  }}
                  onPress={() => setShowListOverlay(true)}
                >
                  <Text style={styles.modalCloseText}>Show list</Text>
                </Pressable>
              </View>
            )}
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

type NodeChipsProps = {
  label: string;
  options: TaxonomyNode[];
  selectedId: string | null;
  onSelect: (value: TaxonomyNode | null) => void;
};

function NodeFilterChips({ label, options, selectedId, onSelect }: NodeChipsProps) {
  if (options.length === 0) {
    return null;
  }

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.badgeRow}>
        {options.map((option) => {
          const selected = selectedId === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => onSelect(selected ? null : option)}
              style={[styles.badge, selected && styles.badgeSelected]}
            >
              <Text style={[styles.badgeText, selected && styles.badgeSelectedText]}>{option.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type OptionChipsProps = {
  label: string;
  options: Option[];
  selected: string;
  onSelect: (value: string) => void;
  allowClear?: boolean;
};

function OptionChips({ label, options, selected, onSelect, allowClear = false }: OptionChipsProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.badgeRow}>
        {allowClear && (
          <Pressable
            onPress={() => onSelect("")}
            style={[styles.badge, !selected && styles.badgeSelected]}
          >
            <Text style={[styles.badgeText, !selected && styles.badgeSelectedText]}>Any</Text>
          </Pressable>
        )}
        {options.map((option) => {
          const active = selected === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onSelect(option.value)}
              style={[styles.badge, active && styles.badgeSelected]}
            >
              <Text style={[styles.badgeText, active && styles.badgeSelectedText]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: PALETTE.background,
    flex: 1,
  },
  container: {
    padding: 16,
    gap: 12,
    paddingBottom: 24,
  },
  searchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: PALETTE.text,
    backgroundColor: PALETTE.surface,
    fontSize: 14,
  },
  discoverControlStrip: {
    backgroundColor: PALETTE.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  categoryModeSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PALETTE.line,
    paddingBottom: 10,
  },
  categoryRailWrap: {
    gap: 8,
  },
  secondaryControlsSection: {
    gap: 6,
    paddingTop: 2,
  },
  smartControlsWrap: {
    gap: 6,
  },
  smartControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  smartChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    backgroundColor: PALETTE.surfaceAlt,
  },
  smartChipActive: {
    backgroundColor: PALETTE.accentSoft,
    borderColor: PALETTE.line,
  },
  smartChipDisabled: {
    opacity: 0.55,
  },
  smartChipText: {
    color: PALETTE.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  smartChipTextActive: {
    color: PALETTE.accent,
  },
  filterSummarySection: {
    paddingTop: 2,
  },
  activeFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  activeFilterChip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    backgroundColor: PALETTE.surfaceAlt,
  },
  activeFilterChipText: {
    color: PALETTE.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  railNoticePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    backgroundColor: PALETTE.surfaceAlt,
  },
  railNoticeText: {
    color: PALETTE.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  embeddedMapContainer: {
    height: 240,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  expandMapCta: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "rgba(17, 15, 27, 0.94)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(245, 243, 255, 0.2)",
    shadowColor: "#07060d",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  expandMapCtaText: {
    color: PALETTE.text,
    fontSize: 12,
    fontWeight: "700",
  },
  filtersButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: PALETTE.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  filtersButtonText: {
    color: PALETTE.accent,
    fontWeight: "700",
    fontSize: 13,
  },
  eventsSection: {
    marginTop: -10,
    paddingTop: 18,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: PALETTE.background,
    zIndex: 2,
    gap: 10,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: PALETTE.text,
  },
  forYouSection: {
    gap: 8,
  },
  forYouTitle: {
    color: PALETTE.text,
    fontSize: 17,
    fontWeight: "700",
  },
  forYouSubtitle: {
    color: PALETTE.muted,
    fontSize: 12,
    fontWeight: "500",
  },
  forYouRow: {
    paddingRight: 12,
  },
  vibePickerCard: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: PALETTE.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    gap: 8,
  },
  vibePickerTitle: {
    color: PALETTE.text,
    fontSize: 15,
    fontWeight: "700",
  },
  vibePickerSubtitle: {
    color: PALETTE.muted,
    fontSize: 12,
  },
  vibePickerRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  vibeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    backgroundColor: PALETTE.accentSoft,
  },
  vibeChipText: {
    color: PALETTE.accent,
    fontSize: 12,
    fontWeight: "600",
  },
  cachedPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    backgroundColor: PALETTE.accentSoft,
  },
  cachedPillText: {
    color: PALETTE.accent,
    fontSize: 12,
    fontWeight: "600",
  },
  error: {
    color: PALETTE.danger,
    fontSize: 13,
  },
  card: {
    backgroundColor: PALETTE.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    gap: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: PALETTE.text,
  },
  cardMeta: {
    fontSize: 13,
    color: PALETTE.muted,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: PALETTE.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  badgeText: {
    fontSize: 12,
    color: PALETTE.accent,
  },
  badgeSelected: {
    backgroundColor: PALETTE.accent,
    borderColor: PALETTE.accent,
  },
  badgeSelectedText: {
    color: "#fff",
  },
  badgeDisabled: {
    opacity: 0.6,
  },
  badgeDisabledText: {
    color: PALETTE.muted,
  },
  emptyState: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: PALETTE.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: PALETTE.text,
  },
  emptySubtitle: {
    fontSize: 13,
    color: PALETTE.muted,
  },
  emptyActions: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 4,
  },
  emptyButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: PALETTE.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  emptyButtonText: {
    color: PALETTE.accent,
    fontWeight: "600",
    fontSize: 13,
  },
  skeletonCard: {
    backgroundColor: PALETTE.surface,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 6,
    backgroundColor: PALETTE.surfaceAlt,
  },
  skeletonLineWide: {
    width: "70%",
  },
  skeletonRow: {
    flexDirection: "row",
    gap: 8,
  },
  skeletonPill: {
    height: 20,
    width: 54,
    borderRadius: 10,
    backgroundColor: PALETTE.surfaceAlt,
  },
  filterSheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  filterSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,3,8,0.6)",
  },
  filterSheetContainer: {
    backgroundColor: PALETTE.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    maxHeight: Dimensions.get("window").height * 0.86,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: PALETTE.line,
  },
  filterSheetHeader: {
    gap: 2,
  },
  sheetSubtitle: {
    color: PALETTE.muted,
    fontSize: 13,
  },
  filterSheetBody: {
    gap: 12,
    paddingBottom: 10,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: PALETTE.muted,
  },
  helperText: {
    fontSize: 12,
    color: PALETTE.muted,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  notice: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: PALETTE.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  noticeText: {
    fontSize: 12,
    color: PALETTE.muted,
  },
  advancedToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    backgroundColor: PALETTE.surfaceAlt,
  },
  advancedToggleText: {
    color: PALETTE.text,
    fontWeight: "600",
    fontSize: 13,
  },
  advancedToggleIcon: {
    color: PALETTE.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  advancedBlock: {
    gap: 12,
  },
  pickerWrap: {
    backgroundColor: PALETTE.surfaceAlt,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  filterActionRow: {
    flexDirection: "row",
    gap: 8,
  },
  secondaryAction: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: PALETTE.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  secondaryActionText: {
    color: PALETTE.text,
    fontWeight: "600",
    fontSize: 13,
  },
  primaryAction: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: PALETTE.accent,
  },
  primaryActionText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: PALETTE.background,
  },
  expandedMapPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: PALETTE.background,
  },
  expandedMapPlaceholderText: {
    color: PALETTE.text,
    fontSize: 12,
    fontWeight: "600",
  },
  modalCloseText: {
    color: PALETTE.text,
    fontWeight: "600",
  },
  modalActionButton: {
    backgroundColor: "rgba(22,20,34,0.85)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  modalActionsLeft: {
    position: "absolute",
    top: 40,
    left: 12,
    zIndex: 10,
    flexDirection: "row",
    gap: 8,
  },
  pinHint: {
    position: "absolute",
    top: 90,
    left: 12,
    right: 12,
    zIndex: 10,
    alignItems: "center",
  },
  pinHintText: {
    color: PALETTE.text,
    fontSize: 12,
    textAlign: "center",
    backgroundColor: "rgba(18,16,30,0.8)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    overflow: "hidden",
  },
  listToggleContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  hideListContainer: {
    position: "absolute",
    top: 40,
    right: 12,
    zIndex: 10,
  },
  overlayList: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: Dimensions.get("window").height * 0.5,
    backgroundColor: PALETTE.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 12,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  overlayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  overlayTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: PALETTE.text,
  },
  overlayClose: {
    color: PALETTE.accent,
    fontWeight: "600",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: PALETTE.surface,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    gap: 6,
    minHeight: 136,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sheetEventTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: PALETTE.text,
    flex: 1,
    marginRight: 8,
  },
  sheetClose: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sheetCloseText: {
    color: PALETTE.accent,
    fontWeight: "600",
  },
  sheetMeta: {
    fontSize: 12,
    color: PALETTE.muted,
  },
  sheetButton: {
    marginTop: 4,
    backgroundColor: PALETTE.accent,
    paddingVertical: 9,
    borderRadius: 999,
    alignItems: "center",
  },
  sheetButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: PALETTE.text,
  },
});
