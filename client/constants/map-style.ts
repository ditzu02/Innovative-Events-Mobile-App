import type { MapStyleElement } from "react-native-maps";

export const MUTED_MAP_STYLE: MapStyleElement[] = [
  {
    elementType: "geometry",
    stylers: [{ color: "#ebe7e0" }],
  },
  {
    elementType: "labels.text.fill",
    stylers: [{ color: "#6f6a60" }],
  },
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#f8f7f3" }],
  },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#d8d2c8" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#e6e1d9" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8a8578" }],
  },
  {
    featureType: "poi.business",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry.fill",
    stylers: [{ color: "#d7ddcf" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#f7f4ee" }],
  },
  {
    featureType: "road",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#f2ede3" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#e9e1d3" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#d6c9b3" }],
  },
  {
    featureType: "road.local",
    elementType: "geometry",
    stylers: [{ color: "#fcfbf8" }],
  },
  {
    featureType: "transit",
    stylers: [{ saturation: -100 }, { lightness: 16 }],
  },
  {
    featureType: "transit.line",
    elementType: "geometry",
    stylers: [{ color: "#dfd8cc" }],
  },
  {
    featureType: "water",
    elementType: "geometry.fill",
    stylers: [{ color: "#c9d9df" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6b8792" }],
  },
];
