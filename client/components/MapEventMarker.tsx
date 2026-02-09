import { memo } from "react";
import { StyleSheet, View } from "react-native";

type MapEventMarkerProps = {
  selected?: boolean;
};

function MapEventMarkerBase({ selected = false }: MapEventMarkerProps) {
  return (
    <View style={[styles.marker, selected && styles.markerSelected]}>
      <View style={[styles.innerDot, selected && styles.innerDotSelected]} />
    </View>
  );
}

export const MapEventMarker = memo(MapEventMarkerBase);

const styles = StyleSheet.create({
  marker: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: "#8f6bff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1a1528",
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  markerSelected: {
    width: 22,
    height: 22,
    borderWidth: 3,
    shadowOpacity: 0.42,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 7,
  },
  innerDot: {
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#f4eeff",
  },
  innerDotSelected: {
    width: 5,
    height: 5,
  },
});
