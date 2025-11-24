import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { request } from "@/lib/api";

type EventDetail = {
  id: string;
  title: string;
  category: string | null;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  cover_image_url?: string | null;
  price?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  tags?: string[];
  location?: {
    name?: string | null;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    features?: any;
  } | null;
  artists?: Array<{
    id: string;
    name: string;
    bio: string | null;
    image_url: string | null;
    social_links: Record<string, string> | null;
  }>;
  photos?: string[];
  reviews?: {
    summary: { count: number; rating_avg: number };
    latest: Array<{ rating: number; comment: string | null; photos: string[] | null; created_at: string | null }>;
  };
};

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const data = await request<{ event: EventDetail }>(`/api/events/${id}`, { timeoutMs: 12000 });
        setEvent(data.event);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  return (
    <>
      <Stack.Screen
        options={{
          title: event?.title ?? "Event",
          headerBackTitle: "Back",
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 8 }}>
              <Text style={{ color: "#3949ab", fontWeight: "600" }}>Back</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.container}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.message}>Loading event...</Text>
          </View>
        )}

        {!loading && error && <Text style={styles.error}>Error: {error}</Text>}

        {!loading && !error && event && (
          <View style={styles.content}>
            {event.cover_image_url ? (
              <View style={styles.heroWrap}>
                <Image source={{ uri: event.cover_image_url }} style={styles.hero} resizeMode="cover" />
                <View style={styles.heroOverlay} />
                <View style={styles.heroText}>
                  <Text style={styles.heroTitle}>{event.title}</Text>
                  <Text style={styles.heroMeta}>
                    {event.category ?? "Uncategorized"} · {formatTimeRange(event.start_time, event.end_time)}
                  </Text>
                  {event.location?.name ? <Text style={styles.heroMeta}>{event.location.name}</Text> : null}
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.title}>{event.title}</Text>
                <Text style={styles.subtitle}>
                  {event.category ?? "Uncategorized"} · {formatTimeRange(event.start_time, event.end_time)}
                </Text>
              </>
            )}

            {event.tags && event.tags.length > 0 && (
              <View style={styles.row}>
                {event.tags.map((tag) => (
                  <View key={tag} style={styles.badge}>
                    <Text style={styles.badgeText}>{formatTag(tag)}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.actionRow}>
              <Pressable style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Buy Tickets</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Save</Text>
              </Pressable>
            </View>

            {(event.location || event.price != null || event.rating_avg != null) && (
              <View style={styles.infoCard}>
                {event.location && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Location</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.infoValue}>{event.location.name ?? "Unknown location"}</Text>
                      {event.location.address ? <Text style={styles.muted}>{event.location.address}</Text> : null}
                    </View>
                  </View>
                )}
                {event.price != null && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Price</Text>
                    <Text style={styles.infoValue}>€{event.price.toFixed(2)}</Text>
                  </View>
                )}
                {event.rating_avg != null && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Rating</Text>
                    <Text style={styles.infoValue}>
                      {event.rating_avg.toFixed(1)} ({event.rating_count ?? 0})
                    </Text>
                  </View>
                )}
              </View>
            )}

            {event.description && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>About</Text>
                <Text style={styles.body}>{event.description}</Text>
              </View>
            )}

            {event.artists && event.artists.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Artists</Text>
                {event.artists.map((artist) => (
                  <View key={artist.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{artist.name}</Text>
                    {artist.bio ? <Text style={styles.cardBody}>{artist.bio}</Text> : null}
                  </View>
                ))}
              </View>
            )}

            {event.photos && event.photos.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Photos</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 12 }}>
                  {event.photos.map((url) => (
                    <Image key={url} source={{ uri: url }} style={styles.photo} />
                  ))}
                </ScrollView>
              </View>
            )}

            {event.reviews && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Reviews</Text>
                <Text style={styles.body}>
                  {event.reviews.summary.rating_avg.toFixed(1)} avg · {event.reviews.summary.count} ratings
                </Text>
                {event.reviews.latest?.map((rev, idx) => (
                  <View key={idx} style={styles.reviewCard}>
                    <Text style={styles.cardTitle}>⭐ {rev.rating}</Text>
                    {rev.comment ? <Text style={styles.cardBody}>{rev.comment}</Text> : null}
                    {rev.created_at ? <Text style={styles.muted}>{rev.created_at}</Text> : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </>
  );
}

function formatTag(tag: string) {
  if (!tag) return "";
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

function formatTimeRange(start: string | null, end: string | null) {
  if (!start || !end) return "Time TBA";
  try {
    const s = new Date(start);
    const e = new Date(end);
    const dateFmt: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
    const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
    return `${s.toLocaleDateString(undefined, dateFmt)} · ${s.toLocaleTimeString(undefined, timeFmt)} - ${e.toLocaleTimeString(undefined, timeFmt)}`;
  } catch {
    return `${start} - ${end}`;
  }
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: "#f7f8fb" },
  center: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 40 },
  content: { gap: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555" },
  message: { fontSize: 14 },
  error: { color: "red", fontSize: 14 },
  heroWrap: { borderRadius: 16, overflow: "hidden", position: "relative" },
  hero: { width: "100%", height: 260 },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.25)" },
  heroText: { position: "absolute", left: 16, bottom: 16, right: 16, gap: 4 },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#fff" },
  heroMeta: { color: "#f0f0f0" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: "#eef2ff" },
  badgeText: { fontSize: 12, color: "#3949ab" },
  actionRow: { flexDirection: "row", gap: 10 },
  primaryButton: {
    flex: 1,
    backgroundColor: "#3949ab",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  secondaryButton: {
    width: 90,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#3949ab",
    backgroundColor: "#eef2ff",
  },
  secondaryButtonText: { color: "#3949ab", fontWeight: "700", fontSize: 14 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  body: { fontSize: 14, color: "#222" },
  muted: { fontSize: 12, color: "#666" },
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  infoLabel: { fontSize: 13, color: "#666", width: 90 },
  infoValue: { fontSize: 14, color: "#222", flex: 1, textAlign: "right" },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff",
    gap: 4,
  },
  cardTitle: { fontSize: 14, fontWeight: "600" },
  cardBody: { fontSize: 13, color: "#333" },
  photo: { width: 180, height: 120, borderRadius: 10 },
  reviewCard: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 10,
    gap: 4,
    backgroundColor: "#fafafa",
  },
});
