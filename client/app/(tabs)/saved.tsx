import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { request } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { SafeAreaView } from "react-native-safe-area-context";

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

export default function SavedScreen() {
  const router = useRouter();
  const { isAuthed, authLoading } = useAuth();
  const [events, setEvents] = useState<Event[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Record<string, boolean>>({});
  const savedTitle = events && isAuthed ? `Saved Events (${events.length})` : "Saved Events";

  const fetchSaved = useCallback(async () => {
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
  }, [request]);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchSaved();
    } finally {
      setRefreshing(false);
    }
  }, [fetchSaved]);

  useFocusEffect(
    useCallback(() => {
      if (authLoading) {
        return;
      }
      if (isAuthed) {
        fetchSaved();
      } else {
        setLoading(false);
        setEvents([]);
        setError(null);
      }
    }, [fetchSaved, isAuthed, authLoading])
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
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Text style={styles.title}>{savedTitle}</Text>

      {!authLoading && !isAuthed && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Sign in to see saved events.</Text>
          <Text style={styles.emptySubtitle}>
            Create an account to save events and keep them here.
          </Text>
          <Pressable style={styles.emptyButton} onPress={() => router.push("/account")}>
            <Text style={styles.emptyButtonText}>Go to Account</Text>
          </Pressable>
        </View>
      )}

      {isAuthed && loading && events === null && (
        <View style={styles.skeletonList}>
          {[0, 1, 2].map((item) => (
            <View key={item} style={styles.skeletonCard}>
              <View style={[styles.skeletonLine, styles.skeletonLineWide]} />
              <View style={styles.skeletonLine} />
              <View style={styles.skeletonRow}>
                <View style={styles.skeletonPill} />
                <View style={styles.skeletonPill} />
                <View style={styles.skeletonPill} />
              </View>
              <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
            </View>
          ))}
        </View>
      )}

      {!loading && isAuthed && error && <Text style={styles.error}>Error: {error}</Text>}

      {!loading && isAuthed && !error && events && events.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No saved events yet.</Text>
          <Text style={styles.emptySubtitle}>
            Explore events and tap Save to keep them here.
          </Text>
          <Pressable style={styles.emptyButton} onPress={() => router.push("/explore")}>
            <Text style={styles.emptyButtonText}>Browse events</Text>
          </Pressable>
        </View>
      )}

      {isAuthed && events && events.length > 0 && (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={PALETTE.accent}
              colors={[PALETTE.accent]}
            />
          )}
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
                  <Text style={styles.secondaryButtonText}>Open event</Text>
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
    </SafeAreaView>
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
  container: { padding: 20, gap: 12, flex: 1, backgroundColor: PALETTE.background },
  title: { fontSize: 20, fontWeight: "700", color: PALETTE.text },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  error: { color: PALETTE.danger, fontSize: 14 },
  skeletonList: { gap: 12 },
  skeletonCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    borderRadius: 12,
    padding: 12,
    backgroundColor: PALETTE.surface,
    gap: 10,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 6,
    backgroundColor: PALETTE.surfaceAlt,
  },
  skeletonLineWide: { width: "70%" },
  skeletonLineShort: { width: "45%" },
  skeletonRow: { flexDirection: "row", gap: 8 },
  skeletonPill: {
    height: 20,
    width: 54,
    borderRadius: 10,
    backgroundColor: PALETTE.surfaceAlt,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    borderRadius: 12,
    padding: 12,
    backgroundColor: PALETTE.surface,
    gap: 6,
  },
  cardTitle: { fontSize: 16, fontWeight: "600", color: PALETTE.text },
  cardSubtitle: { fontSize: 13, color: PALETTE.muted },
  separator: { height: 10 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: PALETTE.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  badgeText: { fontSize: 12, color: PALETTE.accent },
  metaRow: { flexDirection: "row", gap: 12, alignItems: "center", marginTop: 4 },
  metaText: { fontSize: 13, color: PALETTE.text },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  secondaryButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: PALETTE.accent,
  },
  secondaryButtonText: { color: "#fff", fontWeight: "700" },
  removeButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.danger,
    backgroundColor: "rgba(255,107,107,0.15)",
  },
  removeButtonText: { color: PALETTE.danger, fontWeight: "700" },
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
  emptyButton: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: PALETTE.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  emptyButtonText: { color: PALETTE.accent, fontWeight: "600" },
});
