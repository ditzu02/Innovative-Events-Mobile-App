import { forwardRef, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";

import { MUTED_MAP_STYLE } from "@/constants/map-style";
import { MapEventMarker } from "@/components/MapEventMarker";

export type EventMapVariant = "preview" | "full";

export type EventMapEvent = {
  id: string;
  title: string;
  subtitle: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
};

type LatLng = {
  latitude: number;
  longitude: number;
};

type EventMapProps = {
  events: EventMapEvent[];
  userPin?: LatLng | null;
  onMarkerPress?: (event: EventMapEvent) => void;
  variant: EventMapVariant;
  defaultRegion: Region;
  region?: Region;
  selectedEventId?: string | null;
  onMapReady?: () => void;
  onRegionChangeComplete?: (region: Region) => void;
  onLongPress?: (coordinate: LatLng) => void;
  onUserPinDragEnd?: (coordinate: LatLng) => void;
  showLoadingOverlay?: boolean;
};

function isValidLatLng(value: LatLng | null | undefined): value is LatLng {
  if (!value) return false;
  if (!Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) return false;
  if (value.latitude < -90 || value.latitude > 90) return false;
  if (value.longitude < -180 || value.longitude > 180) return false;
  return true;
}

function isValidRegion(region: Region | null | undefined): region is Region {
  if (!region) return false;
  if (!isValidLatLng(region)) return false;
  if (!Number.isFinite(region.latitudeDelta) || !Number.isFinite(region.longitudeDelta)) return false;
  if (region.latitudeDelta <= 0 || region.longitudeDelta <= 0) return false;
  return true;
}

function toSafeRegion(input: Region, fallback: Region): Region {
  if (!isValidRegion(input)) {
    return fallback;
  }
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    latitudeDelta: input.latitudeDelta,
    longitudeDelta: input.longitudeDelta,
  };
}

export const EventMap = forwardRef<MapView, EventMapProps>(function EventMap(
  {
    events,
    userPin = null,
    onMarkerPress,
    variant,
    defaultRegion,
    region,
    selectedEventId = null,
    onMapReady,
    onRegionChangeComplete,
    onLongPress,
    onUserPinDragEnd,
    showLoadingOverlay = false,
  },
  ref
) {
  const [isMapReady, setIsMapReady] = useState(false);
  const isPreview = variant === "preview";

  const initialRegion = useMemo<Region>(() => {
    const fallback = toSafeRegion(defaultRegion, {
      latitude: 48.2082,
      longitude: 16.3738,
      latitudeDelta: 0.2,
      longitudeDelta: 0.2,
    });

    if (isValidLatLng(userPin)) {
      return {
        latitude: userPin.latitude,
        longitude: userPin.longitude,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };
    }

    const firstEvent = events[0];
    if (firstEvent && isValidLatLng(firstEvent.coordinate)) {
      return {
        latitude: firstEvent.coordinate.latitude,
        longitude: firstEvent.coordinate.longitude,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };
    }

    return fallback;
  }, [defaultRegion, events, userPin]);

  const previewRegion = useMemo(() => {
    if (!isPreview) return undefined;
    if (isValidRegion(region)) return region;
    return initialRegion;
  }, [isPreview, region, initialRegion]);

  return (
    <View style={styles.container} pointerEvents={isPreview ? "none" : "auto"}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        mapType="standard"
        initialRegion={initialRegion}
        region={previewRegion}
        customMapStyle={MUTED_MAP_STYLE}
        rotateEnabled={false}
        pitchEnabled={false}
        scrollEnabled={!isPreview}
        zoomEnabled={!isPreview}
        toolbarEnabled={false}
        onMapReady={() => {
          setIsMapReady(true);
          onMapReady?.();
        }}
        onRegionChangeComplete={(nextRegion) => {
          if (isPreview || !onRegionChangeComplete || !isValidRegion(nextRegion)) {
            return;
          }
          onRegionChangeComplete(nextRegion);
        }}
        onLongPress={(event) => {
          if (isPreview || !onLongPress) {
            return;
          }
          onLongPress(event.nativeEvent.coordinate);
        }}
      >
        {isValidLatLng(userPin) && (
          <Marker
            coordinate={userPin}
            title="Your location"
            pinColor="#8f6bff"
            draggable={!isPreview && !!onUserPinDragEnd}
            onDragEnd={(event) => {
              onUserPinDragEnd?.(event.nativeEvent.coordinate);
            }}
          />
        )}

        {events.map((event) => {
          const selected = selectedEventId === event.id;
          return (
            <Marker
              key={event.id}
              coordinate={event.coordinate}
              title={event.title}
              description={event.subtitle}
              zIndex={selected ? 1000 : 10}
              tracksViewChanges={selected}
              onPress={() => onMarkerPress?.(event)}
            >
              <MapEventMarker selected={selected} />
            </Marker>
          );
        })}
      </MapView>

      {showLoadingOverlay && !isMapReady && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#8f6bff" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(11, 10, 18, 0.24)",
  },
  loadingText: {
    color: "#f5f3ff",
    fontSize: 12,
    fontWeight: "600",
  },
});
