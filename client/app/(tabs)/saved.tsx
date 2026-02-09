import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/context/auth";
import { SavedEventSummary, useSaved } from "@/context/saved";
import { EventCard, EventCardViewModel } from "@/components/EventCard";
import { EventStatus, formatEventTime, formatLocationLabel, formatPrice, getEventStatus, pickTopTags } from "@/lib/event-formatting";

type SavedCardViewModel = EventCardViewModel & { event: SavedEventSummary };

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

function getPlaceholderToken(category: string | null, title: string): string {
  const source = category?.trim() || title.trim();
  if (!source) return "EV";
  const match = source.match(/[A-Za-z0-9]/);
  return (match?.[0] ?? "E").toUpperCase();
}

function getStatusLabel(status: Exclude<EventStatus, "ENDED">, startTime: string | null, now: Date): string | null {
  if (status === "LIVE") return "LIVE NOW";
  if (status === "SOON" && startTime) {
    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) {
      return "Starts Soon";
    }
    const hours = Math.max(1, Math.ceil((start.getTime() - now.getTime()) / (60 * 60 * 1000)));
    return `Starts in ${hours}h`;
  }
  return null;
}

export default function SavedScreen() {
  const router = useRouter();
  const { isAuthed, authLoading } = useAuth();
  const { savedEvents, savedLoading, savedError, pendingSaveIds, refreshSaved, toggleSave } = useSaved();
  const [refreshing, setRefreshing] = useState(false);
  const [clockTick, setClockTick] = useState<number>(() => Date.now());

  const savedTitle = isAuthed ? `Saved Events (${savedEvents.length})` : "Saved Events";

  useFocusEffect(
    useCallback(() => {
      if (authLoading || !isAuthed) {
        return;
      }
      refreshSaved();
    }, [authLoading, isAuthed, refreshSaved])
  );

  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshSaved();
    } finally {
      setRefreshing(false);
    }
  }, [refreshSaved]);

  const cardViewModels = useMemo<SavedCardViewModel[]>(() => {
    const now = new Date(clockTick);

    return savedEvents.flatMap((event) => {
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

      return [{
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
      }];
    });
  }, [savedEvents, clockTick]);

  const handleToggleSave = useCallback(
    async (event: SavedEventSummary) => {
      try {
        await toggleSave(event);
      } catch {}
    },
    [toggleSave]
  );

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

      {isAuthed && savedLoading && savedEvents.length === 0 && (
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

      {!savedLoading && isAuthed && savedError && <Text style={styles.error}>Error: {savedError}</Text>}

      {!savedLoading && isAuthed && !savedError && cardViewModels.length === 0 && (
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

      {isAuthed && cardViewModels.length > 0 && (
        <FlatList
          data={cardViewModels}
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
            <EventCard
              model={item}
              onPress={() => router.push(`/event/${item.id}`)}
              saved
              savePending={pendingSaveIds.has(item.id)}
              onToggleSave={() => handleToggleSave(item.event)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, flex: 1, backgroundColor: PALETTE.background },
  title: { fontSize: 20, fontWeight: "700", color: PALETTE.text },
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
  separator: { height: 10 },
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
