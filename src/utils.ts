// Premium Toast System
export function showToast(message: string, type: "success" | "error" | "info" = "success") {
  // Check if toast container exists
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-xs px-4";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `flex items-center gap-3 p-4 rounded-xl shadow-lg border text-sm transition-all duration-300 transform translate-y-2 opacity-0 font-sans`;

  let iconClass = "";
  let bgClass = "";
  let borderClass = "";

  if (type === "success") {
    iconClass = "fa-circle-check text-emerald-500 text-lg";
    bgClass = "bg-emerald-50 text-emerald-900";
    borderClass = "border-emerald-100";
  } else if (type === "error") {
    iconClass = "fa-circle-exclamation text-rose-500 text-lg";
    bgClass = "bg-rose-50 text-rose-900";
    borderClass = "border-rose-100";
  } else {
    iconClass = "fa-circle-info text-blue-500 text-lg";
    bgClass = "bg-blue-50 text-blue-900";
    borderClass = "border-blue-100";
  }

  toast.innerHTML = `
    <i class="fa-solid ${iconClass}"></i>
    <div class="flex-1 font-medium">${message}</div>
  `;
  toast.className += ` ${bgClass} ${borderClass}`;

  container.appendChild(toast);

  // Trigger animations
  setTimeout(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
    toast.classList.add("translate-y-0", "opacity-100");
  }, 10);

  // Remove toast
  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-2", "opacity-0");
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// Cloudinary Image Upload Function
export async function uploadToCloudinary(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", "med_delivery_upload");

  try {
    const response = await fetch("https://api.cloudinary.com/v1_1/djtzg5ou7/image/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Failed to upload image. Please check credentials.");
    }

    const data = await response.json();
    return data.secure_url;
  } catch (error) {
    console.error("Cloudinary Upload Error:", error);
    showToast("Image upload failed", "error");
    throw error;
  }
}

import * as maptilersdk from "@maptiler/sdk";
import "@maptiler/sdk/dist/maptiler-sdk.css";
import { db } from "./firebase";
import { ref, get, set, onValue } from "firebase/database";

// MapTiler REST API & Web Maps Integration Keys
export const MAPPLS_MAP_KEY = "3d8330747c66c6f01c3c680f12d5298d"; // retained for backward-compatibility stub
export const MAPPLS_CLIENT_ID = "96dHZVzsAut5eW6crFBJRerLd4L_8GLV3wy72csWzFe6rl-64qpQl3owhoO3DU5h2CRClplvfHFvH0jc7_ZadA==";

// Dynamic central MapTiler API Key
let maptilerApiKey = "v5kU4Y8LwB078Nf51Y7W"; // Default fallback key

// Realtime sync from Firebase DB
export function getMapTilerKey(): string {
  return maptilerApiKey;
}

export function setMapTilerKey(key: string) {
  maptilerApiKey = key;
  try {
    maptilersdk.config.apiKey = key;
  } catch (e) {}
}

// Auto load / sync key
onValue(ref(db, "config/maptilerKey"), (snap) => {
  if (snap.exists()) {
    setMapTilerKey(snap.val());
  } else {
    // Seed default if empty
    set(ref(db, "config/maptilerKey"), maptilerApiKey);
  }
});

export interface GeoLocation {
  lat: number;
  lng: number;
  address?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
}

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined" && window.location && window.location.origin && !window.location.origin.includes("file://")) {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

export async function mapplsFetch(pathWithQuery: string): Promise<Response> {
  // Retained stub for compatibility
  return fetch(pathWithQuery);
}

export async function getMapplsToken(): Promise<string> {
  return getMapTilerKey();
}

export function loadMapplsScript(callback: () => void) {
  // Instantly execute callback as MapTiler is bundled at compile-time
  setTimeout(callback, 0);
}

export async function getCurrentGPS(silent: boolean = false): Promise<GeoLocation> {
  const loadingIds = [
    "tracker-map-div-loading",
    "rider-leaflet-map-loading",
    "store-tracking-map-loading",
    "mappls-admin-map-loading"
  ];

  // Trigger loading state overlays
  loadingIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
  });

  const clearLoading = () => {
    loadingIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
  };

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      if (!silent) showToast("Geolocation is not supported by your browser", "error");
      clearLoading();
      reject(new Error("Geolocation unsupported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const detail = await reverseGeocode(latitude, longitude);
          clearLoading();
          resolve(detail);
        } catch (error) {
          clearLoading();
          resolve({ lat: latitude, lng: longitude });
        }
      },
      (error) => {
        if (!silent) showToast("GPS position query denied or failed. Please enable location.", "error");
        clearLoading();
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeoLocation> {
  const key = getMapTilerKey();
  try {
    const url = `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${key}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const addressStr = feature.place_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        
        let city = "Bengaluru";
        let state = "Karnataka";
        let pincode = "560038";
        
        if (feature.context) {
          for (const ctx of feature.context) {
            if (ctx.id.startsWith("postal_code")) {
              pincode = ctx.text;
            } else if (ctx.id.startsWith("place")) {
              city = ctx.text;
            } else if (ctx.id.startsWith("region")) {
              state = ctx.text;
            }
          }
        }
        
        return {
          lat,
          lng,
          address: addressStr,
          city,
          district: city,
          state,
          pincode
        };
      }
    }
  } catch (error) {
    console.error("MapTiler reverse geocode failed:", error);
  }

  return { lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, city: "Bengaluru", state: "Karnataka", pincode: "560038" };
}

export async function searchAddress(query: string): Promise<any[]> {
  if (!query || query.trim().length < 3) return [];
  const key = getMapTilerKey();
  try {
    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${key}&proximity=77.5946,12.9716`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const features = data.features || [];
      return features.map((item: any) => ({
        properties: {
          formatted: item.place_name || item.text || ""
        },
        geometry: {
          coordinates: [
            item.geometry?.coordinates?.[0] || 77.5946,
            item.geometry?.coordinates?.[1] || 12.9716
          ]
        }
      }));
    }
  } catch (error) {
    console.error("MapTiler geocoding search failed:", error);
  }
  return [];
}

// Distance Calculation (Haversine formula in KM)
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of outer earth in KM
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

// Map Rendering Image URL (Static map for display using MapTiler APIs)
export function getStaticMapUrl(lat: number, lng: number, zoom: number = 14, width: number = 400, height: number = 250): string {
  const key = getMapTilerKey();
  return `https://api.maptiler.com/maps/streets-v2/static/${lng},${lat},${zoom}/${width}x${height}.png?key=${key}&markers=${lng},${lat}`;
}

export function getRouteMapUrl(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  width: number = 400,
  height: number = 250
): string {
  const key = getMapTilerKey();
  const midLat = (startLat + endLat) / 2;
  const midLng = (startLng + endLng) / 2;
  return `https://api.maptiler.com/maps/streets-v2/static/${midLng},${midLat},12/${width}x${height}.png?key=${key}&markers=${startLng},${startLat}|${endLng},${endLat}`;
}

export interface MapplsRouteResult {
  polyline: number[][]; // array of [lat, lng]
  distance: number;
  duration: number;
}

export async function getMapplsRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<MapplsRouteResult> {
  const key = getMapTilerKey();
  try {
    const url = `https://api.maptiler.com/navigation/routing/v1/driving/${startLng},${startLat};${endLng},${endLat}.json?key=${key}&geometries=geojson`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const route = data.routes?.[0];
      if (route) {
        const coordinates = route.geometry?.coordinates || []; // [lng, lat]
        const polylinePoints = coordinates.map((coord: any) => [coord[1], coord[0]]) as number[][];
        const distance = (route.distance || 0) / 1000; // to KM
        const duration = (route.duration || 0) / 60; // to Minutes
        return {
          polyline: polylinePoints,
          distance: parseFloat(distance.toFixed(2)),
          duration: Math.ceil(duration)
        };
      }
    }
  } catch (error) {
    console.error("MapTiler routing query failed:", error);
  }

  const distance = calculateDistance(startLat, startLng, endLat, endLng);
  const duration = Math.ceil((distance / 30) * 60) + 3;
  return {
    polyline: [
      [startLat, startLng],
      [endLat, endLng]
    ],
    distance,
    duration
  };
}

export function updateLeafletMap(
  containerId: string,
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  isSingleMarker: boolean = false,
  startIconClass: string = "marker-rider",
  startIconAwesome: string = "fa-motorcycle",
  endIconClass: string = "marker-user",
  endIconAwesome: string = "fa-house-chimney-medical",
  middleLat?: number,
  middleLng?: number,
  middleIconClass: string = "marker-store",
  middleIconAwesome: string = "fa-prescription-bottle-medical"
) {
  const mapContainer = document.getElementById(containerId);
  if (!mapContainer) return;

  const key = getMapTilerKey();
  maptilersdk.config.apiKey = key;

  let mapInstance = (window as any)["map_" + containerId];
  if (!mapInstance) {
    mapContainer.innerHTML = "";
    try {
      const isDarkTheme = document.body.classList.contains("dark") || document.documentElement.classList.contains("dark");
      const mapStyle = isDarkTheme ? "darkmatter" : "streets-v2";
      
      mapInstance = new maptilersdk.Map({
        container: containerId,
        style: mapStyle as any,
        center: [endLng, endLat],
        zoom: 14,
        geolocate: false,
        navigationControl: true,
        scaleControl: false,
        attributionControl: false as any
      });
      (window as any)["map_" + containerId] = mapInstance;
    } catch (e) {
      console.error("Failed to init MapTiler map on container:", containerId, e);
      return;
    }
  }

  setTimeout(() => {
    try {
      if (mapInstance && typeof mapInstance.resize === "function") {
        mapInstance.resize();
      }
    } catch (e) {}
  }, 100);

  // Clear previous markers
  let activeOverlays = (window as any)["overlays_" + containerId] || [];
  activeOverlays.forEach((ol: any) => {
    try {
      if (ol && typeof ol.remove === "function") {
        ol.remove();
      }
    } catch (e) {}
  });
  activeOverlays = [];

  // Clear previous route layers and sources
  try {
    const segments = ["route-segment-1", "route-segment-2", "route-direct"];
    segments.forEach(segId => {
      const fullSegId = `${containerId}-${segId}`;
      if (mapInstance.getLayer(fullSegId)) mapInstance.removeLayer(fullSegId);
      if (mapInstance.getSource(fullSegId)) mapInstance.removeSource(fullSegId);
    });
  } catch (e) {
    console.error("Error clearing map route layers:", e);
  }

  try {
    if (isSingleMarker) {
      // Single Location Map View
      const el = document.createElement("div");
      el.className = `custom-maptiler-marker ${endIconClass} w-8.5 h-8.5 rounded-full shadow border-2 border-white flex items-center justify-center bg-teal-500 text-white`;
      el.innerHTML = `<i class="fa-solid ${endIconAwesome} text-xs"></i>`;

      const marker = new maptilersdk.Marker({ element: el })
        .setLngLat([endLng, endLat])
        .addTo(mapInstance);
      activeOverlays.push(marker);

      mapInstance.setCenter([endLng, endLat]);
      mapInstance.setZoom(14);
    } else {
      // Dual/Triple Pin Routing Map View
      const elStart = document.createElement("div");
      elStart.className = `custom-maptiler-marker ${startIconClass} w-8.5 h-8.5 rounded-full shadow border-2 border-white flex items-center justify-center bg-indigo-500 text-white`;
      elStart.innerHTML = `<i class="fa-solid ${startIconAwesome} text-xs"></i>`;
      const riderMarker = new maptilersdk.Marker({ element: elStart })
        .setLngLat([startLng, startLat])
        .addTo(mapInstance);
      activeOverlays.push(riderMarker);

      const elEnd = document.createElement("div");
      elEnd.className = `custom-maptiler-marker ${endIconClass} w-8.5 h-8.5 rounded-full shadow border-2 border-white flex items-center justify-center bg-teal-500 text-white`;
      elEnd.innerHTML = `<i class="fa-solid ${endIconAwesome} text-xs"></i>`;
      const userMarker = new maptilersdk.Marker({ element: elEnd })
        .setLngLat([endLng, endLat])
        .addTo(mapInstance);
      activeOverlays.push(userMarker);

      const drawRoutes = () => {
        if (middleLat && middleLng) {
          const elMid = document.createElement("div");
          elMid.className = `custom-maptiler-marker ${middleIconClass} w-8.5 h-8.5 rounded-full shadow border-2 border-white flex items-center justify-center bg-amber-500 text-white`;
          elMid.innerHTML = `<i class="fa-solid ${middleIconAwesome} text-xs"></i>`;
          const middleMarker = new maptilersdk.Marker({ element: elMid })
            .setLngLat([middleLng, middleLat])
            .addTo(mapInstance);
          activeOverlays.push(middleMarker);

          // Segment 1 (Rider -> Store)
          getMapplsRoute(startLat, startLng, middleLat, middleLng).then((res1) => {
            try {
              addRouteLayer(mapInstance, `${containerId}-route-segment-1`, res1.polyline, "#3b82f6", false);
            } catch (pe) {
              console.error("Store route polyline exception:", pe);
            }
          });

          // Segment 2 (Store -> Customer) - dashed
          getMapplsRoute(middleLat, middleLng, endLat, endLng).then((res2) => {
            try {
              addRouteLayer(mapInstance, `${containerId}-route-segment-2`, res2.polyline, "#94a3b8", true);
            } catch (pe) {
              console.error("Customer route polyline exception:", pe);
            }
          });
        } else {
          // Direct segment (Rider -> Customer)
          getMapplsRoute(startLat, startLng, endLat, endLng).then((res) => {
            try {
              addRouteLayer(mapInstance, `${containerId}-route-direct`, res.polyline, "#4f46e5", false);
            } catch (pe) {
              console.error("Direct segment polyline exception:", pe);
            }
          });
        }
      };

      if (mapInstance.isStyleLoaded()) {
        drawRoutes();
      } else {
        mapInstance.once("load", drawRoutes);
      }

      const bounds = new maptilersdk.LngLatBounds();
      bounds.extend([startLng, startLat]);
      bounds.extend([endLng, endLat]);
      if (middleLng && middleLat) {
        bounds.extend([middleLng, middleLat]);
      }
      mapInstance.fitBounds(bounds, { padding: 50, maxZoom: 15 });
    }
  } catch (overlayErr) {
    console.error("Drawing MapTiler overlays error:", overlayErr);
  }

  (window as any)["overlays_" + containerId] = activeOverlays;
}

function addRouteLayer(map: any, id: string, coordinates: number[][], color: string, dash: boolean = false) {
  const geojsonCoords = coordinates.map(p => [p[1], p[0]]);
  
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  
  map.addSource(id, {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: geojsonCoords
      }
    }
  });
  
  const paintConfig: any = {
    "line-color": color,
    "line-width": 5,
    "line-opacity": 0.85
  };
  
  if (dash) {
    paintConfig["line-dasharray"] = [2, 2];
  }
  
  map.addLayer({
    id: id,
    type: "line",
    source: id,
    layout: {
      "line-join": "round",
      "line-cap": "round"
    },
    paint: paintConfig
  });
}

