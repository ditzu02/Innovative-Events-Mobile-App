import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import Slider from "@react-native-community/slider";
import MapView, { Callout, Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { EventCard, EventCardViewModel } from "@/components/EventCard";
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

type Event = {
  id: string;
  title: string;
  category: string | null;
  start_time: string;
  end_time: string;
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

const FALLBACK_TAG_OPTIONS = ["Rock", "Jazz", "Outdoor", "Dj", "Live", "Electronic"];
const FALLBACK_CATEGORY_OPTIONS = ["Music", "Party", "Art"];
const RADIUS_OPTIONS = [5, 10, 25, 50];
const DEFAULT_REGION: Region = {
  latitude: 48.2082,
  longitude: 16.3738,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};
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
const USER_PIN_COLOR = PALETTE.accent;

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
  const source = category?.trim() || title.trim();
  if (!source) return "EV";
  const match = source.match(/[A-Za-z0-9]/);
  return (match?.[0] ?? "E").toUpperCase();
}

function getStatusLabel(
  status: Exclude<EventStatus, "ENDED">,
  startTime: string,
  now: Date
): string | null {
  if (status === "LIVE") {
    return "LIVE NOW";
  }

  if (status === "SOON") {
    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) {
      return "Starts Soon";
    }
    const hours = Math.max(1, Math.ceil((start.getTime() - now.getTime()) / (60 * 60 * 1000)));
    return `Starts in ${hours}h`;
  }

  return null;
}

export default function DiscoverScreen() {
  const router = useRouter();

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
  const [pendingNavId, setPendingNavId] = useState<string | null>(null);
  const [showListOverlay, setShowListOverlay] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region>(DEFAULT_REGION);
  const [mapReady, setMapReady] = useState(false);
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
  const [clockTick, setClockTick] = useState<number>(() => Date.now());

  const mapRef = useRef<MapView | null>(null);
  const mapRegionRef = useRef<Region>(DEFAULT_REGION);
  const hasAutoCenteredRef = useRef(false);
  const lastSuccessfulEventsRef = useRef<Event[] | null>(null);

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

  const displayEvents = useMemo(
    () => applyClientSideFilters(events ?? [], appliedFilters),
    [events, appliedFilters]
  );

  const cardViewModels = useMemo<DiscoverCardViewModel[]>(() => {
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

  const discoverEvents = useMemo(
    () => cardViewModels.map((item) => item.event),
    [cardViewModels]
  );

  const venueFeatureOptions = useMemo(() => collectVenueFeatureOptions(events ?? []), [events]);

  const activeFilterCount = useMemo(() => getActiveFilterCount(appliedFilters), [appliedFilters]);

  const locationLabel = userLocation
    ? `${userLocation.latitude.toFixed(4)}, ${userLocation.longitude.toFixed(4)}`
    : "Pin not set";

  const getPreviewRegion = useCallback(() => {
    if (userLocation) {
      return {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };
    }

    const markerSource = discoverEvents.length > 0 ? discoverEvents : [];
    const firstWithCoords = markerSource.find((event) => event.latitude != null && event.longitude != null);
    if (firstWithCoords?.latitude != null && firstWithCoords.longitude != null) {
      const current = mapRegionRef.current ?? DEFAULT_REGION;
      return {
        latitude: firstWithCoords.latitude,
        longitude: firstWithCoords.longitude,
        latitudeDelta: current.latitudeDelta ?? 0.2,
        longitudeDelta: current.longitudeDelta ?? 0.2,
      };
    }

    return mapRegionRef.current ?? DEFAULT_REGION;
  }, [userLocation, discoverEvents]);

  const getTargetRegion = useCallback(() => {
    const current = mapRegionRef.current ?? DEFAULT_REGION;
    if (userLocation) {
      return {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: current.latitudeDelta ?? 0.2,
        longitudeDelta: current.longitudeDelta ?? 0.2,
      };
    }
    return current;
  }, [userLocation]);

  const handleDropPin = useCallback(
    (coordinate: { latitude: number; longitude: number }) => {
      const nextRegion = {
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        latitudeDelta: mapRegionRef.current?.latitudeDelta ?? DEFAULT_REGION.latitudeDelta,
        longitudeDelta: mapRegionRef.current?.longitudeDelta ?? DEFAULT_REGION.longitudeDelta,
      };

      setUserLocation(coordinate);
      setMapRegion(nextRegion);
      if (mapReady) {
        mapRef.current?.animateToRegion(nextRegion, 250);
      }
    },
    [mapReady]
  );

  const visibleEvents = useMemo(() => {
    if (!mapRegion) return discoverEvents;
    const { latitude, longitude, latitudeDelta, longitudeDelta } = mapRegion;
    const minLat = latitude - latitudeDelta / 2;
    const maxLat = latitude + latitudeDelta / 2;
    const minLng = longitude - longitudeDelta / 2;
    const maxLng = longitude + longitudeDelta / 2;

    return discoverEvents.filter(
      (event) =>
        event.latitude != null &&
        event.longitude != null &&
        event.latitude >= minLat &&
        event.latitude <= maxLat &&
        event.longitude >= minLng &&
        event.longitude <= maxLng
    );
  }, [mapRegion, discoverEvents]);

  const handleOpenEvent = useCallback((id: string) => {
    setSelectedEvent(null);
    setPendingNavId(id);
    setMapExpanded(false);
  }, []);

  const handleOpenFilters = useCallback(() => {
    setDraftFilters((_) => cloneFilters(appliedFilters));
    setShowDatePicker(false);
    setAdvancedExpanded(false);
    setFilterSheetVisible(true);
  }, [appliedFilters]);

  const handleCancelFilters = useCallback(() => {
    setDraftFilters((_) => cloneFilters(appliedFilters));
    setShowDatePicker(false);
    setFilterSheetVisible(false);
  }, [appliedFilters]);

  const handleResetDraftFilters = useCallback(() => {
    setDraftFilters(cloneFilters(DEFAULT_DISCOVER_FILTERS));
    setShowDatePicker(false);
  }, []);

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters((_) => cloneFilters(draftFilters));
    setShowDatePicker(false);
    setFilterSheetVisible(false);
  }, [draftFilters]);

  const handleOpenMapFromFilters = useCallback(() => {
    setFilterSheetVisible(false);
    setShowDatePicker(false);
    setMapExpanded(true);
  }, []);

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
    mapRegionRef.current = mapRegion;
  }, [mapRegion]);

  useEffect(() => {
    if (!mapExpanded) {
      return;
    }

    const target = getTargetRegion();
    setMapRegion(target);
    if (mapReady) {
      mapRef.current?.animateToRegion(target, 250);
    }
  }, [mapExpanded, getTargetRegion, mapReady]);

  useEffect(() => {
    if (!mapExpanded && pendingNavId) {
      const id = pendingNavId;
      setPendingNavId(null);
      router.push(`/event/${id}`);
    }
  }, [mapExpanded, pendingNavId, router]);

  useEffect(() => {
    if (!selectedEvent) return;
    if (!discoverEvents.some((event) => event.id === selectedEvent.id)) {
      setSelectedEvent(null);
    }
  }, [discoverEvents, selectedEvent]);

  useEffect(() => {
    if (hasAutoCenteredRef.current) return;
    if (userLocation) return;
    if (!discoverEvents.length) return;

    const firstWithCoords = discoverEvents.find((event) => event.latitude != null && event.longitude != null);
    if (firstWithCoords?.latitude == null || firstWithCoords.longitude == null) {
      return;
    }

    hasAutoCenteredRef.current = true;

    const current = mapRegionRef.current ?? DEFAULT_REGION;
    const nextRegion = {
      latitude: firstWithCoords.latitude,
      longitude: firstWithCoords.longitude,
      latitudeDelta: current.latitudeDelta ?? 0.2,
      longitudeDelta: current.longitudeDelta ?? 0.2,
    };

    setMapRegion(nextRegion);
  }, [discoverEvents, userLocation]);

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
    setLoading(true);

    try {
      const searchParams = new URLSearchParams();
      const trimmedSearch = debouncedQuery.trim();

      if (appliedTagSlug) searchParams.append("tag", appliedTagSlug);
      if (appliedCategorySlug) searchParams.append("category", appliedCategorySlug);
      if (appliedSubcategorySlug) searchParams.append("subcategory", appliedSubcategorySlug);
      if (appliedFilters.date) searchParams.append("date", appliedFilters.date.toISOString().split("T")[0]);
      if (appliedFilters.minRating != null) searchParams.append("min_rating", String(appliedFilters.minRating));
      if (trimmedSearch) searchParams.append("q", trimmedSearch);
      searchParams.append("sort", "soonest");

      if (userLocation) {
        searchParams.append("lat", String(userLocation.latitude));
        searchParams.append("lng", String(userLocation.longitude));
      }

      if (appliedFilters.radiusKm != null && userLocation) {
        searchParams.append("radius_km", String(appliedFilters.radiusKm));
      }

      const qs = searchParams.toString();
      const data = await request<{ events: Event[] }>(qs ? `/api/events?${qs}` : "/api/events", { timeoutMs: 20000 });
      const nextEvents = data.events ?? [];

      setEvents(nextEvents);
      if (nextEvents.length > 0) {
        lastSuccessfulEventsRef.current = nextEvents;
      }

      setError(null);
      setIsUsingCachedResults(false);
      setCachedIndicator(null);
    } catch (err) {
      const message = toDiscoverErrorMessage(err);
      const dbHealthy = await checkDbHealth();
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
      setLoading(false);
    }
  }, [
    debouncedQuery,
    appliedTagSlug,
    appliedCategorySlug,
    appliedSubcategorySlug,
    appliedFilters.date,
    appliedFilters.minRating,
    appliedFilters.radiusKm,
    userLocation,
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

        <View style={styles.embeddedMapContainer}>
          <MapView
            style={styles.embeddedMap}
            provider={PROVIDER_GOOGLE}
            pointerEvents="none"
            region={getPreviewRegion()}
          >
            {userLocation && <Marker coordinate={userLocation} title="Your location" pinColor={USER_PIN_COLOR} />}
            {discoverEvents.map((event) => {
              if (event.latitude == null || event.longitude == null) return null;
              return (
                <Marker
                  key={event.id}
                  coordinate={{ latitude: event.latitude, longitude: event.longitude }}
                  title={event.title}
                  description={event.location?.name ?? ""}
                />
              );
            })}
          </MapView>
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

          {events && cardViewModels.length === 0 && !loading && !error && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No events match the filters.</Text>
              <Text style={styles.emptySubtitle}>Try clearing filters or dropping a pin to widen the search.</Text>
              <View style={styles.emptyActions}>
                <Pressable
                  style={styles.emptyButton}
                  onPress={() => {
                    setAppliedFilters(cloneFilters(DEFAULT_DISCOVER_FILTERS));
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

          {cardViewModels.length > 0 && (
            <FlatList
              data={cardViewModels}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              renderItem={({ item }) => (
                <EventCard
                  model={item}
                  onPress={() => router.push(`/event/${item.id}`)}
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

                <Pressable style={styles.advancedToggle} onPress={() => setAdvancedExpanded((prev) => !prev)}>
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

        <Modal visible={mapExpanded} animationType="slide" onRequestClose={() => setMapExpanded(false)}>
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

            <MapView
              style={{ flex: 1 }}
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              initialRegion={getPreviewRegion()}
              onMapReady={() => {
                setMapReady(true);
                const target = getTargetRegion();
                setMapRegion(target);
                mapRef.current?.animateToRegion(target, 0);
              }}
              onRegionChangeComplete={(region) => {
                if (!mapReady) return;
                if (
                  !Number.isFinite(region.latitude) ||
                  !Number.isFinite(region.longitude) ||
                  !Number.isFinite(region.latitudeDelta) ||
                  !Number.isFinite(region.longitudeDelta)
                ) {
                  return;
                }
                setMapRegion(region);
              }}
              onLongPress={(event) => handleDropPin(event.nativeEvent.coordinate)}
            >
              {userLocation && (
                <Marker
                  coordinate={userLocation}
                  title="Your location"
                  pinColor={USER_PIN_COLOR}
                  draggable
                  onDragEnd={(event) => handleDropPin(event.nativeEvent.coordinate)}
                />
              )}
              {discoverEvents.map((event) => {
                if (event.latitude == null || event.longitude == null) return null;
                return (
                  <Marker
                    key={event.id}
                    coordinate={{ latitude: event.latitude, longitude: event.longitude }}
                    title={event.title}
                    description={event.location?.name ?? ""}
                  >
                    <Callout onPress={() => setSelectedEvent(event)}>
                      <View style={{ maxWidth: 200, padding: 4 }}>
                        <Text style={{ fontWeight: "700" }}>{event.title}</Text>
                        <Text>{event.location?.name ?? ""}</Text>
                        <Text style={{ color: PALETTE.accent, marginTop: 4 }}>Details</Text>
                      </View>
                    </Callout>
                  </Marker>
                );
              })}
            </MapView>

            {selectedEvent && (
              <View style={styles.sheet}>
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
                <Pressable style={styles.sheetButton} onPress={() => handleOpenEvent(selectedEvent.id)}>
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
                  ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                  renderItem={({ item }) => (
                    <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} onPress={() => handleOpenEvent(item.id)}>
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
              <View style={styles.listToggleContainer}>
                <Pressable style={styles.modalActionButton} onPress={() => setShowListOverlay(true)}>
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
  embeddedMapContainer: {
    height: 240,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  embeddedMap: {
    width: "100%",
    height: "100%",
  },
  expandMapCta: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(22,20,34,0.9)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  expandMapCtaText: {
    color: PALETTE.text,
    fontSize: 12,
    fontWeight: "600",
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
    bottom: 24,
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
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 8,
    minHeight: 200,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sheetEventTitle: {
    fontSize: 16,
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
    fontSize: 13,
    color: PALETTE.muted,
  },
  sheetButton: {
    marginTop: 8,
    backgroundColor: PALETTE.accent,
    paddingVertical: 10,
    borderRadius: 10,
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
