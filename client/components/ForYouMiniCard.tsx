import { memo, useCallback, useRef } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";

type ForYouMiniCardProps = {
  title: string;
  timeLabel: string;
  reasonLabel: string;
  imageUrl: string | null;
  onPress: () => void;
};

const PALETTE = {
  surface: "#151321",
  surfaceAlt: "#1c1930",
  line: "#2c2740",
  text: "#f5f3ff",
  muted: "#a2a1b4",
  accent: "#8f6bff",
};

function ForYouMiniCardBase({ title, timeLabel, reasonLabel, imageUrl, onPress }: ForYouMiniCardProps) {
  const scale = useRef(new Animated.Value(1)).current;

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
      <Pressable
        style={styles.card}
        onPress={onPress}
        onPressIn={() => animateScale(0.98)}
        onPressOut={() => animateScale(1)}
      >
        <View style={styles.mediaWrap}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.media} resizeMode="cover" />
          ) : (
            <View style={styles.mediaPlaceholder} />
          )}
        </View>
        <View style={styles.body}>
          <View style={styles.reasonPill}>
            <Text style={styles.reasonText} numberOfLines={1}>
              {reasonLabel}
            </Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {timeLabel}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export const ForYouMiniCard = memo(ForYouMiniCardBase);

const styles = StyleSheet.create({
  animatedWrap: {
    width: 220,
  },
  card: {
    backgroundColor: PALETTE.surface,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  mediaWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: PALETTE.surfaceAlt,
  },
  media: {
    width: "100%",
    height: "100%",
  },
  mediaPlaceholder: {
    flex: 1,
    backgroundColor: PALETTE.surfaceAlt,
  },
  body: {
    padding: 10,
    gap: 6,
  },
  reasonPill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(143, 107, 255, 0.18)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(143, 107, 255, 0.56)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reasonText: {
    color: PALETTE.accent,
    fontSize: 11,
    fontWeight: "600",
  },
  title: {
    color: PALETTE.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  meta: {
    color: PALETTE.muted,
    fontSize: 12,
    fontWeight: "500",
  },
});
