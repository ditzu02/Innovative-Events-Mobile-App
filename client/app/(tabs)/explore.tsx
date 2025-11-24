import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, FlatList, TextInput, Dimensions, Modal } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region, Callout } from "react-native-maps";
import Slider from "@react-native-community/slider";
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
};

const TAG_OPTIONS = ["Rock", "Jazz", "Outdoor", "Dj", "Live", "Electronic"];
const CATEGORY_OPTIONS = ["Music", "Party", "Art"];
const RATING_OPTIONS = [4.5, 4, 3];
const CITY_OPTIONS = ["Vienna", "San Francisco", "New York"];

export default function DiscoverScreen() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [cityQuery, setCityQuery] = useState<string>("");
  const [minRating, setMinRating] = useState<number | null>(null);
  const [sort, setSort] = useState<"date" | "toprated" | "price">("date");
  const [error, setError] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const router = useRouter();
  const [mapExpanded, setMapExpanded] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [pendingNavId, setPendingNavId] = useState<string | null>(null);

  const handleOpenEvent = (id: string) => {
    setSelectedEvent(null);
    setPendingNavId(id);
    setMapExpanded(false);
  };

  useEffect(() => {
    if (!mapExpanded && pendingNavId) {
      const id = pendingNavId;
      setPendingNavId(null);
      router.push(`/event/${id}`);
    }
  }, [mapExpanded, pendingNavId, router]);

  const fetchEvents = useMemo(
    () => async () => {
      setLoading(true);
      try {
        const searchParams = new URLSearchParams();
        if (selectedTag) searchParams.append("tag", selectedTag.toLowerCase());
        if (selectedCategory) searchParams.append("category", selectedCategory);
        if (selectedCity) searchParams.append("city", selectedCity);
        if (sort) searchParams.append("sort", sort === "date" ? "soonest" : sort);
        if (minRating != null) searchParams.append("min_rating", String(minRating));
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
    [selectedTag, selectedCategory, selectedCity, sort, minRating]
  );

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Discover</Text>
      <Text style={styles.subtitle}>Filters → map preview → list. Expand map to browse pins.</Text>

      <View style={styles.filterCard}>
        <CityTypeahead
          query={cityQuery}
          selected={selectedCity}
          options={CITY_OPTIONS}
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
          <Text style={styles.expandText}>{filtersExpanded ? "Hide filters" : "More filters"}</Text>
        </Pressable>

        {filtersExpanded && (
          <View style={{ gap: 12 }}>
            <FilterChips
              label="Tags"
              options={TAG_OPTIONS}
              selected={selectedTag}
              onSelect={(val) => setSelectedTag(val)}
            />
            <FilterChips
              label="Category"
              options={CATEGORY_OPTIONS}
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
                minimumTrackTintColor="#3949ab"
                maximumTrackTintColor="#ccc"
                thumbTintColor="#3949ab"
                onValueChange={(val) => setMinRating(val === 0 ? null : val)}
              />
            </View>
            <FilterChips
              label="Sort"
              options={["Date", "Top rated", "Price"]}
              selected={sortLabel(sort)}
              onSelect={(val) => setSort(labelToSort(val))}
            />
            <Pressable style={styles.clearButton} onPress={() => {
              setSelectedTag(null);
              setSelectedCategory(null);
              setSelectedCity(null);
              setCityQuery("");
              setMinRating(null);
              setSort("date");
            }}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Pressable style={styles.mapPreview} onPress={() => setMapExpanded(true)}>
        <Text style={styles.mapTitle}>Map Preview</Text>
        <Text style={styles.mapSubtitle}>Tap to open map</Text>
        <MapView
          style={styles.mapMini}
          provider={PROVIDER_GOOGLE}
          pointerEvents="none"
          region={initialRegion(selectedCity)}
        >
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
        {loading && <ActivityIndicator size="small" />}
      </View>
      {error && <Text style={styles.error}>Error: {error}</Text>}
      {events && events.length === 0 && !loading && !error && (
        <Text style={styles.subtitle}>No events match the filters.</Text>
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
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <Pressable style={styles.modalClose} onPress={() => setMapExpanded(false)}>
            <Text style={styles.modalCloseText}>Close Map</Text>
          </Pressable>
          <MapView
            style={{ flex: 1 }}
            provider={PROVIDER_GOOGLE}
            initialRegion={initialRegion(selectedCity)}
          >
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
                      <Text style={{ color: "#3949ab", marginTop: 4 }}>Details</Text>
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
        </View>
      </Modal>
    </ScrollView>
  );
}

function sortLabel(sort: "date" | "toprated" | "price") {
  if (sort === "toprated") return "Top rated";
  if (sort === "price") return "Price";
  return "Date";
}

function labelToSort(label: string | null): "date" | "toprated" | "price" {
  if (!label) return "date";
  const l = label.toLowerCase();
  if (l === "top rated") return "toprated";
  if (l === "price") return "price";
  return "date";
}

function initialRegion(city: string | null): Region {
  const base = {
    latitudeDelta: 0.2,
    longitudeDelta: 0.2,
  };
  switch ((city ?? "").toLowerCase()) {
    case "vienna":
      return { latitude: 48.2082, longitude: 16.3738, ...base };
    case "san francisco":
      return { latitude: 37.7749, longitude: -122.4194, ...base };
    case "new york":
      return { latitude: 40.7128, longitude: -74.006, ...base };
    default:
      return { latitude: 48.2082, longitude: 16.3738, ...base };
  }
}

type ChipsProps = { label: string; options: string[]; selected: string | null; onSelect: (val: string | null) => void };
function FilterChips({ label, options, selected, onSelect }: ChipsProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.badgeRow}>
        {options.map((opt) => {
          const isSelected = selected?.toLowerCase() === opt.toLowerCase();
          return (
            <Pressable
              key={opt}
              onPress={() => onSelect(isSelected ? null : opt)}
              style={[styles.badge, isSelected && { backgroundColor: "#3949ab" }]}
            >
              <Text style={[styles.badgeText, isSelected && { color: "#fff" }]}>{opt}</Text>
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
                style={[styles.badge, isSelected && { backgroundColor: "#3949ab" }]}
              >
                <Text style={[styles.badgeText, isSelected && { color: "#fff" }]}>{opt}</Text>
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
  container: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555" },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  filterCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e1e1e1",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  chipLabel: { fontSize: 13, fontWeight: "600" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#eef2ff",
  },
  badgeText: { fontSize: 12, color: "#3949ab" },
  expandButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
  },
  expandText: { fontSize: 13, color: "#3949ab", fontWeight: "600" },
  clearButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "#f0f0f0",
  },
  clearText: { fontSize: 13, color: "#333" },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  expandButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
  },
  expandText: { fontSize: 13, color: "#3949ab", fontWeight: "600" },
  mapPlaceholder: {
    marginTop: 8,
    borderRadius: 12,
    padding: 16,
    backgroundColor: "#0f172a",
  },
  mapTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  mapSubtitle: { color: "#dfe3f0", marginTop: 4 },
  mapMini: {
    marginTop: 10,
    width: "100%",
    height: 180,
    borderRadius: 12,
    overflow: "hidden",
  },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e1e1e1",
    gap: 6,
  },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  cardMeta: { fontSize: 13, color: "#555" },
  modalClose: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 10,
  },
  modalCloseText: { color: "#fff", fontWeight: "600" },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 8,
    minHeight: 200,
  },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetTitle: { fontSize: 16, fontWeight: "700", flex: 1, marginRight: 8 },
  sheetClose: { paddingHorizontal: 8, paddingVertical: 4 },
  sheetCloseText: { color: "#3949ab", fontWeight: "600" },
  sheetMeta: { fontSize: 13, color: "#555" },
  sheetButton: {
    marginTop: 8,
    backgroundColor: "#3949ab",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  sheetButtonText: { color: "#fff", fontWeight: "700" },
});
