import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
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

const PALETTE = {
  text: "#f5f3ff",
  line: "#2c2740",
  accent: "#8f6bff",
};

type ChipLayout = {
  x: number;
  width: number;
};

function isFinitePositiveOrZero(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function ChipButtonBase({
  chip,
  selected,
  onPress,
  onLayout,
}: {
  chip: RailChip;
  selected: boolean;
  onPress: (chip: RailChip) => void;
  onLayout: (key: RailCategoryKey, layout: ChipLayout) => void;
}) {
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
        outputRange: ["rgba(28, 25, 48, 0.9)", PALETTE.accent],
      }),
      borderColor: selection.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(44, 39, 64, 0.9)", PALETTE.accent],
      }),
    }),
    [selection]
  );

  const animatedTextStyle = useMemo(
    () => ({
      color: selection.interpolate({
        inputRange: [0, 1],
        outputRange: ["#c6c3d7", "#ffffff"],
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

const ChipButton = memo(ChipButtonBase);

export function CategoryRail({ chips, selectedKey, onSelect }: CategoryRailProps) {
  const scrollRef = useRef<ScrollView | null>(null);
  const railWidthRef = useRef(0);
  const contentWidthRef = useRef(0);
  const chipLayoutsRef = useRef<Partial<Record<RailCategoryKey, ChipLayout>>>({});

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
      scrollRef.current?.scrollTo({ x: nextX, y: 0, animated });
    },
    [selectedKey]
  );

  const handleChipLayout = useCallback(
    (key: RailCategoryKey, layout: ChipLayout) => {
      chipLayoutsRef.current[key] = layout;
      if (key === selectedKey) {
        centerSelected(false);
      }
    },
    [centerSelected, selectedKey]
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      centerSelected(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [chips, selectedKey, centerSelected]);

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
    minHeight: 40,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 38,
    justifyContent: "center",
  },
  chipPressable: {
    minHeight: 38,
    paddingHorizontal: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  chipText: {
    fontSize: 13,
    letterSpacing: 0.1,
  },
  chipTextSelected: {
    fontWeight: "700",
  },
  chipTextUnselected: {
    fontWeight: "600",
  },
  chipDisabled: {
    opacity: 0.45,
  },
});
