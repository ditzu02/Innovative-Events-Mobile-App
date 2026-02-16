import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import Constants, { ExecutionEnvironment } from "expo-constants";
import {
  Animated,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type RailCategoryKey = "all" | "music" | "food" | "nightlife" | "arts" | "outdoor";

export type RailChip = {
  key: RailCategoryKey;
  label: string;
  categoryId: string | null;
  slug: string | null;
  disabled?: boolean;
};

type CategoryRailProps = {
  chips: RailChip[];
  selectedKey: RailCategoryKey;
  onSelect: (chip: RailChip) => void;
};

type ChipLayout = {
  x: number;
  width: number;
};

type ChipButtonProps = {
  chip: RailChip;
  selected: boolean;
  onPress: (chip: RailChip) => void;
  onLayout: (key: RailCategoryKey, layout: ChipLayout) => void;
};

const IOS_EXPO_GO_RAIL_SAFE_MODE =
  Platform.OS === "ios" &&
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function isFinitePositiveOrZero(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function AnimatedChipButtonBase({ chip, selected, onPress, onLayout }: ChipButtonProps) {
  const selection = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(selection, {
      toValue: selected ? 1 : 0,
      duration: 140,
      useNativeDriver: false,
    }).start();
  }, [selected, selection]);

  const animatedContainerStyle = useMemo(
    () => ({
      backgroundColor: selection.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(28, 25, 48, 0.9)", "rgba(143, 107, 255, 0.96)"],
      }),
      borderColor: selection.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(44, 39, 64, 0.9)", "rgba(143, 107, 255, 1)"],
      }),
    }),
    [selection]
  );

  const animatedTextStyle = useMemo(
    () => ({
      color: selection.interpolate({
        inputRange: [0, 1],
        outputRange: ["#b8b4cd", "#ffffff"],
      }),
    }),
    [selection]
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      if (!isFinitePositiveOrZero(x) || !isFinitePositiveOrZero(width)) {
        return;
      }
      onLayout(chip.key, { x, width });
    },
    [chip.key, onLayout]
  );

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[
        styles.chip,
        chip.disabled && styles.chipDisabled,
        animatedContainerStyle,
      ]}
    >
      <Pressable
        disabled={chip.disabled}
        onPress={() => onPress(chip)}
        style={styles.chipPressable}
      >
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.chipText,
            selected ? styles.chipTextSelected : styles.chipTextUnselected,
            animatedTextStyle,
          ]}
        >
          {chip.label}
        </Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

const AnimatedChipButton = memo(AnimatedChipButtonBase);

function StaticChipButtonBase({ chip, selected, onPress, onLayout }: ChipButtonProps) {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      if (!isFinitePositiveOrZero(x) || !isFinitePositiveOrZero(width)) {
        return;
      }
      onLayout(chip.key, { x, width });
    },
    [chip.key, onLayout]
  );

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.chip,
        selected ? styles.chipStaticSelected : styles.chipStaticUnselected,
        chip.disabled && styles.chipDisabled,
      ]}
    >
      <Pressable
        disabled={chip.disabled}
        onPress={() => onPress(chip)}
        style={styles.chipPressable}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.chipText,
            selected ? styles.chipTextSelected : styles.chipTextUnselected,
            selected ? styles.chipTextStaticSelected : styles.chipTextStaticUnselected,
          ]}
        >
          {chip.label}
        </Text>
      </Pressable>
    </View>
  );
}

const StaticChipButton = memo(StaticChipButtonBase);

export function CategoryRail({ chips, selectedKey, onSelect }: CategoryRailProps) {
  const scrollRef = useRef<ScrollView | null>(null);
  const railWidthRef = useRef(0);
  const contentWidthRef = useRef(0);
  const chipLayoutsRef = useRef<Partial<Record<RailCategoryKey, ChipLayout>>>({});
  const centerFrameRef = useRef<number | null>(null);

  const cancelPendingCenter = useCallback(() => {
    if (centerFrameRef.current == null) {
      return;
    }
    cancelAnimationFrame(centerFrameRef.current);
    centerFrameRef.current = null;
  }, []);

  const centerSelected = useCallback(
    (animated: boolean) => {
      const layout = chipLayoutsRef.current[selectedKey];
      if (!layout) return;
      if (!isFinitePositiveOrZero(layout.x) || !isFinitePositiveOrZero(layout.width)) {
        return;
      }

      const railWidth = railWidthRef.current;
      const contentWidth = contentWidthRef.current;
      if (
        !isFinitePositiveOrZero(railWidth) ||
        !isFinitePositiveOrZero(contentWidth) ||
        railWidth <= 0 ||
        contentWidth <= railWidth
      ) {
        return;
      }

      const target = layout.x + layout.width / 2 - railWidth / 2;
      const max = Math.max(0, contentWidth - railWidth);
      const nextX = Math.max(0, Math.min(target, max));
      if (!isFinitePositiveOrZero(nextX)) {
        return;
      }
      try {
        scrollRef.current?.scrollTo({ x: nextX, y: 0, animated });
      } catch {
        // Protect Expo Go iOS from occasional native scroll crashes during relayout.
      }
    },
    [selectedKey]
  );

  const scheduleCenterSelected = useCallback(
    (animated: boolean) => {
      cancelPendingCenter();
      centerFrameRef.current = requestAnimationFrame(() => {
        centerFrameRef.current = null;
        centerSelected(animated);
      });
    },
    [cancelPendingCenter, centerSelected]
  );

  const handleChipLayout = useCallback(
    (key: RailCategoryKey, layout: ChipLayout) => {
      chipLayoutsRef.current[key] = layout;
      if (key === selectedKey) {
        if (IOS_EXPO_GO_RAIL_SAFE_MODE) {
          scheduleCenterSelected(false);
          return;
        }
        centerSelected(false);
      }
    },
    [centerSelected, selectedKey, scheduleCenterSelected]
  );

  useEffect(() => {
    if (IOS_EXPO_GO_RAIL_SAFE_MODE) {
      scheduleCenterSelected(true);
      return cancelPendingCenter;
    }
    const frame = requestAnimationFrame(() => {
      centerSelected(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [chips, selectedKey, centerSelected, scheduleCenterSelected, cancelPendingCenter]);

  useEffect(() => cancelPendingCenter, [cancelPendingCenter]);

  const ChipButton = IOS_EXPO_GO_RAIL_SAFE_MODE ? StaticChipButton : AnimatedChipButton;

  return (
    <View
      onLayout={(event) => {
        railWidthRef.current = event.nativeEvent.layout.width;
      }}
      style={styles.container}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        onContentSizeChange={(width) => {
          contentWidthRef.current = width;
        }}
      >
        {chips.map((chip) => (
          <ChipButton
            key={chip.key}
            chip={chip}
            selected={chip.key === selectedKey}
            onPress={onSelect}
            onLayout={handleChipLayout}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 44,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 42,
    justifyContent: "center",
  },
  chipPressable: {
    minHeight: 42,
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  chipText: {
    letterSpacing: 0.1,
  },
  chipTextSelected: {
    fontSize: 14,
    fontWeight: "700",
  },
  chipTextUnselected: {
    fontSize: 13,
    fontWeight: "600",
  },
  chipStaticSelected: {
    backgroundColor: "rgba(143, 107, 255, 0.96)",
    borderColor: "rgba(143, 107, 255, 1)",
  },
  chipStaticUnselected: {
    backgroundColor: "rgba(28, 25, 48, 0.9)",
    borderColor: "rgba(44, 39, 64, 0.9)",
  },
  chipTextStaticSelected: {
    color: "#ffffff",
  },
  chipTextStaticUnselected: {
    color: "#b8b4cd",
  },
  chipDisabled: {
    opacity: 0.45,
  },
});
