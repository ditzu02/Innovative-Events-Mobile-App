import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { request } from "@/lib/api";

type Event = {
  id: string;
  title: string;
  category: string | null;
  location?: {
    name?: string | null;
    address?: string | null;
  } | null;
  start_time: string;
  end_time: string;
  description: string | null;
  cover_image_url?: string | null;
  price?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  tags?: string[];
};

export default function Home() {
  const [dbResponse, setDbResponse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[] | null>(null);
  const router = useRouter();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<"date" | "toprated" | "price">("date");
  const [minRating, setMinRating] = useState<number | null>(null);

  useEffect(() => {
    async function testBackend() {
      try {
        const data = await request("/api/test-db");
        setDbResponse(data);
        setError(null);
        console.log("Backend response:", data);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
        setError(message);
        console.error("Fetch error:", message);
      } finally {
        setLoading(false);
      }
    }
    
    testBackend();
  }, []);

  const fetchEvents = useMemo(
    () => async () => {
      try {
        const searchParams = new URLSearchParams();
        if (selectedTag) searchParams.append("tag", selectedTag);
        if (selectedCategory) searchParams.append("category", selectedCategory);
        if (sort) searchParams.append("sort", sort === "date" ? "soonest" : sort);
        if (minRating != null) searchParams.append("min_rating", String(minRating));
        const qs = searchParams.toString();

        const data = await request<{ events: Event[] }>(
          qs ? `/api/events?${qs}` : "/api/events",
          { timeoutMs: 12000 }
        );
        setEvents(data.events ?? []);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
        console.error("Events fetch error:", message);
      }
    },
    [selectedTag, selectedCategory, sort, minRating]
  );

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Backend Test</Text>

      {loading && (
        <View style={styles.row}>
          <ActivityIndicator size="small" />
          <Text style={styles.message}>Contacting server...</Text>
        </View>
      )}

      {!loading && error && <Text style={styles.error}>Error: {error}</Text>}

      {!loading && !error && dbResponse && (
        <Text style={styles.response}>
          {JSON.stringify(dbResponse, null, 2)}
        </Text>
      )}

      <Text style={styles.title}>Upcoming Events</Text>
      <Filters
        selectedTag={selectedTag}
        onSelectTag={setSelectedTag}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        sort={sort}
        onSelectSort={setSort}
        minRating={minRating}
        onSelectMinRating={setMinRating}
        onClear={() => {
          setSelectedTag(null);
          setSelectedCategory(null);
          setSort("date");
          setMinRating(null);
        }}
      />
      {!events && <Text style={styles.message}>Loading events...</Text>}
      {events && events.length === 0 && (
        <Text style={styles.message}>No events available.</Text>
      )}
      {events && events.length > 0 && (
        <FlatList
          data={events}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/event/${item.id}`)}
              style={({ pressed }) => [
                styles.card,
                pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
              ]}
            >
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSubtitle}>
                {item.location?.name ?? "Unknown location"}
              </Text>
              {item.category && (
                <Text style={styles.cardSubtitle}>
                  Category: {item.category}
                </Text>
              )}
              <Text style={styles.cardSubtitle}>
                {formatTimeRange(item.start_time, item.end_time)}
              </Text>
              <View style={styles.row}>
                {item.tags?.slice(0, 3).map((tag) => (
                  <View key={tag} style={styles.badge}>
                    <Text style={styles.badgeText}>{formatTag(tag)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.cardBody}>
                {item.description ?? "No description provided."}
              </Text>
              <View style={styles.metaRow}>
                {item.price != null && (
                  <Text style={styles.metaText}>€{item.price.toFixed(2)}</Text>
                )}
                {item.rating_avg != null && (
                  <Text style={styles.metaText}>
                    ⭐ {item.rating_avg.toFixed(1)} ({item.rating_count ?? 0})
                  </Text>
                )}
              </View>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

type FiltersProps = {
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  selectedCategory: string | null;
  onSelectCategory: (cat: string | null) => void;
  sort: "date" | "toprated" | "price";
  onSelectSort: (sort: "date" | "toprated" | "price") => void;
  minRating: number | null;
  onSelectMinRating: (rating: number | null) => void;
  onClear: () => void;
};

const TAG_OPTIONS = ["Rock", "Jazz", "Outdoor", "Dj", "Live", "Electronic"];
const CATEGORY_OPTIONS = ["Music", "Party", "Art"];
const RATING_OPTIONS = [4.5, 4, 3];

function Filters({
  selectedTag,
  onSelectTag,
  selectedCategory,
  onSelectCategory,
  sort,
  onSelectSort,
  minRating,
  onSelectMinRating,
  onClear,
}: FiltersProps) {
  return (
    <View style={styles.filterContainer}>
      <Text style={styles.filterLabel}>Tags</Text>
      <View style={styles.rowWrap}>
        {TAG_OPTIONS.map((tag) => (
          <TagChip
            key={tag}
            label={tag}
            selected={selectedTag === tag.toLowerCase()}
            onPress={() => onSelectTag(selectedTag === tag.toLowerCase() ? null : tag.toLowerCase())}
          />
        ))}
      </View>

      <Text style={styles.filterLabel}>Category</Text>
      <View style={styles.rowWrap}>
        {CATEGORY_OPTIONS.map((cat) => (
          <Pressable
            key={cat}
            onPress={() => onSelectCategory(selectedCategory === cat ? null : cat)}
            style={[
              styles.badge,
              selectedCategory === cat && { backgroundColor: "#3949ab" },
            ]}
          >
            <Text style={[styles.badgeText, selectedCategory === cat && { color: "#fff" }]}>
              {cat}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.filterLabel}>Sort</Text>
      <View style={styles.rowWrap}>
        {(["date", "toprated", "price"] as const).map((s) => (
          <Pressable
            key={s}
            onPress={() => onSelectSort(s)}
            style={[styles.badge, sort === s && { backgroundColor: "#3949ab" }]}
          >
            <Text style={[styles.badgeText, sort === s && { color: "#fff" }]}>
              {s === "date" ? "Date" : s === "toprated" ? "Top rated" : "Price"}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.filterLabel}>Min Rating</Text>
      <View style={styles.rowWrap}>
        {RATING_OPTIONS.map((r) => (
          <Pressable
            key={r}
            onPress={() => onSelectMinRating(minRating === r ? null : r)}
            style={[styles.badge, minRating === r && { backgroundColor: "#3949ab" }]}
          >
            <Text style={[styles.badgeText, minRating === r && { color: "#fff" }]}>
              {r}+
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={[styles.badge, { alignSelf: "flex-start" }]} onPress={onClear}>
        <Text style={styles.badgeText}>Clear</Text>
      </Pressable>
    </View>
  );
}

type TagChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

function TagChip({ label, selected, onPress }: TagChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.badge, selected && { backgroundColor: "#3949ab" }]}
    >
      <Text style={[styles.badgeText, selected && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

function formatTimeRange(start: string, end: string) {
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const opts: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    };
    return `${startDate.toLocaleString(undefined, opts)} \u2192 ${endDate.toLocaleString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  } catch {
    return `${start} - ${end}`;
  }
}

function formatTag(tag: string) {
  if (!tag) return "";
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: "bold" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  message: { fontSize: 14 },
  error: { color: "red", fontSize: 14 },
  response: { fontFamily: "monospace", fontSize: 13 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#fff",
  },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  cardSubtitle: { fontSize: 13, color: "#555" },
  cardBody: { marginTop: 4, fontSize: 13, color: "#333" },
  separator: { height: 8 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
  },
  badgeText: { fontSize: 12, color: "#3949ab" },
  metaRow: { flexDirection: "row", gap: 12, marginTop: 6, alignItems: "center" },
  metaText: { fontSize: 13, color: "#222" },
  filterContainer: {
    paddingVertical: 6,
    gap: 8,
  },
  filterLabel: { fontSize: 13, fontWeight: "600" },
  rowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
