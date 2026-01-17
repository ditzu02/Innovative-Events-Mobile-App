import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { request } from "@/lib/api";
import { USER_ID } from "@/constants/config";

type Event = {
  id: string;
  title: string;
  category: string | null;
  location?: {
    name?: string | null;
    address?: string | null;
  } | null;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  cover_image_url?: string | null;
  price?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  tags?: string[];
};

export default function SavedScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Record<string, boolean>>({});

  const fetchSaved = useCallback(async () => {
    if (!USER_ID) {
      setError("Set EXPO_PUBLIC_USER_ID to enable saved events.");
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await request<{ events: Event[] }>("/api/saved", { timeoutMs: 12000 });
      setEvents(data.events ?? []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [USER_ID, request]);

  useFocusEffect(
    useCallback(() => {
      fetchSaved();
    }, [fetchSaved])
  );

  const handleRemove = useCallback(async (eventId: string) => {
    setRemoving((prev) => ({ ...prev, [eventId]: true }));
    try {
      await request(`/api/saved/${eventId}`, { method: "DELETE", timeoutMs: 12000 });
      setEvents((prev) => (prev ? prev.filter((evt) => evt.id !== eventId) : prev));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error occurred";
      setError(message);
    } finally {
      setRemoving((prev) => {
        const next = { ...prev };
        delete next[eventId];
        return next;
      });
    }
  }, [request]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Saved Events</Text>

      {loading && (
        <View style={styles.row}>
          <ActivityIndicator size="small" />
          <Text style={styles.message}>Loading saved events...</Text>
        </View>
      )}

      {!loading && error && <Text style={styles.error}>Error: {error}</Text>}

      {!loading && !error && events && events.length === 0 && (
        <Text style={styles.message}>No saved events yet.</Text>
      )}

      {events && events.length > 0 && (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSubtitle}>
                {item.location?.name ?? "Unknown location"}
              </Text>
              <Text style={styles.cardSubtitle}>
                {formatTimeRange(item.start_time, item.end_time)}
              </Text>
              <View style={styles.rowWrap}>
                {item.tags?.slice(0, 3).map((tag) => (
                  <View key={tag} style={styles.badge}>
                    <Text style={styles.badgeText}>{formatTag(tag)}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.metaRow}>
                {item.price != null && (
                  <Text style={styles.metaText}>€{item.price.toFixed(2)}</Text>
                )}
                {item.rating_avg != null && (
                  <Text style={styles.metaText}>
                    {item.rating_avg.toFixed(1)} ({item.rating_count ?? 0})
                  </Text>
                )}
              </View>
              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => router.push(`/event/${item.id}`)}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Open</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleRemove(item.id)}
                  disabled={!!removing[item.id]}
                  style={({ pressed }) => [
                    styles.removeButton,
                    (pressed || removing[item.id]) && { opacity: 0.7 },
                  ]}
                >
                  <Text style={styles.removeButtonText}>
                    {removing[item.id] ? "Removing..." : "Remove"}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

function formatTimeRange(start: string | null, end: string | null) {
  if (!start || !end) return "Time TBA";
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const opts: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    };
    return `${startDate.toLocaleString(undefined, opts)} -> ${endDate.toLocaleString(undefined, {
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
  title: { fontSize: 20, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  message: { fontSize: 14, color: "#555" },
  error: { color: "red", fontSize: 14 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
    gap: 6,
  },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  cardSubtitle: { fontSize: 13, color: "#555" },
  separator: { height: 10 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
  },
  badgeText: { fontSize: 12, color: "#3949ab" },
  metaRow: { flexDirection: "row", gap: 12, alignItems: "center", marginTop: 4 },
  metaText: { fontSize: 13, color: "#222" },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  secondaryButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#3949ab",
    backgroundColor: "#eef2ff",
  },
  secondaryButtonText: { color: "#3949ab", fontWeight: "700" },
  removeButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d32f2f",
    backgroundColor: "#ffebee",
  },
  removeButtonText: { color: "#d32f2f", fontWeight: "700" },
});
