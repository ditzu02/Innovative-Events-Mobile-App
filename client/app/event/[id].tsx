import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { request } from "@/lib/api";
import { USER_ID } from "@/constants/config";

type EventDetail = {
  id: string;
  title: string;
  category: string | null;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  cover_image_url?: string | null;
  ticket_url?: string | null;
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
  const headerHeight = useHeaderHeight();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canSave = Boolean(USER_ID);
  const canReview = Boolean(USER_ID);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState<number | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewPhotos, setReviewPhotos] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
  const [pendingReviewScroll, setPendingReviewScroll] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const reviewSectionY = useRef<number | null>(null);
  const reviewFormY = useRef<number | null>(null);
  const commentInputOffsetY = useRef<number | null>(null);
  const photosInputOffsetY = useRef<number | null>(null);

  const ticketUrl = event?.ticket_url?.trim() ?? "";
  const directionsUrl = getDirectionsUrl(event);

  const scrollToY = useCallback((y: number | null | undefined) => {
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
  }, []);

  const getReviewInputY = useCallback((offset: number | null) => {
    if (reviewSectionY.current == null || reviewFormY.current == null || offset == null) return null;
    return reviewSectionY.current + reviewFormY.current + offset;
  }, []);

  const fetchEvent = useCallback(async (showLoader = true) => {
    if (!id) return;
    if (showLoader) {
      setLoading(true);
    }
    try {
      const data = await request<{ event: EventDetail }>(`/api/events/${id}`, { timeoutMs: 12000 });
      setEvent(data.event);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    fetchEvent(true);
  }, [fetchEvent]);

  useEffect(() => {
    if (!pendingReviewScroll) return;
    scrollToY(reviewSectionY.current);
    setPendingReviewScroll(false);
  }, [pendingReviewScroll, scrollToY]);

  useEffect(() => {
    if (!id || !canSave) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await request<{ saved: boolean }>(`/api/saved/${id}`, { timeoutMs: 8000 });
        if (!cancelled) {
          setSaved(Boolean(data.saved));
          setSaveError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Unknown error";
          setSaveError(message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, canSave, request]);

  const handleToggleSave = async () => {
    if (!id || !canSave || saveLoading) return;
    setSaveLoading(true);
    try {
      if (saved) {
        await request(`/api/saved/${id}`, { method: "DELETE", timeoutMs: 12000 });
        setSaved(false);
      } else {
        await request("/api/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_id: id }),
          timeoutMs: 12000,
        });
        setSaved(true);
      }
      setSaveError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setSaveError(message);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleOpenTickets = async () => {
    if (!ticketUrl) {
      Alert.alert("Tickets unavailable", "No ticket link is available for this event.");
      return;
    }
    try {
      setActionError(null);
      const supported = await Linking.canOpenURL(ticketUrl);
      if (!supported) {
        throw new Error("Unable to open ticket link");
      }
      await Linking.openURL(ticketUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to open tickets";
      setActionError(message);
    }
  };

  const handleOpenDirections = async () => {
    if (!directionsUrl) {
      Alert.alert("Directions unavailable", "No location data is available for this event.");
      return;
    }
    try {
      setActionError(null);
      const supported = await Linking.canOpenURL(directionsUrl);
      if (!supported) {
        throw new Error("Unable to open maps");
      }
      await Linking.openURL(directionsUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to open directions";
      setActionError(message);
    }
  };

  const handleShare = async () => {
    if (!event) return;
    try {
      setActionError(null);
      const messageParts = [
        event.title,
        formatTimeRange(event.start_time, event.end_time),
        event.location?.name,
        event.location?.address,
      ].filter(Boolean) as string[];
      if (ticketUrl) {
        messageParts.push(`Tickets: ${ticketUrl}`);
      }
      await Share.share({ message: messageParts.join("\n") });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to share";
      setActionError(message);
    }
  };

  const handleSubmitReview = async () => {
    if (!id) return;
    if (!canReview) {
      setReviewError("Set EXPO_PUBLIC_USER_ID to submit reviews.");
      return;
    }
    if (!reviewRating) {
      setReviewError("Select a rating before submitting.");
      return;
    }
    setReviewSubmitting(true);
    setReviewError(null);
    setReviewSuccess(null);
    try {
      const photos = reviewPhotos
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const payload: { rating: number; comment?: string; photos?: string[] } = {
        rating: reviewRating,
      };
      const trimmedComment = reviewComment.trim();
      if (trimmedComment) payload.comment = trimmedComment;
      if (photos.length) payload.photos = photos;

      await request(`/api/events/${id}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: 12000,
      });
      setReviewSuccess("Review submitted. Thanks!");
      setReviewRating(null);
      setReviewComment("");
      setReviewPhotos("");
      await fetchEvent(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setReviewError(message);
    } finally {
      setReviewSubmitting(false);
    }
  };

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
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight + 8}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
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
              <Pressable
                style={[styles.primaryButton, !ticketUrl && styles.primaryButtonDisabled]}
                onPress={handleOpenTickets}
                disabled={!ticketUrl}
              >
                <Text style={styles.primaryButtonText}>
                  {ticketUrl ? "Buy Tickets" : "Tickets unavailable"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleToggleSave}
                disabled={!canSave || saveLoading}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  (!canSave || saveLoading) && styles.secondaryButtonDisabled,
                  pressed && canSave && !saveLoading && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.secondaryButtonText}>
                  {saveLoading ? "Saving..." : saved ? "Saved" : "Save"}
                </Text>
              </Pressable>
            </View>
            <View style={styles.secondaryActionRow}>
              <Pressable
                onPress={handleOpenDirections}
                disabled={!directionsUrl}
                style={({ pressed }) => [
                  styles.tertiaryButton,
                  (!directionsUrl || pressed) && styles.tertiaryButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.tertiaryButtonText,
                    !directionsUrl && styles.tertiaryButtonTextDisabled,
                  ]}
                >
                  Directions
                </Text>
              </Pressable>
              <Pressable
                onPress={handleShare}
                style={({ pressed }) => [styles.tertiaryButton, pressed && styles.tertiaryButtonDisabled]}
              >
                <Text style={styles.tertiaryButtonText}>Share</Text>
              </Pressable>
            </View>
            {saveError && <Text style={styles.error}>Save error: {saveError}</Text>}
            {actionError && <Text style={styles.error}>Action error: {actionError}</Text>}

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
                    <Text style={styles.cardTitle}>Rating {rev.rating}</Text>
                    {rev.comment ? <Text style={styles.cardBody}>{rev.comment}</Text> : null}
                    {rev.created_at ? <Text style={styles.muted}>{rev.created_at}</Text> : null}
                  </View>
                ))}
              </View>
            )}

            <View
              style={styles.section}
              onLayout={(event) => {
                reviewSectionY.current = event.nativeEvent.layout.y;
                if (pendingReviewScroll) {
                  scrollToY(reviewSectionY.current);
                  setPendingReviewScroll(false);
                }
              }}
            >
              <Text style={styles.sectionTitle}>Write a Review</Text>
              {!canReview && (
                <Text style={styles.muted}>
                  Set EXPO_PUBLIC_USER_ID in your client env to submit reviews.
                </Text>
              )}
              <Pressable
                onPress={() => {
                  setShowReviewForm((prev) => {
                    const next = !prev;
                    if (next) {
                      setPendingReviewScroll(true);
                    }
                    return next;
                  });
                  setReviewError(null);
                  setReviewSuccess(null);
                }}
                disabled={!canReview}
                style={({ pressed }) => [
                  styles.reviewToggle,
                  (!canReview || pressed) && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.reviewToggleText}>
                  {showReviewForm ? "Hide form" : "Add review"}
                </Text>
              </Pressable>
              {showReviewForm && (
                <View
                  style={styles.reviewForm}
                  onLayout={(event) => {
                    reviewFormY.current = event.nativeEvent.layout.y;
                  }}
                >
                  <Text style={styles.label}>Rating</Text>
                  <View style={styles.ratingRow}>
                    {[1, 2, 3, 4, 5].map((val) => (
                      <Pressable
                        key={val}
                        onPress={() => {
                          setReviewRating(val);
                          setReviewError(null);
                          setReviewSuccess(null);
                        }}
                        style={[
                          styles.ratingChip,
                          reviewRating === val && styles.ratingChipSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.ratingChipText,
                            reviewRating === val && styles.ratingChipTextSelected,
                          ]}
                        >
                          {val}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.label}>Comment</Text>
                  <TextInput
                    value={reviewComment}
                    onChangeText={(text) => {
                      setReviewComment(text);
                      setReviewSuccess(null);
                    }}
                    placeholder="Share your experience"
                    multiline
                    style={styles.input}
                    onLayout={(event) => {
                      commentInputOffsetY.current = event.nativeEvent.layout.y;
                    }}
                    onFocus={() => scrollToY(getReviewInputY(commentInputOffsetY.current))}
                  />
                  <Text style={styles.label}>Photo URLs (optional)</Text>
                  <TextInput
                    value={reviewPhotos}
                    onChangeText={(text) => {
                      setReviewPhotos(text);
                      setReviewSuccess(null);
                    }}
                    placeholder="https://example.com/photo1.jpg, https://example.com/photo2.jpg"
                    style={styles.input}
                    onLayout={(event) => {
                      photosInputOffsetY.current = event.nativeEvent.layout.y;
                    }}
                    onFocus={() => scrollToY(getReviewInputY(photosInputOffsetY.current))}
                  />
                  {reviewError && <Text style={styles.error}>Review error: {reviewError}</Text>}
                  {reviewSuccess && <Text style={styles.success}>{reviewSuccess}</Text>}
                  <Pressable
                    onPress={handleSubmitReview}
                    disabled={reviewSubmitting}
                    style={({ pressed }) => [
                      styles.submitButton,
                      (pressed || reviewSubmitting) && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={styles.submitButtonText}>
                      {reviewSubmitting ? "Submitting..." : "Submit Review"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function getDirectionsUrl(event: EventDetail | null): string | null {
  if (!event?.location) return null;
  const name = event.location.name ?? "";
  const address = event.location.address ?? "";
  const lat = event.location.latitude;
  const lng = event.location.longitude;

  if (lat != null && lng != null) {
    const query = `${lat},${lng}`;
    if (Platform.OS === "ios") {
      return `http://maps.apple.com/?q=${encodeURIComponent(query)}`;
    }
    if (Platform.OS === "android") {
      return `geo:${lat},${lng}?q=${encodeURIComponent(query)}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  if (!address && !name) return null;
  const query = encodeURIComponent(`${name} ${address}`.trim());
  if (Platform.OS === "ios") {
    return `http://maps.apple.com/?q=${query}`;
  }
  if (Platform.OS === "android") {
    return `geo:0,0?q=${query}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
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
  keyboardAvoid: { flex: 1 },
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
  primaryButtonDisabled: {
    opacity: 0.6,
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
  secondaryButtonDisabled: {
    opacity: 0.6,
  },
  secondaryButtonText: { color: "#3949ab", fontWeight: "700", fontSize: 14 },
  secondaryActionRow: { flexDirection: "row", gap: 10 },
  tertiaryButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#cfd5ff",
    backgroundColor: "#f5f7ff",
  },
  tertiaryButtonText: { color: "#3949ab", fontWeight: "700", fontSize: 13 },
  tertiaryButtonDisabled: { opacity: 0.6 },
  tertiaryButtonTextDisabled: { color: "#9aa0b5" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  body: { fontSize: 14, color: "#222" },
  muted: { fontSize: 12, color: "#666" },
  label: { fontSize: 13, fontWeight: "600", color: "#333" },
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
  reviewToggle: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
    marginTop: 4,
  },
  reviewToggleText: { color: "#3949ab", fontWeight: "700", fontSize: 13 },
  reviewForm: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  ratingRow: { flexDirection: "row", gap: 8 },
  ratingChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
  },
  ratingChipSelected: {
    backgroundColor: "#3949ab",
  },
  ratingChipText: { fontSize: 12, color: "#3949ab", fontWeight: "600" },
  ratingChipTextSelected: { color: "#fff" },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
    backgroundColor: "#fff",
  },
  submitButton: {
    marginTop: 4,
    backgroundColor: "#3949ab",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  success: { color: "#2e7d32", fontSize: 13 },
});
