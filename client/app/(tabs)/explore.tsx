import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, FlatList, TextInput, Dimensions, Modal, Platform, RefreshControl } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region, Callout } from "react-native-maps";
import Slider from "@react-native-community/slider";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { request } from "@/lib/api";

type Event = {
  id: string;
  title: string;
  category: string | null;
  start_time: string;
  end_time: string;
  location?: { name?: string | null } | null;
  rating_avg?: number | null;
  tags?: string[];
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
};

type CityOption = { name: string; latitude: number; longitude: number };

const FALLBACK_TAG_OPTIONS = ["Rock", "Jazz", "Outdoor", "Dj", "Live", "Electronic"];
const FALLBACK_CATEGORY_OPTIONS = ["Music", "Party", "Art"];
const RATING_OPTIONS = [4.5, 4, 3];
const FALLBACK_CITIES: CityOption[] = [
  { name: "Vienna", latitude: 48.2082, longitude: 16.3738 },
  { name: "San Francisco", latitude: 37.7749, longitude: -122.4194 },
  { name: "New York", latitude: 40.7128, longitude: -74.006 },
];
const RADIUS_OPTIONS = [5, 10, 25, 50];
const DEFAULT_REGION: Region = { latitude: 48.2082, longitude: 16.3738, latitudeDelta: 0.2, longitudeDelta: 0.2 };
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

export default function DiscoverScreen() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [cityQuery, setCityQuery] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedQuery, setDebouncedQuery] = useState<string>("");
  const [minRating, setMinRating] = useState<number | null>(null);
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [sort, setSort] = useState<"date" | "toprated" | "price" | "distance">("date");
  const [error, setError] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const router = useRouter();
  const [mapExpanded, setMapExpanded] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [pendingNavId, setPendingNavId] = useState<string | null>(null);
  const [showListOverlay, setShowListOverlay] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region>(() => DEFAULT_REGION);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [availableTags, setAvailableTags] = useState<string[]>(FALLBACK_TAG_OPTIONS);
  const [availableCategories, setAvailableCategories] = useState<string[]>(FALLBACK_CATEGORY_OPTIONS);
  const [availableCities, setAvailableCities] = useState<CityOption[]>(FALLBACK_CITIES);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const mapRegionRef = useRef<Region>(DEFAULT_REGION);
  const [mapReady, setMapReady] = useState(false);
  const locationLabel = userLocation
    ? `${userLocation.latitude.toFixed(4)}, ${userLocation.longitude.toFixed(4)}`
    : "Not set";
  const getRegionForCity = useCallback(
    (city: string | null) => {
      const base = { latitudeDelta: 0.2, longitudeDelta: 0.2 };
      if (city) {
        const match = availableCities.find((item) => item.name.toLowerCase() === city.toLowerCase());
        if (match) {
          return { latitude: match.latitude, longitude: match.longitude, ...base };
        }
      }
      return { ...DEFAULT_REGION, ...base };
    },
    [availableCities]
  );
  const getPreviewRegion = useCallback(() => {
    if (userLocation) {
      return {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };
    }
    return getRegionForCity(selectedCity);
  }, [userLocation, selectedCity, getRegionForCity]);
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
    const cityRegion = getRegionForCity(selectedCity);
    return {
      ...cityRegion,
      latitudeDelta: current.latitudeDelta ?? cityRegion.latitudeDelta,
      longitudeDelta: current.longitudeDelta ?? cityRegion.longitudeDelta,
    };
  }, [userLocation, selectedCity, getRegionForCity]);

  const handleDropPin = useCallback((coordinate: { latitude: number; longitude: number }) => {
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
  }, [mapReady]);
  const visibleEvents = useMemo(() => {
    if (!mapRegion || !events) return events ?? [];
    const { latitude, longitude, latitudeDelta, longitudeDelta } = mapRegion;
    const minLat = latitude - latitudeDelta / 2;
    const maxLat = latitude + latitudeDelta / 2;
    const minLng = longitude - longitudeDelta / 2;
    const maxLng = longitude + longitudeDelta / 2;
    return (events ?? []).filter(
      (e) =>
        e.latitude != null &&
        e.longitude != null &&
        e.latitude >= minLat &&
        e.latitude <= maxLat &&
        e.longitude >= minLng &&
        e.longitude <= maxLng
    );
  }, [mapRegion, events]);
  const handleOpenEvent = (id: string) => {
    setSelectedEvent(null);
    setPendingNavId(id);
    setMapExpanded(false);
  };
  const handleClearFilters = useCallback(() => {
    setSelectedTag(null);
    setSelectedCategory(null);
    setSelectedCity(null);
    setCityQuery("");
    setSearchQuery("");
    setDebouncedQuery("");
    setSelectedDate(null);
    setSelectedTime(null);
    setMinRating(null);
    setRadiusKm(null);
    setSort("date");
  }, []);
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedTag) count += 1;
    if (selectedCategory) count += 1;
    if (selectedCity) count += 1;
    if (selectedDate) count += 1;
    if (selectedTime) count += 1;
    if (minRating != null) count += 1;
    if (radiusKm != null) count += 1;
    if (sort !== "date") count += 1;
    if (searchQuery.trim()) count += 1;
    return count;
  }, [
    selectedTag,
    selectedCategory,
    selectedCity,
    selectedDate,
    selectedTime,
    minRating,
    radiusKm,
    sort,
    searchQuery,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await request<{ tags: string[]; categories: string[]; cities: CityOption[] }>("/api/filters", {
          timeoutMs: 12000,
        });
        if (cancelled) return;
        setAvailableTags(data.tags?.length ? data.tags : FALLBACK_TAG_OPTIONS);
        setAvailableCategories(data.categories?.length ? data.categories : FALLBACK_CATEGORY_OPTIONS);
        setAvailableCities(data.cities?.length ? data.cities : FALLBACK_CITIES);
        setFiltersError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load filters";
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
    mapRegionRef.current = mapRegion;
  }, [mapRegion]);

  useEffect(() => {
    if (mapExpanded) {
      const target = getTargetRegion();
      setMapRegion(target);
      if (mapReady) {
        mapRef.current?.animateToRegion(target, 250);
      }
    }
  }, [mapExpanded, getTargetRegion, mapReady]);

  useEffect(() => {
    if (selectedCity && !userLocation) {
      setMapRegion(getRegionForCity(selectedCity));
    }
  }, [selectedCity, userLocation, getRegionForCity]);

  useEffect(() => {
    if (!mapExpanded && pendingNavId) {
      const id = pendingNavId;
      setPendingNavId(null);
      router.push(`/event/${id}`);
    }
  }, [mapExpanded, pendingNavId, router]);

  useEffect(() => {
    if (!userLocation) {
      if (sort === "distance") {
        setSort("date");
      }
      if (radiusKm != null) {
        setRadiusKm(null);
      }
    }
  }, [userLocation, sort, radiusKm]);

  const fetchEvents = useMemo(
    () => async () => {
      setLoading(true);
      try {
        const searchParams = new URLSearchParams();
        const trimmedSearch = debouncedQuery.trim();
        if (selectedTag) searchParams.append("tag", selectedTag.toLowerCase());
        if (selectedCategory) searchParams.append("category", selectedCategory);
        if (selectedCity) searchParams.append("city", selectedCity);
        if (sort) searchParams.append("sort", sort === "date" ? "soonest" : sort);
        if (selectedDate) searchParams.append("date", selectedDate.toISOString().split("T")[0]);
        if (selectedTime) searchParams.append("time", formatTime(selectedTime));
        if (minRating != null) searchParams.append("min_rating", String(minRating));
        if (trimmedSearch) searchParams.append("q", trimmedSearch);
        if (userLocation) {
          searchParams.append("lat", String(userLocation.latitude));
          searchParams.append("lng", String(userLocation.longitude));
        }
        if (radiusKm != null && userLocation && !mapExpanded) {
          searchParams.append("radius_km", String(radiusKm));
        }
        const qs = searchParams.toString();
        const data = await request<{ events: Event[] }>(qs ? `/api/events?${qs}` : "/api/events", { timeoutMs: 20000 });
        setEvents(data.events ?? []);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        console.error("Discover fetch error", message);
      } finally {
        setLoading(false);
      }
    },
    [selectedTag, selectedCategory, selectedCity, selectedDate, selectedTime, sort, minRating, debouncedQuery, radiusKm, userLocation, mapExpanded]
  );
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
      <Text style={styles.title}>Discover</Text>
      <Text style={styles.subtitle}>Filters → map preview → list. Expand map to browse pins.</Text>

      <View style={styles.filterCard}>
        <View style={{ gap: 6 }}>
          <Text style={styles.chipLabel}>Search</Text>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search events, venues, tags"
            placeholderTextColor={PALETTE.muted}
            style={styles.input}
          />
        </View>
        <View style={{ gap: 6 }}>
          <Text style={styles.chipLabel}>Your location pin</Text>
          <View style={styles.badgeRow}>
            <Text style={styles.pinText}>{locationLabel}</Text>
            <Pressable style={styles.badge} onPress={() => setMapExpanded(true)}>
              <Text style={styles.badgeText}>{userLocation ? "Move pin" : "Drop pin"}</Text>
            </Pressable>
            {userLocation && (
              <Pressable
                style={styles.badge}
                onPress={() => {
                  setUserLocation(null);
                  setRadiusKm(null);
                }}
              >
                <Text style={styles.badgeText}>Clear</Text>
              </Pressable>
            )}
          </View>
          {!userLocation && (
            <Text style={styles.subtitle}>Drop a pin on the map to enable distance filters.</Text>
          )}
        </View>
        <CityTypeahead
          query={cityQuery}
          selected={selectedCity}
          options={availableCities.map((city) => city.name)}
          onSelect={(val) => {
            setSelectedCity(val);
            setCityQuery(val ?? "");
          }}
          onChangeQuery={(val) => {
            setCityQuery(val);
            setSelectedCity(null);
          }}
        />
        <Pressable style={styles.expandButton} onPress={() => setFiltersExpanded((prev) => !prev)}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={styles.expandText}>{filtersExpanded ? "Hide filters" : "Filters"}</Text>
            {activeFilterCount > 0 && (
              <View style={styles.filterCountBadge}>
                <Text style={styles.filterCountText}>{activeFilterCount}</Text>
              </View>
            )}
          </View>
        </Pressable>
        {filtersExpanded && filtersError && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>Filters unavailable: {filtersError}</Text>
          </View>
        )}

        {filtersExpanded && (
          <View style={{ gap: 12 }}>
            <View style={styles.row}>
              <Pressable
                style={[styles.resetChip, activeFilterCount === 0 && styles.badgeDisabled]}
                onPress={handleClearFilters}
                disabled={activeFilterCount === 0}
              >
                <Text style={styles.resetChipText}>Reset filters</Text>
              </Pressable>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.chipLabel}>Date</Text>
              <View style={styles.row}>
                <Pressable style={styles.badge} onPress={() => setShowDatePicker((prev) => !prev)}>
                  <Text style={styles.badgeText}>{selectedDate ? selectedDate.toLocaleDateString() : "Pick date"}</Text>
                </Pressable>
                {selectedDate && (
                  <Pressable style={styles.badge} onPress={() => setSelectedDate(null)}>
                    <Text style={styles.badgeText}>Clear</Text>
                  </Pressable>
                )}
              </View>
              {showDatePicker && (
                <View style={styles.pickerWrap}>
                  <DateTimePicker
                    value={selectedDate ?? new Date()}
                    mode="date"
                    display={Platform.OS === "ios" ? "inline" : "calendar"}
                    themeVariant="dark"
                    textColor={PALETTE.text}
                    onChange={(_, date) => { setShowDatePicker(false); if (date) setSelectedDate(date); }}
                  />
                </View>
              )}
            </View>

            <View style={{ gap: 6 }}>
              <Text style={styles.chipLabel}>Time</Text>
              <View style={styles.row}>
                <Pressable style={styles.badge} onPress={() => setShowTimePicker((prev) => !prev)}>
                  <Text style={styles.badgeText}>{selectedTime ? formatTime(selectedTime) : "Pick time"}</Text>
                </Pressable>
                {selectedTime && (
                  <Pressable style={styles.badge} onPress={() => setSelectedTime(null)}>
                    <Text style={styles.badgeText}>Clear</Text>
                  </Pressable>
                )}
              </View>
              {showTimePicker && (
                <View style={styles.pickerWrap}>
                  <DateTimePicker
                    value={selectedTime ?? new Date()}
                    mode="time"
                    display="spinner"
                    themeVariant="dark"
                    textColor={PALETTE.text}
                    onChange={(_, date) => { setShowTimePicker(false); if (date) setSelectedTime(date); }}
                  />
                </View>
              )}
            </View>

            <FilterChips
              label="Tags"
              options={availableTags}
              selected={selectedTag}
              onSelect={(val) => setSelectedTag(val)}
            />
            <FilterChips
              label="Category"
              options={availableCategories}
              selected={selectedCategory}
              onSelect={(val) => setSelectedCategory(val)}
            />
            <View style={{ gap: 6 }}>
              <Text style={styles.chipLabel}>Min Rating: {minRating ? minRating.toFixed(1) : "Any"}</Text>
              <Slider
                value={minRating ?? 0}
                minimumValue={0}
                maximumValue={5}
                step={0.5}
                minimumTrackTintColor={PALETTE.accent}
                maximumTrackTintColor={PALETTE.line}
                thumbTintColor={PALETTE.accent}
                onValueChange={(val) => setMinRating(val === 0 ? null : val)}
              />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.chipLabel}>Near your pin</Text>
              <View style={styles.badgeRow}>
                <Pressable
                  onPress={() => setRadiusKm(null)}
                  style={[styles.badge, radiusKm == null && styles.badgeSelected]}
                >
                  <Text style={[styles.badgeText, radiusKm == null && styles.badgeSelectedText]}>Any</Text>
                </Pressable>
                {RADIUS_OPTIONS.map((radius) => {
                  const selected = radiusKm === radius;
                  const disabled = !userLocation;
                  return (
                    <Pressable
                      key={radius}
                      onPress={() => {
                        if (!userLocation) {
                          setMapExpanded(true);
                          return;
                        }
                        setRadiusKm(selected ? null : radius);
                      }}
                      style={[
                        styles.badge,
                        selected && styles.badgeSelected,
                        disabled && styles.badgeDisabled,
                      ]}
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
            </View>
            <FilterChips
              label="Sort"
              options={["Date", "Top rated", "Price", "Distance"]}
              selected={sortLabel(sort)}
              disabledOptions={!userLocation ? ["Distance"] : []}
              onSelect={(val) => {
                if (!val) {
                  setSort("date");
                  return;
                }
                if (val.toLowerCase() === "distance" && !userLocation) {
                  setMapExpanded(true);
                  return;
                }
                setSort(labelToSort(val));
              }}
            />
            {!userLocation && (
              <Text style={styles.helperText}>Drop a pin to enable Distance sorting.</Text>
            )}
            <Pressable style={styles.clearButton} onPress={handleClearFilters}>
              <Text style={styles.clearText}>Clear all</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Pressable style={styles.mapPreview} onPress={() => setMapExpanded(true)}>
        <View style={styles.mapHeader}>
          <Text style={styles.mapTitle}>Map Preview</Text>
          <View style={styles.mapCta}>
            <Text style={styles.mapCtaText}>Open map</Text>
          </View>
        </View>
        <Text style={styles.mapSubtitle}>Tap to open map. Long-press to drop your pin.</Text>
        <MapView
          style={styles.mapMini}
          provider={PROVIDER_GOOGLE}
          pointerEvents="none"
          region={getPreviewRegion()}
        >
          {userLocation && (
            <Marker coordinate={userLocation} title="Your location" pinColor={USER_PIN_COLOR} />
          )}
          {(events ?? []).map((evt) => {
            if (evt.latitude == null || evt.longitude == null) return null;
            return (
              <Marker
                key={evt.id}
                coordinate={{ latitude: evt.latitude, longitude: evt.longitude }}
                title={evt.title}
                description={evt.location?.name ?? ""}
              />
            );
          })}
        </MapView>
      </Pressable>

      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>Events</Text>
        {loading && <ActivityIndicator size="small" color={PALETTE.accent} />}
      </View>
      {error && <Text style={styles.error}>Error: {error}</Text>}
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
      {events && events.length === 0 && !loading && !error && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No events match the filters.</Text>
          <Text style={styles.emptySubtitle}>
            Try clearing filters or dropping a pin to widen the search.
          </Text>
          <View style={styles.emptyActions}>
            <Pressable style={styles.emptyButton} onPress={handleClearFilters}>
              <Text style={styles.emptyButtonText}>Clear filters</Text>
            </Pressable>
            <Pressable style={styles.emptyButton} onPress={() => setMapExpanded(true)}>
              <Text style={styles.emptyButtonText}>Drop a pin</Text>
            </Pressable>
          </View>
        </View>
      )}
      {events && events.length > 0 && (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/event/${item.id}`)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.cardTitle}>{item.title}</Text>
              {item.category && <Text style={styles.cardMeta}>{item.category}</Text>}
              <Text style={styles.cardMeta}>{item.location?.name ?? "Unknown location"}</Text>
              {item.distance_km != null && (
                <Text style={styles.cardMeta}>{item.distance_km.toFixed(1)} km away</Text>
              )}
              <View style={styles.badgeRow}>
                {item.tags?.slice(0, 3).map((tag) => (
                  <View key={tag} style={styles.badge}><Text style={styles.badgeText}>{tag}</Text></View>
                ))}
              </View>
              {item.rating_avg != null && (
                <Text style={styles.cardMeta}>⭐ {item.rating_avg.toFixed(1)}</Text>
              )}
            </Pressable>
          )}
        />
      )}

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
                  setRadiusKm(null);
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
            {(events ?? []).map((evt) => {
              if (evt.latitude == null || evt.longitude == null) return null;
              return (
                <Marker
                  key={evt.id}
                  coordinate={{ latitude: evt.latitude, longitude: evt.longitude }}
                  title={evt.title}
                  description={evt.location?.name ?? ""}
                >
                  <Callout onPress={() => setSelectedEvent(evt)}>
                    <View style={{ maxWidth: 200, padding: 4 }}>
                      <Text style={{ fontWeight: "700" }}>{evt.title}</Text>
                      <Text>{evt.location?.name ?? ""}</Text>
                      <Text style={{ color: PALETTE.accent, marginTop: 4 }}>Details</Text>
                    </View>
                  </Callout>
                </Marker>
              );
            })}
          </MapView>
          {selectedEvent && (
            <View style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{selectedEvent.title}</Text>
                <Pressable onPress={() => setSelectedEvent(null)} style={styles.sheetClose}>
                  <Text style={styles.sheetCloseText}>Close</Text>
                </Pressable>
              </View>
              {selectedEvent.location?.name && (
                <Text style={styles.sheetMeta}>{selectedEvent.location.name}</Text>
              )}
              {selectedEvent.category && (
                <Text style={styles.sheetMeta}>{selectedEvent.category}</Text>
              )}
              <Pressable style={styles.sheetButton} onPress={() => handleOpenEvent(selectedEvent.id)}>
                <Text style={styles.sheetButtonText}>Open event</Text>
              </Pressable>
            </View>
          )}
            {showListOverlay && (
              <View style={styles.overlayList}>
                <View style={styles.overlayHeader}>
                  <Text style={styles.overlayTitle}>Events in view</Text>
                  <Pressable onPress={() => setShowListOverlay(false)}><Text style={styles.overlayClose}>Close</Text></Pressable>
                </View>
                <FlatList
                  data={visibleEvents}
                keyExtractor={(item) => item.id}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                renderItem={({ item }) => (
                  <Pressable
                    style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
                    onPress={() => handleOpenEvent(item.id)}
                  >
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    {item.category && <Text style={styles.cardMeta}>{item.category}</Text>}
                    <Text style={styles.cardMeta}>{item.location?.name ?? "Unknown location"}</Text>
                    {item.distance_km != null && (
                      <Text style={styles.cardMeta}>{item.distance_km.toFixed(1)} km away</Text>
                    )}
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
  );
}

function sortLabel(sort: "date" | "toprated" | "price" | "distance") {
  if (sort === "toprated") return "Top rated";
  if (sort === "price") return "Price";
  if (sort === "distance") return "Distance";
  return "Date";
}

function labelToSort(label: string | null): "date" | "toprated" | "price" | "distance" {
  if (!label) return "date";
  const l = label.toLowerCase();
  if (l === "top rated") return "toprated";
  if (l === "price") return "price";
  if (l === "distance") return "distance";
  return "date";
}

function formatTime(d: Date) {
  try {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

type ChipsProps = {
  label: string;
  options: string[];
  selected: string | null;
  onSelect: (val: string | null) => void;
  disabledOptions?: string[];
};
function FilterChips({ label, options, selected, onSelect, disabledOptions }: ChipsProps) {
  const disabledSet = new Set((disabledOptions ?? []).map((opt) => opt.toLowerCase()));
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.badgeRow}>
        {options.map((opt) => {
          const isSelected = selected?.toLowerCase() === opt.toLowerCase();
          const isDisabled = disabledSet.has(opt.toLowerCase());
          return (
            <Pressable
              key={opt}
              onPress={() => onSelect(isSelected ? null : opt)}
              style={[
                styles.badge,
                isSelected && styles.badgeSelected,
                isDisabled && styles.badgeDisabled,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  isSelected && styles.badgeSelectedText,
                  isDisabled && styles.badgeDisabledText,
                ]}
              >
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type CityTypeaheadProps = {
  query: string;
  selected: string | null;
  options: string[];
  onSelect: (val: string | null) => void;
  onChangeQuery: (val: string) => void;
};

function CityTypeahead({ query, selected, options, onSelect, onChangeQuery }: CityTypeaheadProps) {
  const suggestions = options.filter((opt) => opt.toLowerCase().includes(query.toLowerCase()) || query === "");
  const showSuggestions = query.length > 0 && !selected;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.chipLabel}>City</Text>
      <TextInput
        value={query}
        onChangeText={onChangeQuery}
        placeholder="Type a city"
        placeholderTextColor={PALETTE.muted}
        style={styles.input}
      />
      {showSuggestions && (
        <View style={{ gap: 6 }}>
          {suggestions.map((opt) => {
            const isSelected = selected?.toLowerCase() === opt.toLowerCase();
            return (
              <Pressable
                key={opt}
                onPress={() => onSelect(opt)}
                style={[styles.badge, isSelected && styles.badgeSelected]}
              >
                <Text style={[styles.badgeText, isSelected && styles.badgeSelectedText]}>{opt}</Text>
              </Pressable>
            );
          })}
          {suggestions.length === 0 && <Text style={styles.subtitle}>No matches</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: PALETTE.background, flex: 1 },
  container: { padding: 16, gap: 12, paddingBottom: 24 },
  title: { fontSize: 22, fontWeight: "700", color: PALETTE.text },
  subtitle: { fontSize: 14, color: PALETTE.muted },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: PALETTE.text },
  filterCard: {
    backgroundColor: PALETTE.surface,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  chipLabel: { fontSize: 13, fontWeight: "600", color: PALETTE.muted },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: PALETTE.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  badgeText: { fontSize: 12, color: PALETTE.accent },
  badgeSelected: {
    backgroundColor: PALETTE.accent,
    borderColor: PALETTE.accent,
  },
  badgeSelectedText: { color: "#fff" },
  badgeDisabled: { opacity: 0.6 },
  badgeDisabledText: { color: PALETTE.muted },
  pinText: { fontSize: 12, color: PALETTE.text },
  helperText: { fontSize: 12, color: PALETTE.muted },
  resetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: PALETTE.accent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.accent,
  },
  resetChipText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
  expandButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: PALETTE.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  expandText: { fontSize: 13, color: PALETTE.accent, fontWeight: "600" },
  filterCountBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: PALETTE.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    alignItems: "center",
  },
  filterCountText: { color: PALETTE.accent, fontSize: 12, fontWeight: "700" },
  notice: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: PALETTE.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  noticeText: { fontSize: 12, color: PALETTE.muted },
  clearButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: PALETTE.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  clearText: { fontSize: 13, color: PALETTE.text },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: PALETTE.text,
    backgroundColor: PALETTE.surfaceAlt,
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
  skeletonRow: { flexDirection: "row", gap: 8 },
  skeletonPill: {
    height: 20,
    width: 54,
    borderRadius: 10,
    backgroundColor: PALETTE.surfaceAlt,
  },
  emptyState: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: PALETTE.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: PALETTE.text },
  emptySubtitle: { fontSize: 13, color: PALETTE.muted },
  emptyActions: { flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 4 },
  emptyButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: PALETTE.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  emptyButtonText: { color: PALETTE.accent, fontWeight: "600", fontSize: 13 },
  mapPreview: {
    marginTop: 4,
    backgroundColor: PALETTE.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  mapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mapTitle: { color: PALETTE.text, fontSize: 16, fontWeight: "700" },
  mapCta: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: PALETTE.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  mapCtaText: { color: PALETTE.accent, fontSize: 12, fontWeight: "600" },
  mapSubtitle: { color: PALETTE.muted, marginTop: 4 },
  mapMini: {
    marginTop: 10,
    width: "100%",
    height: 180,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  card: {
    backgroundColor: PALETTE.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    gap: 6,
  },
  cardTitle: { fontSize: 16, fontWeight: "600", color: PALETTE.text },
  cardMeta: { fontSize: 13, color: PALETTE.muted },
  error: { color: PALETTE.danger, fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: PALETTE.background },
  modalCloseText: { color: PALETTE.text, fontWeight: "600" },
  modalActions: {
    position: "absolute",
    top: 40,
    right: 12,
    zIndex: 10,
    flexDirection: "row",
    gap: 8,
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
  overlayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  overlayTitle: { fontSize: 16, fontWeight: "700", color: PALETTE.text },
  overlayClose: { color: PALETTE.accent, fontWeight: "600" },
  pickerWrap: {
    backgroundColor: PALETTE.surface,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
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
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: PALETTE.text, flex: 1, marginRight: 8 },
  sheetClose: { paddingHorizontal: 8, paddingVertical: 4 },
  sheetCloseText: { color: PALETTE.accent, fontWeight: "600" },
  sheetMeta: { fontSize: 13, color: PALETTE.muted },
  sheetButton: {
    marginTop: 8,
    backgroundColor: PALETTE.accent,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  sheetButtonText: { color: "#fff", fontWeight: "700" },
});
