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

// // Mappls REST API & Web Maps Integration Keys
export const MAPPLS_MAP_KEY = "3d8330747c66c6f01c3c680f12d5298d";
export const MAPPLS_CLIENT_ID = "96dHZVzsAut5eW6crFBJRerLd4L_8GLV3wy72csWzFe6rl-64qpQl3owhoO3DU5h2CRClplvfHFvH0jc7_ZadA==";

export interface GeoLocation {
  lat: number;
  lng: number;
  address?: string;
  city?: string;
  district?: string;
  state?: string;
}

let cachedMapplsToken: string | null = null;
let tokenExpiryTime: number = 0;

export async function getMapplsToken(): Promise<string> {
  if (cachedMapplsToken && Date.now() < tokenExpiryTime) {
    return cachedMapplsToken;
  }

  try {
    const res = await fetch("/api/mappls/token");
    if (res.ok) {
      const data = await res.json();
      if (data.access_token) {
        cachedMapplsToken = data.access_token;
        const expiresInSec = data.expires_in || 86399;
        tokenExpiryTime = Date.now() + (expiresInSec - 300) * 1000;
        return cachedMapplsToken!;
      }
    }
  } catch (error) {
    console.warn("Mappls token server error:", error);
  }

  return cachedMapplsToken || MAPPLS_MAP_KEY;
}

export function loadMapplsScript(callback: () => void) {
  if ((window as any).mappls) {
    callback();
    return;
  }

  const existingScript = document.getElementById("mappls-sdk-script");
  if (existingScript) {
    existingScript.addEventListener("load", () => callback());
    return;
  }

  const script = document.createElement("script");
  script.id = "mappls-sdk-script";
  script.src = `https://apis.mappls.com/advancedmaps/api/${MAPPLS_MAP_KEY}/map_sdk?v=3.0&layer=vector`;
  script.async = true;
  script.defer = true;
  script.onload = () => {
    const interval = setInterval(() => {
      if ((window as any).mappls) {
        clearInterval(interval);
        callback();
      }
    }, 50);
  };
  document.head.appendChild(script);
}

export async function getCurrentGPS(): Promise<GeoLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported by your browser", "error");
      reject(new Error("Geolocation unsupported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const detail = await reverseGeocode(latitude, longitude);
          resolve(detail);
        } catch (error) {
          resolve({ lat: latitude, lng: longitude });
        }
      },
      (error) => {
        showToast("GPS position query denied or failed. Please enable location.", "error");
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeoLocation> {
  try {
    const url = `/api/mappls/reverse_geocode?lat=${lat}&lng=${lng}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Mappls Reverse geocode failed");
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      const properties = data.results[0];
      return {
        lat,
        lng,
        address: properties.formatted_address || properties.formattedAddress || properties.address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        city: properties.city || properties.district || properties.sublocality || "Bengaluru",
        district: properties.district || properties.sublocality || "",
        state: properties.state || "Karnataka",
      };
    }
  } catch (error) {
    console.warn("Mappls reverse geocoding error:", error);
  }

  return { lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, city: "Bengaluru", state: "Karnataka" };
}

export async function searchAddress(query: string): Promise<any[]> {
  if (!query || query.trim().length < 3) return [];
  try {
    const url = `/api/mappls/autosuggest?query=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Mappls geocoding search failed");
    const data = await response.json();
    const suggested = data.suggestedLocations || data.results || [];
    return suggested.map((item: any) => ({
      properties: {
        formatted: item.placeAddress || item.placeName || item.formatted_address || item.address || ""
      },
      geometry: {
        coordinates: [
          parseFloat(item.longitude || item.lng || "77.5946"),
          parseFloat(item.latitude || item.lat || "12.9716")
        ]
      }
    }));
  } catch (error) {
    console.warn("Mappls Address Search Error:", error);
    return [];
  }
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

// Map Rendering Image URL (Static map for display using Mappls APIs)
export function getStaticMapUrl(lat: number, lng: number, zoom: number = 14, width: number = 400, height: number = 250): string {
  return `https://apis.mappls.com/advancedmaps/v1/${MAPPLS_MAP_KEY}/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&markers=color:red|${lat},${lng}`;
}

export function getRouteMapUrl(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  width: number = 400,
  height: number = 250
): string {
  return `https://apis.mappls.com/advancedmaps/v1/${MAPPLS_MAP_KEY}/staticmap?size=${width}x${height}&path=color:0x3b82f6|weight:4|${startLat},${startLng}|${endLat},${endLng}&markers=color:green|${startLat},${startLng}|color:red|${endLat},${endLng}`;
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
  try {
    const url = `/api/mappls/route?startLat=${startLat}&startLng=${startLng}&endLat=${endLat}&endLng=${endLng}`;
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
    console.error("Mappls Route API failed, using fallback:", error);
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
  const mappls = (window as any).mappls;
  if (!mappls) {
    console.warn("Mappls JS SDK not loaded yet. Fetching script...");
    loadMapplsScript(() => {
      updateLeafletMap(containerId, startLat, startLng, endLat, endLng, isSingleMarker, startIconClass, startIconAwesome, endIconClass, endIconAwesome, middleLat, middleLng, middleIconClass, middleIconAwesome);
    });
    return;
  }

  const mapContainer = document.getElementById(containerId);
  if (!mapContainer) return;

  // Initialize Map Instance if not present
  let mapInstance = (window as any)["map_" + containerId];
  if (!mapInstance) {
    mapContainer.innerHTML = "";
    try {
      // Mappls expectations on center coordinates: { lat, lng } or MapLibre standard [lng, lat]
      mapInstance = new mappls.Map(containerId, {
        center: { lat: endLat, lng: endLng },
        zoom: 14,
        zoomControl: true,
        attributionControl: false
      });
      (window as any)["map_" + containerId] = mapInstance;
    } catch (e) {
      console.error("Failed to init Mappls map on container:", containerId, e);
      return;
    }
  }

  // Force size adjustments
  setTimeout(() => {
    try {
      if (mapInstance && typeof mapInstance.invalidateSize === "function") {
        mapInstance.invalidateSize();
      }
    } catch (e) {}
  }, 100);

  // Clear previous overlays
  let activeOverlays = (window as any)["overlays_" + containerId] || [];
  activeOverlays.forEach((ol: any) => {
    try {
      if (ol && typeof ol.remove === "function") {
        ol.remove();
      }
    } catch (e) {}
  });
  activeOverlays = [];

  try {
    if (isSingleMarker) {
      // Single Location Map View
      const marker = new mappls.Marker({
        map: mapInstance,
        position: { lat: endLat, lng: endLng },
        html: `<div class="mappls-custom-marker ${endIconClass} w-8.5 h-8.5 rounded-full shadow border-2 border-white flex items-center justify-center bg-teal-500 text-white"><i class="fa-solid ${endIconAwesome} text-xs"></i></div>`
      });
      activeOverlays.push(marker);
      mapInstance.setCenter({ lat: endLat, lng: endLng });
      mapInstance.setZoom(14);
    } else {
      // Dual/Triple Pin Routing Map View
      const riderMarker = new mappls.Marker({
        map: mapInstance,
        position: { lat: startLat, lng: startLng },
        html: `<div class="mappls-custom-marker ${startIconClass} w-8.5 h-8.5 rounded-full shadow border-2 border-white flex items-center justify-center bg-indigo-500 text-white"><i class="fa-solid ${startIconAwesome} text-xs"></i></div>`
      });
      activeOverlays.push(riderMarker);

      const userMarker = new mappls.Marker({
        map: mapInstance,
        position: { lat: endLat, lng: endLng },
        html: `<div class="mappls-custom-marker ${endIconClass} w-8.5 h-8.5 rounded-full shadow border-2 border-white flex items-center justify-center bg-teal-500 text-white"><i class="fa-solid ${endIconAwesome} text-xs"></i></div>`
      });
      activeOverlays.push(userMarker);

      if (middleLat && middleLng) {
        const middleMarker = new mappls.Marker({
          map: mapInstance,
          position: { lat: middleLat, lng: middleLng },
          html: `<div class="mappls-custom-marker ${middleIconClass} w-8.5 h-8.5 rounded-full shadow border-2 border-white flex items-center justify-center bg-amber-500 text-white"><i class="fa-solid ${middleIconAwesome} text-xs"></i></div>`
        });
        activeOverlays.push(middleMarker);

        // Segment 1 (Rider -> Store)
        getMapplsRoute(startLat, startLng, middleLat, middleLng).then((res1) => {
          try {
            const polyline1 = new mappls.Polyline({
              map: mapInstance,
              paths: res1.polyline.map((p: any) => ({ lat: p[0], lng: p[1] })),
              strokeColor: '#3b82f6', // Solid light blue for rider transit to store
              strokeWeight: 5,
              strokeOpacity: 0.95
            });
            activeOverlays.push(polyline1);
          } catch (pe) {
            console.error("Store route polyline exception:", pe);
          }
        });

        // Segment 2 (Store -> Customer) - dashed
        getMapplsRoute(middleLat, middleLng, endLat, endLng).then((res2) => {
          try {
            const polyline2 = new mappls.Polyline({
              map: mapInstance,
              paths: res2.polyline.map((p: any) => ({ lat: p[0], lng: p[1] })),
              strokeColor: '#94a3b8', // Gray dashed representation
              strokeWeight: 4,
              strokeOpacity: 0.8,
              dashArray: '10, 10'
            });
            activeOverlays.push(polyline2);
          } catch (pe) {
            console.error("Customer route polyline exception:", pe);
          }
        });

        const midLat = (startLat + middleLat + endLat) / 3;
        const midLng = (startLng + middleLng + endLng) / 3;
        mapInstance.setCenter({ lat: midLat, lng: midLng });
      } else {
        // Direct segment (Rider -> Customer)
        getMapplsRoute(startLat, startLng, endLat, endLng).then((res) => {
          try {
            const polyline = new mappls.Polyline({
              map: mapInstance,
              paths: res.polyline.map((p: any) => ({ lat: p[0], lng: p[1] })),
              strokeColor: '#4f46e5',
              strokeWeight: 5,
              strokeOpacity: 0.9
            });
            activeOverlays.push(polyline);
          } catch (pe) {
            console.error("Direct segment polyline exception:", pe);
          }
        });

        const midLat = (startLat + endLat) / 2;
        const midLng = (startLng + endLng) / 2;
        mapInstance.setCenter({ lat: midLat, lng: midLng });
      }

      // Adjust Zoom dynamically based on distance
      const dist = calculateDistance(startLat, startLng, endLat, endLng);
      let zoom = 14;
      if (dist > 15) zoom = 10;
      else if (dist > 8) zoom = 11;
      else if (dist > 4) zoom = 12;
      else if (dist > 1.5) zoom = 13;
      else zoom = 14;
      mapInstance.setZoom(zoom);
    }
  } catch (overlayErr) {
    console.error("Drawing Mappls overlays error:", overlayErr);
  }

  (window as any)["overlays_" + containerId] = activeOverlays;
}

