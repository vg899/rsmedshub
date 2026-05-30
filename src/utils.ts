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

// Geoapify Geocoding & Maps helpers
const GEOAPIFY_API_KEY = "a2f093c8994441179a2c1599f08f7386";

export interface GeoLocation {
  lat: number;
  lng: number;
  address?: string;
  city?: string;
  district?: string;
  state?: string;
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
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${GEOAPIFY_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Reverse geocode failed");
    const data = await response.json();
    if (data.features && data.features.length > 0) {
      const properties = data.features[0].properties;
      return {
        lat,
        lng,
        address: properties.formatted || properties.name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        city: properties.city || properties.county || properties.suburb || "",
        district: properties.district || properties.county || "",
        state: properties.state || "",
      };
    }
    return { lat, lng };
  } catch (error) {
    console.error("Geoapify reverse geocoding error:", error);
    return { lat, lng };
  }
}

export async function searchAddress(query: string): Promise<any[]> {
  if (!query || query.trim().length < 3) return [];
  try {
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&apiKey=${GEOAPIFY_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Geocoding search failed");
    const data = await response.json();
    return data.features || [];
  } catch (error) {
    console.error("Geoapify Address Search Error:", error);
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

// Map Rendering Image URL (Static map for display)
export function getStaticMapUrl(lat: number, lng: number, zoom: number = 14, width: number = 400, height: number = 250): string {
  return `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=${width}&height=${height}&center=lonlat:${lng},${lat}&zoom=${zoom}&marker=lonlat:${lng},${lat};color:%23ff0000;size:medium&apiKey=${GEOAPIFY_API_KEY}`;
}

export function getRouteMapUrl(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  width: number = 400,
  height: number = 250
): string {
  return `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=${width}&height=${height}&geometry=line:lonlat:${startLng},${startLat},${endLng},${endLat};color:%233b82f6;weight:4&marker=lonlat:${startLng},${startLat};color:%2310b981;size:medium|lonlat:${endLng},${endLat};color:%23ef4444;size:medium&apiKey=${GEOAPIFY_API_KEY}`;
}
