import { memo, useCallback, useMemo, useRef } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { EventStatus } from "@/lib/event-formatting";

const PALETTE = {
  surface: "#151321",
  surfaceAlt: "#1c1930",
  line: "#2c2740",
  text: "#f5f3ff",
  muted: "#a2a1b4",
};

export type EventCardViewModel = {
  id: string;
  title: string;
  status: Exclude<EventStatus, "ENDED">;
  statusLabel: string | null;
  coverImageUrl: string | null;
  placeholderToken: string;
  timeLabel: string;
  locationLabel: string | null;
  priceLabel: string | null;
  visibleTags: string[];
  ratingLabel: string | null;
};

type EventCardProps = {
  model: EventCardViewModel;
  onPress: () => void;
  saved?: boolean;
  onToggleSave?: () => void;
  savePending?: boolean;
  saveDisabledReason?: string | null;
};

function EventCardBase({
  model,
  onPress,
  saved = false,
  onToggleSave,
  savePending = false,
  saveDisabledReason = null,
}: EventCardProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const showStatusBadge = model.status === "LIVE" || model.status === "SOON";
  const timePillStyle = getTimePillStyle(model.status);
  const canToggleSave = !!onToggleSave && !savePending;

  const metaLeftLabel = useMemo(
    () => [model.locationLabel, model.priceLabel].filter(Boolean).join(" • "),
    [model.locationLabel, model.priceLabel]
  );

  const animateScale = useCallback(
    (value: number) => {
      Animated.timing(scale, {
        toValue: value,
        duration: 100,
        useNativeDriver: true,
      }).start();
    },
    [scale]
  );

  return (
    <Animated.View style={[styles.animatedWrap, { transform: [{ scale }] }]}>
      <View style={styles.cardWrap}>
        <Pressable
          onPress={onPress}
          onPressIn={() => animateScale(0.98)}
          onPressOut={() => animateScale(1)}
          style={styles.card}
        >
          <View style={styles.heroWrap}>
            {model.coverImageUrl ? (
              <Image source={{ uri: model.coverImageUrl }} style={styles.heroImage} resizeMode="cover" />
            ) : (
              <View style={styles.placeholderHero}>
                <Text style={styles.placeholderToken}>{model.placeholderToken}</Text>
              </View>
            )}
            {showStatusBadge && model.statusLabel && (
              <View style={[styles.statusBadge, getStatusStyle(model.status)]}>
                <Text style={styles.statusText}>{model.statusLabel}</Text>
              </View>
            )}
            <View style={styles.heroScrim} />
          </View>

          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
              {model.title}
            </Text>

            <View style={[styles.timePill, timePillStyle]}>
              <Text numberOfLines={1} style={styles.timePillText}>{model.timeLabel}</Text>
            </View>

            {(metaLeftLabel || model.ratingLabel) && (
              <View style={styles.infoBand}>
                {metaLeftLabel ? (
                  <Text numberOfLines={1} style={styles.infoBandLeft}>{metaLeftLabel}</Text>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                {model.ratingLabel && (
                  <Text numberOfLines={1} style={styles.infoBandRight}>{model.ratingLabel}</Text>
                )}
              </View>
            )}

            {model.visibleTags.length > 0 && (
              <View style={styles.tagsRow}>
                {model.visibleTags.map((tag) => (
                  <View key={tag} style={styles.tagChip}>
                    <Text style={styles.tagText} numberOfLines={1}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </Pressable>

        {onToggleSave && (
          <Pressable
            onPress={onToggleSave}
            disabled={!canToggleSave}
            accessibilityLabel={saved ? "Remove from saved events" : "Save event"}
            accessibilityHint={saveDisabledReason ?? undefined}
            style={[
              styles.saveButton,
              saved && styles.saveButtonActive,
              !canToggleSave && styles.saveButtonDisabled,
            ]}
          >
            <MaterialIcons
              name={saved ? "bookmark" : "bookmark-border"}
              size={18}
              color={saved ? "#ffffff" : PALETTE.text}
            />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

function getStatusStyle(status: Exclude<EventStatus, "ENDED">) {
  if (status === "SOON") return styles.statusSoon;
  return styles.statusLive;
}

function getTimePillStyle(status: Exclude<EventStatus, "ENDED">) {
  if (status === "LIVE") return styles.timePillLive;
  if (status === "SOON") return styles.timePillSoon;
  return styles.timePillLater;
}

export const EventCard = memo(EventCardBase);

const styles = StyleSheet.create({
  animatedWrap: {
    width: "100%",
  },
  cardWrap: {
    position: "relative",
  },
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    backgroundColor: PALETTE.surface,
    overflow: "hidden",
  },
  heroWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    position: "relative",
    backgroundColor: PALETTE.surfaceAlt,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  placeholderHero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#211d33",
  },
  placeholderToken: {
    color: PALETTE.text,
    fontWeight: "700",
    fontSize: 30,
    letterSpacing: 0.4,
  },
  heroScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 44,
    backgroundColor: "rgba(6, 5, 12, 0.42)",
  },
  statusBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusLive: {
    backgroundColor: "rgba(201, 50, 78, 0.94)",
  },
  statusSoon: {
    backgroundColor: "rgba(184, 118, 18, 0.94)",
  },
  statusText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  body: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 7,
  },
  title: {
    color: PALETTE.text,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
  },
  timePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  timePillLive: {
    backgroundColor: "rgba(201, 50, 78, 0.20)",
    borderColor: "rgba(201, 50, 78, 0.72)",
  },
  timePillSoon: {
    backgroundColor: "rgba(184, 118, 18, 0.20)",
    borderColor: "rgba(184, 118, 18, 0.65)",
  },
  timePillLater: {
    backgroundColor: "rgba(28, 25, 48, 0.92)",
    borderColor: PALETTE.line,
  },
  timePillText: {
    color: PALETTE.text,
    fontSize: 12,
    fontWeight: "700",
  },
  infoBand: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  infoBandLeft: {
    color: PALETTE.muted,
    fontSize: 12,
    flex: 1,
  },
  infoBandRight: {
    color: PALETTE.text,
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 0,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9,
    backgroundColor: "rgba(162, 161, 180, 0.09)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(162, 161, 180, 0.26)",
  },
  tagText: {
    color: "#9f9ab4",
    fontSize: 11,
    fontWeight: "600",
  },
  saveButton: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11, 10, 18, 0.68)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(245, 243, 255, 0.24)",
  },
  saveButtonActive: {
    backgroundColor: "rgba(143, 107, 255, 0.95)",
    borderColor: "rgba(143, 107, 255, 1)",
  },
  saveButtonDisabled: {
    opacity: 0.62,
  },
});
