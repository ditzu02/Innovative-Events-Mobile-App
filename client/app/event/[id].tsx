import { useCallback, useEffect, useRef, useState } from "react";
import {
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
import { useAuth } from "@/context/auth";

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

const PALETTE = {
  background: "#0b0a12",
  surface: "#151321",
  surfaceAlt: "#1c1930",
  line: "#2c2740",
  text: "#f5f3ff",
  muted: "#a2a1b4",
  accent: "#8f6bff",
  accentSoft: "#2b2446",
  success: "#39d5a4",
  danger: "#ff6b6b",
};

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const { isAuthed } = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const saveNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canSave = isAuthed;
  const canReview = isAuthed;
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
  const showSaveNotice = useCallback((message: string) => {
    setSaveNotice(message);
    if (saveNoticeTimer.current) {
      clearTimeout(saveNoticeTimer.current);
    }
    saveNoticeTimer.current = setTimeout(() => setSaveNotice(null), 2200);
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
    return () => {
      if (saveNoticeTimer.current) {
        clearTimeout(saveNoticeTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingReviewScroll) return;
    scrollToY(reviewSectionY.current);
    setPendingReviewScroll(false);
  }, [pendingReviewScroll, scrollToY]);

  useEffect(() => {
    if (!id || !canSave) {
      setSaved(false);
      setSaveError(null);
      return;
    }
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
    if (!id || saveLoading) return;
    if (!canSave) {
      showSaveNotice("Sign in to save events.");
      router.push("/account");
      return;
    }
    setSaveLoading(true);
    try {
      if (saved) {
        await request(`/api/saved/${id}`, { method: "DELETE", timeoutMs: 12000 });
        setSaved(false);
        showSaveNotice("Removed from saved.");
      } else {
        await request("/api/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_id: id }),
          timeoutMs: 12000,
        });
        setSaved(true);
        showSaveNotice("Saved to your list.");
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
      setReviewError("Sign in to submit reviews.");
      router.push("/account");
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
          headerShadowVisible: false,
          headerStyle: { backgroundColor: PALETTE.background },
          headerTitleStyle: { color: PALETTE.text },
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 8 }}>
              <Text style={{ color: PALETTE.accent, fontWeight: "600" }}>Back</Text>
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
          showsVerticalScrollIndicator={false}
        >
          {loading && (
            <View style={styles.skeletonWrap}>
              <View style={styles.skeletonHero} />
              <View style={[styles.skeletonLine, styles.skeletonLineWide]} />
              <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
              <View style={styles.skeletonRow}>
                <View style={styles.skeletonPill} />
                <View style={styles.skeletonPill} />
                <View style={styles.skeletonPill} />
              </View>
              <View style={styles.skeletonCard} />
              <View style={styles.skeletonCard} />
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
                disabled={saveLoading}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  (!canSave || saveLoading) && styles.secondaryButtonDisabled,
                  pressed && !saveLoading && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.secondaryButtonText}>
                  {saveLoading
                    ? "Saving..."
                    : !canSave
                      ? "Sign in to save"
                      : saved
                        ? "Saved"
                        : "Save"}
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
            {saveError && (
              <View style={[styles.feedback, styles.feedbackError]}>
                <Text style={styles.feedbackText}>Save error: {saveError}</Text>
              </View>
            )}
            {actionError && (
              <View style={[styles.feedback, styles.feedbackError]}>
                <Text style={styles.feedbackText}>Action error: {actionError}</Text>
              </View>
            )}
            {saveNotice && (
              <View style={[styles.feedback, styles.feedbackSuccess]}>
                <Text style={styles.feedbackText}>{saveNotice}</Text>
              </View>
            )}

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
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>Sign in to write a review.</Text>
                  <Pressable
                    onPress={() => router.push("/account")}
                    style={({ pressed }) => [styles.noticeButton, pressed && { opacity: 0.8 }]}
                  >
                    <Text style={styles.noticeButtonText}>Go to Account</Text>
                  </Pressable>
                </View>
              )}
              <Pressable
                onPress={() => {
                  if (!canReview) {
                    router.push("/account");
                    return;
                  }
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
                style={({ pressed }) => [
                  styles.reviewToggle,
                  (pressed || !canReview) && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.reviewToggleText}>
                  {showReviewForm ? "Hide form" : "Write a review"}
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
                    placeholderTextColor={PALETTE.muted}
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
                    placeholderTextColor={PALETTE.muted}
                    style={styles.input}
                    onLayout={(event) => {
                      photosInputOffsetY.current = event.nativeEvent.layout.y;
                    }}
                    onFocus={() => scrollToY(getReviewInputY(photosInputOffsetY.current))}
                  />
                  {reviewError && (
                    <View style={[styles.feedback, styles.feedbackError]}>
                      <Text style={styles.feedbackText}>Review error: {reviewError}</Text>
                    </View>
                  )}
                  {reviewSuccess && (
                    <View style={[styles.feedback, styles.feedbackSuccess]}>
                      <Text style={styles.feedbackText}>{reviewSuccess}</Text>
                    </View>
                  )}
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
  keyboardAvoid: { flex: 1, backgroundColor: PALETTE.background },
  container: { padding: 16, gap: 16, paddingBottom: 32 },
  content: { gap: 16 },
  title: { fontSize: 22, fontWeight: "700", color: PALETTE.text },
  subtitle: { fontSize: 14, color: PALETTE.muted },
  error: { color: PALETTE.danger, fontSize: 14 },
  skeletonWrap: { gap: 12 },
  skeletonHero: {
    height: 220,
    borderRadius: 16,
    backgroundColor: PALETTE.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
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
    width: 60,
    borderRadius: 10,
    backgroundColor: PALETTE.surfaceAlt,
  },
  skeletonCard: {
    height: 90,
    borderRadius: 12,
    backgroundColor: PALETTE.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  heroWrap: {
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  hero: { width: "100%", height: 260 },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  heroText: { position: "absolute", left: 16, bottom: 16, right: 16, gap: 4 },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#fff" },
  heroMeta: { color: "#e0dbff" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: PALETTE.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  badgeText: { fontSize: 12, color: PALETTE.accent },
  actionRow: { flexDirection: "row", gap: 10 },
  primaryButton: {
    flex: 1,
    backgroundColor: PALETTE.accent,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  secondaryButton: {
    minWidth: 132,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.accent,
    backgroundColor: PALETTE.surfaceAlt,
  },
  secondaryButtonDisabled: {
    opacity: 0.6,
  },
  secondaryButtonText: { color: PALETTE.accent, fontWeight: "700", fontSize: 14, textAlign: "center" },
  secondaryActionRow: { flexDirection: "row", gap: 10 },
  tertiaryButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    backgroundColor: PALETTE.surface,
  },
  tertiaryButtonText: { color: PALETTE.accent, fontWeight: "700", fontSize: 13 },
  tertiaryButtonDisabled: { opacity: 0.6 },
  tertiaryButtonTextDisabled: { color: PALETTE.muted },
  section: { gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: PALETTE.text },
  body: { fontSize: 14, color: PALETTE.text },
  muted: { fontSize: 12, color: PALETTE.muted },
  label: { fontSize: 13, fontWeight: "600", color: PALETTE.muted },
  infoCard: {
    backgroundColor: PALETTE.surface,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  infoLabel: { fontSize: 13, color: PALETTE.muted, width: 90 },
  infoValue: { fontSize: 14, color: PALETTE.text, flex: 1, textAlign: "right" },
  notice: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: PALETTE.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    gap: 8,
  },
  noticeText: { color: PALETTE.muted, fontSize: 12 },
  noticeButton: {
    alignSelf: "flex-start",
    backgroundColor: PALETTE.accentSoft,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.accent,
  },
  noticeButtonText: { color: PALETTE.text, fontSize: 12, fontWeight: "600" },
  feedback: {
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  feedbackText: { fontSize: 12, color: PALETTE.text },
  feedbackError: {
    backgroundColor: "rgba(255,107,107,0.15)",
    borderColor: PALETTE.danger,
  },
  feedbackSuccess: {
    backgroundColor: "rgba(57,213,164,0.15)",
    borderColor: PALETTE.success,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    borderRadius: 10,
    padding: 10,
    backgroundColor: PALETTE.surfaceAlt,
    gap: 4,
  },
  cardTitle: { fontSize: 14, fontWeight: "600", color: PALETTE.text },
  cardBody: { fontSize: 13, color: PALETTE.muted },
  photo: {
    width: 180,
    height: 120,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  reviewCard: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    borderRadius: 8,
    padding: 10,
    gap: 4,
    backgroundColor: PALETTE.surfaceAlt,
  },
  reviewToggle: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: PALETTE.accent,
    marginTop: 4,
  },
  reviewToggleText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  reviewForm: {
    marginTop: 8,
    backgroundColor: PALETTE.surface,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  ratingRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  ratingChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: PALETTE.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  ratingChipSelected: {
    backgroundColor: PALETTE.accent,
    borderColor: PALETTE.accent,
  },
  ratingChipText: { fontSize: 12, color: PALETTE.text, fontWeight: "600" },
  ratingChipTextSelected: { color: "#fff" },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
    backgroundColor: PALETTE.surfaceAlt,
    color: PALETTE.text,
  },
  submitButton: {
    marginTop: 4,
    backgroundColor: PALETTE.accent,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
