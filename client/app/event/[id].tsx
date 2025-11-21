import { useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
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
      <Stack.Screen options={{ title: event?.title ?? "Event" }} />
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
              <Image source={{ uri: event.cover_image_url }} style={styles.hero} resizeMode="cover" />
            ) : null}

            <Text style={styles.title}>{event.title}</Text>
            <Text style={styles.subtitle}>
              {event.category ?? "Uncategorized"} · {event.start_time} - {event.end_time}
            </Text>

            {event.tags && event.tags.length > 0 && (
              <View style={styles.row}>
                {event.tags.map((tag) => (
                  <View key={tag} style={styles.badge}>
                    <Text style={styles.badgeText}>{formatTag(tag)}</Text>
                  </View>
                ))}
              </View>
            )}

            {event.location && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Location</Text>
                <Text style={styles.body}>{event.location.name ?? "Unknown location"}</Text>
                <Text style={styles.muted}>{event.location.address}</Text>
              </View>
            )}

            {event.price != null || event.rating_avg != null ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Highlights</Text>
                {event.price != null && <Text style={styles.body}>Price: €{event.price.toFixed(2)}</Text>}
                {event.rating_avg != null && (
                  <Text style={styles.body}>
                    Rating: {event.rating_avg.toFixed(1)} ({event.rating_count ?? 0})
                  </Text>
                )}
              </View>
            ) : null}

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

const styles = StyleSheet.create({
  container: { padding: 16 },
  center: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 40 },
  content: { gap: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555" },
  message: { fontSize: 14 },
  error: { color: "red", fontSize: 14 },
  hero: { width: "100%", height: 220, borderRadius: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: "#eef2ff" },
  badgeText: { fontSize: 12, color: "#3949ab" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  body: { fontSize: 14, color: "#222" },
  muted: { fontSize: 12, color: "#666" },
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
