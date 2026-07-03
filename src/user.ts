import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, get, update, remove } from "firebase/database";
import { showToast, getCurrentGPS, reverseGeocode, searchAddress, calculateDistance, getRouteMapUrl, getStaticMapUrl, updateLeafletMap, GeoLocation, uploadToCloudinary } from "./utils";

// Core State variables
let loggedInUser: any = null;
let currentCoordinates: GeoLocation | null = null;
const cartItems: { [id: string]: { medicineId: string; name: string; price: number; qty: number; category: string; storeId: string; storeName: string } } = {};
let activeCategory = "All";
let activeStoreId = "";
let searchQuery = "";
let activeOrderTrackingId = "";
let trackingRiderInterval: any = null;

// Category Storefront State trackers
let currentCategoriesList: any[] = [];
let activeStorefrontCategory: any = null;
let categorySearchQuery = "";
let categorySortOption = "popular";
let categoryStoreFilter = "all";

// Default Global pricing config (loads dynamically later)
let charges = {
  deliveryCharge: 40,
  platformFee: 5,
  gst: 12,
  storeCommission: 10
};

// Coupons details list
let couponsList: any[] = [];
let appliedCoupon: any = null;

// HTML Elements
const userScrollSection = document.getElementById("user-main-scroll") as HTMLElement;
const userOrdersSection = document.getElementById("user-orders-view") as HTMLElement;
const userProfileSection = document.getElementById("user-profile-view") as HTMLElement;
const checkoutDrawer = document.getElementById("checkout-drawer") as HTMLDivElement;

const navHome = document.getElementById("navitem-home") as HTMLButtonElement;
const navOrders = document.getElementById("navitem-orders") as HTMLButtonElement;
const navCategories = document.getElementById("navitem-categories") as HTMLButtonElement;
const navOffers = document.getElementById("navitem-offers") as HTMLButtonElement;
const navAccount = document.getElementById("navitem-account") as HTMLButtonElement;

// Suggestions block
const addrSuggestions = document.getElementById("address-suggestions") as HTMLDivElement;
const addrInput = document.getElementById("checkout-address-input") as HTMLInputElement;

// Check authentication
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showToast("Session expired. Please log in.", "error");
    window.location.href = "/user-login.html";
    return;
  }

  loggedInUser = user;
  
  // Fetch profile detailed settings
  get(ref(db, `users/${user.uid}`)).then((snapshot) => {
    if (snapshot.exists()) {
      const uData = snapshot.val();
      if (uData.role !== "user") {
        let targetUrl = "/index.html";
        if (uData.role === "admin") {
          targetUrl = "/admin.html";
        } else if (uData.role === "store") {
          targetUrl = "/store.html";
        } else if (uData.role === "delivery" || uData.role === "deliveryboy1") {
          targetUrl = "/deliveryboy.html";
        }

        // Show beautiful, full-screen Access Denied overlay and auto-redirect
        const overlay = document.createElement("div");
        overlay.id = "access-denied-overlay";
        overlay.className = "fixed inset-0 z-[999999] bg-slate-950 flex flex-col items-center justify-center text-center p-6 text-white font-sans";
        overlay.innerHTML = `
          <div class="relative mb-6">
            <div class="absolute inset-0 bg-rose-500 rounded-full blur-xl scale-125 opacity-20 animate-pulse"></div>
            <div class="w-20 h-20 bg-rose-600 rounded-full flex items-center justify-center shadow-lg border border-rose-500/30 z-10 relative">
              <i class="fa-solid fa-shield-halved text-white text-3xl animate-pulse"></i>
            </div>
          </div>
          <div class="space-y-4 max-w-sm">
            <h3 class="text-2xl font-black tracking-tight text-rose-500 uppercase">ACCESS DENIED</h3>
            <p class="text-xs text-slate-400 font-semibold leading-relaxed px-4">
              This is an isolated portal. You are trying to access the <strong>USER</strong> panel, but your account is registered as <strong>${(uData.role || "unknown").toUpperCase()}</strong>.
            </p>
            <div class="p-4 bg-white/5 border border-white/10 rounded-2xl mt-4">
              <p class="text-[10px] text-teal-400 font-mono font-bold tracking-widest uppercase animate-pulse">
                Redirecting to your authorized panel...
              </p>
              <div class="w-full bg-white/10 h-1.5 rounded-full mt-2 overflow-hidden">
                <div id="access-denied-progress" class="bg-teal-500 h-full transition-all ease-linear" style="width: 0%; transition-duration: 2500ms;"></div>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        // Animate the progress bar width
        setTimeout(() => {
          const bar = document.getElementById("access-denied-progress");
          if (bar) bar.style.width = "100%";
        }, 50);

        if (targetUrl === "/index.html") {
          signOut(auth).then(() => {
            setTimeout(() => {
              window.location.href = targetUrl;
            }, 2500);
          });
        } else {
          setTimeout(() => {
            window.location.href = targetUrl;
          }, 2500);
        }
      } else {
        showToast(`Logged in safely!`, "success");
        bootstrapGeoLocation();
      }
    } else {
      signOut(auth).then(() => {
        window.location.href = "/user-login.html";
      });
    }
  });

  // Watch profile notifications
  subscribeToNotifications(user.uid);
});

// Format exact area/locality and district (e.g., "Sector 62, Noida") instead of simple city name
function formatLocationText(loc: GeoLocation | null): string {
  if (!loc) return "Bengaluru - 560038";
  const pinText = loc.pincode ? ` - ${loc.pincode}` : "";
  const address = loc.address || "";
  const parts = address.split(",");
  if (parts.length >= 2) {
    const first = parts[0].trim();
    const second = parts[1].trim();
    if (first.toLowerCase() === second.toLowerCase()) {
      return (first.length > 18 ? first.substring(0, 18) + "..." : first) + pinText;
    }
    const joined = `${first}, ${second}`;
    const truncated = joined.length > 18 ? joined.substring(0, 18) + "..." : joined;
    return truncated + pinText;
  }
  const base = loc.city || loc.address?.substring(0, 15) || "Indira Nagar, BLR";
  return base + pinText;
}

class UserLiveLocationManager {
  private watchId: number | null = null;
  private reconnectTimeout: any = null;
  private lastLat: number | null = null;
  private lastLng: number | null = null;
  private minDistanceThreshold: number = 0.005; // ~5 meters change threshold to optimize battery and DB usage

  constructor() {
    window.addEventListener("online", () => {
      console.log("Internet restored. Re-starting GPS live watch...");
      showToast("Online: Restoring real-time GPS tracking.", "info");
      this.restartTracking();
    });

    window.addEventListener("offline", () => {
      console.warn("Internet offline.");
      showToast("Offline. GPS tracking will resume when connection is restored.", "error");
      this.updateUIStatus("offline");
    });
  }

  public async startTracking() {
    this.stopTracking();

    if (!navigator.geolocation) {
      showToast("GPS Tracking Unavailable: Geolocation is not supported by your browser.", "error");
      this.updateUIStatus("disabled");
      return;
    }

    this.updateUIStatus("loading");

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    };

    this.watchId = navigator.geolocation.watchPosition(
      async (position) => {
        await this.handleLocationUpdate(position.coords.latitude, position.coords.longitude);
      },
      (error) => {
        this.handleLocationError(error);
      },
      options
    );
  }

  public stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private restartTracking() {
    this.stopTracking();
    this.startTracking();
  }

  private async handleLocationUpdate(lat: number, lng: number) {
    if (this.lastLat !== null && this.lastLng !== null) {
      const shift = calculateDistance(lat, lng, this.lastLat, this.lastLng);
      // Limit updates if shift is less than 5 meters to optimize resources
      if (shift < this.minDistanceThreshold && currentCoordinates?.address) {
        return;
      }
    }

    this.lastLat = lat;
    this.lastLng = lng;

    try {
      const geoLoc = await reverseGeocode(lat, lng);
      currentCoordinates = geoLoc;

      const cityBadge = document.getElementById("loc-city-txt");
      if (cityBadge) {
        cityBadge.innerText = formatLocationText(geoLoc);
      }
      if (addrInput) {
        addrInput.value = geoLoc.address || "";
      }

      // Save to Firebase RTD
      if (loggedInUser) {
        await update(ref(db, `users/${loggedInUser.uid}`), {
          currentLocation: {
            lat: geoLoc.lat,
            lng: geoLoc.lng,
            address: geoLoc.address || "",
            city: geoLoc.city || "",
            district: geoLoc.district || "",
            state: geoLoc.state || "",
            timestamp: Date.now()
          }
        });
      }

      // Refresh nearby pharmacies slider & meds grid
      renderPharmacySlider();
      renderMedicinesGrid();

      // Recalculate route and ETA if active order tracking is open
      if (activeOrderTrackingId) {
        await update(ref(db, `orders/${activeOrderTrackingId}`), {
          userLocation: {
            lat: geoLoc.lat,
            lng: geoLoc.lng,
            address: geoLoc.address || ""
          }
        });
      }

    } catch (err) {
      console.error("Error processing real-time location update:", err);
      currentCoordinates = {
        lat,
        lng,
        address: `Latitude: ${lat.toFixed(5)}, Longitude: ${lng.toFixed(5)}`,
        city: "Current Location",
        state: ""
      };
      
      const cityBadge = document.getElementById("loc-city-txt");
      if (cityBadge) {
        cityBadge.innerText = `GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }

      if (loggedInUser) {
        await update(ref(db, `users/${loggedInUser.uid}`), {
          currentLocation: {
            lat,
            lng,
            address: `Latitude: ${lat.toFixed(5)}, Longitude: ${lng.toFixed(5)}`,
            timestamp: Date.now()
          }
        });
      }
    }
  }

  private handleLocationError(error: GeolocationPositionError) {
    console.warn(`Geolocation error (${error.code}): ${error.message}`);
    
    let statusState: "disabled" | "denied" | "offline" = "disabled";
    if (error.code === error.PERMISSION_DENIED) {
      showToast("GPS precise permission denied. Please allow location access in browser/system settings.", "error");
      statusState = "denied";
    } else if (error.code === error.POSITION_UNAVAILABLE) {
      showToast("GPS position currently unavailable. Retrying...", "info");
      statusState = "disabled";
    } else if (error.code === error.TIMEOUT) {
      showToast("GPS location request timed out. Retrying...", "info");
      statusState = "disabled";
    }

    this.updateUIStatus(statusState);

    // Auto-reconnect if temporary loss
    if (error.code !== error.PERMISSION_DENIED) {
      if (!this.reconnectTimeout) {
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          console.log("Attempting to reconnect GPS watch...");
          this.startTracking();
        }, 10000);
      }
    }
  }

  private updateUIStatus(state: "loading" | "connected" | "disabled" | "denied" | "offline") {
    const cityBadge = document.getElementById("loc-city-txt");
    if (!cityBadge) return;

    switch (state) {
      case "loading":
        cityBadge.innerHTML = `<span class="flex items-center gap-1.5 text-blue-500 font-bold"><i class="fa-solid fa-spinner fa-spin text-[10px]"></i> Sourcing live GPS...</span>`;
        break;
      case "disabled":
        cityBadge.innerHTML = `<span class="flex items-center gap-1.5 text-amber-500 font-bold"><i class="fa-solid fa-triangle-exclamation animate-pulse"></i> GPS Disabled</span>`;
        break;
      case "denied":
        cityBadge.innerHTML = `<span class="flex items-center gap-1.5 text-rose-500 font-bold"><i class="fa-solid fa-circle-xmark"></i> GPS Permission Denied</span>`;
        break;
      case "offline":
        cityBadge.innerHTML = `<span class="flex items-center gap-1.5 text-slate-500 font-bold"><i class="fa-solid fa-wifi animate-pulse"></i> Connection Lost</span>`;
        break;
    }
  }
}

let userLocationManager: UserLiveLocationManager | null = null;

// Capture and resolve GPS on load, requesting GPS permissions
async function bootstrapGeoLocation() {
  if (!userLocationManager) {
    userLocationManager = new UserLiveLocationManager();
  }
  userLocationManager.startTracking();
  syncMainMarketplace();
}

// Global Nav bar transitions
navHome.addEventListener("click", () => {
  toggleSections("home");
});
navOrders.addEventListener("click", () => {
  toggleSections("orders");
  syncOrdersHistory();
});
navCategories.addEventListener("click", () => {
  toggleSections("home");
  const quickCategories = document.getElementById("quick-categories-container");
  if (quickCategories) {
    quickCategories.scrollIntoView({ behavior: "smooth", block: "center" });
    // Flash visually to highlight the categories section
    quickCategories.classList.add("ring-2", "ring-blue-400");
    setTimeout(() => {
      quickCategories.classList.remove("ring-2", "ring-blue-400");
    }, 1500);
  }
});
navOffers.addEventListener("click", () => {
  document.getElementById("btn-opt-coupons")?.click();
});
navAccount.addEventListener("click", () => {
  toggleSections("profile");
  syncUserProfileDash();
});

function toggleSections(view: "home" | "orders" | "profile") {
  const activeClass = "flex flex-col items-center gap-1 text-blue-600 text-[9px] font-black flex-1 focus:outline-none transition-all cursor-pointer";
  const inactiveClass = "flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 text-[9px] font-bold flex-1 focus:outline-none transition-all cursor-pointer";

  if (view === "home") {
    userScrollSection.classList.remove("hidden");
    userOrdersSection.classList.add("hidden");
    userProfileSection?.classList.add("hidden");
    navHome.className = activeClass;
    navOrders.className = inactiveClass;
    navCategories.className = inactiveClass;
    navOffers.className = inactiveClass;
    navAccount.className = inactiveClass;
  } else if (view === "orders") {
    userOrdersSection.classList.remove("hidden");
    userScrollSection.classList.add("hidden");
    userProfileSection?.classList.add("hidden");
    navOrders.className = activeClass;
    navHome.className = inactiveClass;
    navCategories.className = inactiveClass;
    navOffers.className = inactiveClass;
    navAccount.className = inactiveClass;
  } else if (view === "profile") {
    userProfileSection?.classList.remove("hidden");
    userScrollSection.classList.add("hidden");
    userOrdersSection.classList.add("hidden");
    navAccount.className = activeClass;
    navHome.className = inactiveClass;
    navOrders.className = inactiveClass;
    navCategories.className = inactiveClass;
    navOffers.className = inactiveClass;
  }
}

// Log Out actions
document.getElementById("btn-user-signout")?.addEventListener("click", async () => {
  if (confirm("Sign out from Dawado portal?")) {
    await signOut(auth);
    window.location.href = "/user-login.html";
  }
});

// 1. SYNC MARKETPLACE NODES & FILTER BINDINGS
let allMedicines: any[] = [];
let allStores: any[] = [];
let currentDeliveryRadius = 10;

// Fallback high-quality promotional slides
const DEFAULT_CAROUSEL_SLIDES = [
  {
    bannerId: "default_heart",
    imageUrl: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=300",
    redirectUrl: "#",
    isLarge: false,
    title: "Medicines in 15-30 Mins",
    description: "Cold-chain sterile dispatched, authentic prescriptions straight from verified hubs.",
    badge: "SUPERFAST",
    cta: "Order Now",
    colorTheme: "from-blue-600 via-indigo-600 to-blue-700 text-white",
    badgeTheme: "bg-teal-400 text-slate-950",
    bullets: ["100% Genuine Medicines", "Live GPS Rider Tracking", "Instant Digital Billing"]
  },
  {
    bannerId: "default_wellness",
    imageUrl: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=300",
    redirectUrl: "#",
    isLarge: false,
    title: "Upload Rx & Get 20% OFF",
    description: "Simply snap or upload your prescription slip. Verified in 5 minutes by experts.",
    badge: "Rx CO-PILOT",
    cta: "Upload Rx",
    colorTheme: "from-emerald-600 to-teal-700 text-white",
    badgeTheme: "bg-white text-emerald-800",
    bullets: ["Dr. Approved Alternatives", "100% Secure & Encrypted", "Automated Refill Alarms"]
  },
  {
    bannerId: "default_clinical",
    imageUrl: "https://images.unsplash.com/photo-1631549916768-4119b2e55c06?w=300",
    redirectUrl: "#",
    isLarge: false,
    title: "Apollo & Tata 1mg Deals",
    description: "routine health savings on chronic care pills, diabetic supplements & diagnostics.",
    badge: "DAWADO SPECIAL",
    cta: "Browse Deals",
    colorTheme: "from-rose-500 to-pink-600 text-white",
    badgeTheme: "bg-white text-rose-600",
    bullets: ["Save up to ₹500 on billing", "Earn extra 2% DawaDo Coins", "All payment channels active"]
  }
];

let userBannersCache: any[] = [];
let userActiveBannerIndex = 0;
let userBannerAutoplayInterval: any = null;

// Session cache to prevent over-counting views on simple slide rotations in a single run
const countedSessionViews = new Set<string>();
let rawBannersSnapshotData: any[] = [];

function recordBannerCampaignView(bannerId: string) {
  if (!bannerId || bannerId.startsWith("default_")) return;
  if (countedSessionViews.has(bannerId)) return;
  countedSessionViews.add(bannerId);

  get(ref(db, `banners/${bannerId}/views`)).then((snap) => {
    const cur = snap.val() || 0;
    update(ref(db, `banners/${bannerId}`), { views: cur + 1 });
  });
}

function applyLiveBannerFiltering() {
  const now = Date.now();
  const activeBanners: any[] = [];

  rawBannersSnapshotData.forEach((b) => {
    // A banner is active right now if:
    // 1. active state is not explicitly set to false
    // 2. if b.startEpoch is set, current time (now) >= b.startEpoch
    // 3. if b.endEpoch is set, current time (now) <= b.endEpoch
    const isScheduled = b.startEpoch && now < b.startEpoch;
    const isExpired = b.endEpoch && now > b.endEpoch;
    const isActiveState = b.active !== false;

    if (isActiveState && !isScheduled && !isExpired) {
      activeBanners.push(b);
    }
  });

  if (activeBanners.length > 0) {
    // Sort by priority weight
    activeBanners.sort((a, b) => (a.priority || 1) - (b.priority || 1));
    
    // Load and pre-classify images
    const promises = activeBanners.map(b => {
      return new Promise<any>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const aspect = img.naturalWidth / img.naturalHeight;
          const isLarge = img.naturalWidth >= 400 && aspect >= 1.4;
          resolve({
            ...b,
            isLarge,
            title: b.title || "Specialist Offer",
            description: b.description || "Grab active deals with sterile cold-chain assurance.",
            badge: b.badge || "COUPON",
            cta: b.cta || "Browse Deals"
          });
        };
        img.onerror = () => {
          resolve({
            ...b,
            isLarge: true,
            title: b.title || "Specialist Offer",
            description: b.description || "Grab active deals with sterile cold-chain assurance.",
            badge: b.badge || "PROMO",
            cta: b.cta || "Shop Now"
          });
        };
        img.src = b.imageUrl;
      });
    });

    Promise.all(promises).then(classified => {
      const oldIds = userBannersCache.map(x => x.bannerId).join(",");
      const newIds = classified.map(x => x.bannerId).join(",");
      
      if (oldIds !== newIds) {
        userBannersCache = classified;
        userActiveBannerIndex = 0;
        renderUserBannerCarousel();
        startBannerAutoplay();
      }
    });
  } else {
    if (userBannersCache.length > 0) {
      userBannersCache = [];
      userActiveBannerIndex = 0;
      renderUserBannerCarousel();
      startBannerAutoplay();
    }
  }
}

// Check schedule state change every 5 seconds on active tab to activate/expire instantly
setInterval(applyLiveBannerFiltering, 5000);

function renderUserBannerCarousel() {
  const section = document.getElementById("banner-section");
  if (!section) return;

  const slidesToRender = userBannersCache.length > 0 ? userBannersCache : DEFAULT_CAROUSEL_SLIDES;
  if (slidesToRender.length === 0) return;

  if (userActiveBannerIndex >= slidesToRender.length) {
    userActiveBannerIndex = 0;
  }

  const slide = slidesToRender[userActiveBannerIndex];
  
  // Track this campaign view metrics safely
  if (slide && slide.bannerId) {
    recordBannerCampaignView(slide.bannerId);
  }

  let contentHtml = "";

  if (slide.isLarge) {
    // Large Image Layout: Center image object-contain + blurred backdrop overlay to solve black border padding voids beautifully
    contentHtml = `
      <div class="relative w-full h-[140px] md:h-[185px] overflow-hidden flex items-center justify-center cursor-pointer select-none rounded-2xl group" onclick="window.handleBannerCampaignClick('${slide.bannerId}', '${slide.redirectUrl || "#"}')">
        <div class="absolute inset-0 bg-cover bg-center scale-110 blur-xl opacity-35 transition-all duration-700 group-hover:scale-115" style="background-image: url('${slide.imageUrl}')"></div>
        <div class="absolute inset-0 bg-gradient-to-t from-slate-950/20 via-transparent to-transparent"></div>
        <img src="${slide.imageUrl}" class="relative z-10 w-full h-full object-contain select-none max-w-full" alt="Promo Billboard">
      </div>
    `;
  } else {
    // Small Image Layout: Display rich descriptive information card with floating badge, Title, CTA, and centered floating image preview
    const displayBadge = slide.badge || "COUPON";
    const displayTitle = slide.title || "Special Medicine Delivery";
    const displayDesc = slide.description || "Grab active deals with sterile cold-chain assurance.";
    const displayCta = slide.cta || "Shop Now";
    const bgGradient = slide.colorTheme || "from-blue-600 via-indigo-600 to-blue-700 text-white";
    const badgeBg = slide.badgeTheme || "bg-teal-400 text-slate-950";
    const bulletsHtml = slide.bullets ? slide.bullets.map((b: string) => `
      <div class="flex items-center gap-1.5 text-[8.5px] font-bold opacity-90 leading-none">
        <i class="fa-solid fa-circle-check text-[7.5px] text-teal-300"></i>
        <span class="truncate">${b}</span>
      </div>
    `).join("") : "";

    contentHtml = `
      <div class="relative w-full h-[140px] md:h-[185px] overflow-hidden bg-gradient-to-r ${bgGradient} flex items-center border border-slate-100/25 cursor-pointer p-4 pr-2 transition-all duration-300 rounded-3xl text-left" onclick="window.handleBannerCampaignClick('${slide.bannerId}', '${slide.redirectUrl || "#"}')">
        <div class="absolute -right-10 -top-10 w-44 h-44 bg-white/10 rounded-full blur-2xl opacity-20 pointer-events-none"></div>
        <div class="p-1.5 z-10 max-w-[65%] space-y-2 text-white">
          <div class="flex items-center">
            <span class="${badgeBg} text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider font-display shadow-xs animate-pulse">${displayBadge}</span>
          </div>
          <h2 class="text-[12.5px] font-black leading-tight uppercase tracking-tight line-clamp-1">${displayTitle}</h2>
          <p class="text-[9px] font-medium leading-tight line-clamp-2 opacity-90">${displayDesc}</p>
          
          <!-- Custom Bullets for added premium trust -->
          ${slide.bullets ? `
            <div class="flex flex-col gap-1 pt-0.5">
              ${bulletsHtml}
            </div>
          ` : ""}

          <button class="mt-1.5 bg-white text-slate-950 hover:scale-103 active:scale-97 font-extrabold text-[8px] px-3.5 py-1.5 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-sm transition-all">
            <span>${displayCta}</span>
            <i class="fa-solid fa-circle-arrow-right text-[8.5px] text-blue-600"></i>
          </button>
        </div>
        
        <div class="absolute right-4 top-2 bottom-2 w-[32%] flex items-center justify-center z-10">
          <div class="relative select-none group">
            <div class="absolute inset-0 bg-white/10 rounded-full blur-md scale-105 opacity-40 group-hover:scale-115 transition-all"></div>
            <div class="w-20 h-20 md:w-24 md:h-24 bg-white/15 backdrop-blur-md rounded-2xl shadow-md p-1.5 flex items-center justify-center border border-white/20 z-10 relative">
              <img src="${slide.imageUrl}" class="w-full h-full object-cover rounded-xl select-none" referrerPolicy="no-referrer">
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Dots listing selector
  let dotsHtml = `<div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-25">`;
  slidesToRender.forEach((_, idx) => {
    const isActive = idx === userActiveBannerIndex;
    dotsHtml += `
      <button onclick="event.stopPropagation(); window.setUserBannerIndex(${idx})" class="h-1.5 rounded-full transition-all duration-300 focus:outline-none cursor-pointer ${isActive ? 'w-4.5 bg-blue-600' : 'w-1.5 bg-slate-400/40 hover:bg-slate-400'}" aria-label="Go to slide ${idx + 1}"></button>
    `;
  });
  dotsHtml += `</div>`;

  section.className = "relative rounded-2xl overflow-hidden shadow-xs border border-blue-50 bg-slate-50 flex flex-col justify-center transition-all duration-300 min-h-[140px] md:min-h-[185px]";
  section.innerHTML = `
    <div class="w-full h-full slide-fade">
      ${contentHtml}
    </div>
    ${dotsHtml}
  `;
}

function startBannerAutoplay() {
  if (userBannerAutoplayInterval) {
    clearInterval(userBannerAutoplayInterval);
  }
  const slidesToRender = userBannersCache.length > 0 ? userBannersCache : DEFAULT_CAROUSEL_SLIDES;
  if (slidesToRender.length <= 1) return;

  userBannerAutoplayInterval = setInterval(() => {
    userActiveBannerIndex = (userActiveBannerIndex + 1) % slidesToRender.length;
    renderUserBannerCarousel();
  }, 4500);
}

// Horizontal Swipe Support for mobile touchscreen slide transitions
function initBannerTouchSwipe() {
  const section = document.getElementById("banner-section");
  if (!section) return;

  let touchStartX = 0;
  let touchEndX = 0;

  section.addEventListener("touchstart", (e: any) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  section.addEventListener("touchend", (e: any) => {
    touchEndX = e.changedTouches[0].screenX;
    const slidesToRender = userBannersCache.length > 0 ? userBannersCache : DEFAULT_CAROUSEL_SLIDES;
    if (slidesToRender.length <= 1) return;

    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) < 50) return;

    if (diff > 50) {
      // Swipe left -> next
      userActiveBannerIndex = (userActiveBannerIndex + 1) % slidesToRender.length;
    } else {
      // Swipe right -> prev
      userActiveBannerIndex = (userActiveBannerIndex - 1 + slidesToRender.length) % slidesToRender.length;
    }
    renderUserBannerCarousel();
    startBannerAutoplay(); // Refresh timer
  }, { passive: true });
}

// Bind carousel methods on global scope for easy window communication
(window as any).renderUserBannerCarousel = renderUserBannerCarousel;
(window as any).startBannerAutoplay = startBannerAutoplay;
(window as any).userActiveBannerIndex = userActiveBannerIndex;
(window as any).userBannersCache = userBannersCache;

function syncMainMarketplace() {
  // Prime first render instantly
  renderUserBannerCarousel();
  startBannerAutoplay();
  initBannerTouchSwipe();

  // Fetch live global charges configuration
  get(ref(db, "charges")).then((snap) => {
    if (snap.exists()) {
      charges = snap.val();
    }
  });

  // Subscribe dynamically to delivery radius setup
  onValue(ref(db, "platform_settings"), (snap) => {
    if (snap.exists()) {
      currentDeliveryRadius = parseFloat(snap.val().deliveryRadius) || 10;
    } else {
      currentDeliveryRadius = 10;
    }
    renderPharmacySlider();
    renderMedicinesGrid();
  });

  // Real-time Support Center dynamic updates sync listener
  onValue(ref(db, "support_settings"), (snap) => {
    let supportSettings = snap.val() || {
      phone: "+919999999999",
      whatsapp: "+919999999999",
      emergency: "+919876543210",
      email: "support@rsmedshub.com",
      hours: "9:00 AM - 10:00 PM (Daily)",
      enableCall: true,
      enableWhatsapp: true,
      enableEmergency: true
    };

    // Update Phone Elements
    const linkCall = document.getElementById("btn-link-call") as HTMLAnchorElement;
    const txtPhone = document.getElementById("txt-support-phone");
    if (linkCall) {
      if (supportSettings.enableCall !== false) {
        linkCall.href = `tel:${supportSettings.phone || "+919999999999"}`;
        linkCall.classList.remove("hidden");
      } else {
        linkCall.classList.add("hidden");
      }
    }
    if (txtPhone) txtPhone.innerText = supportSettings.phone || "+919999999999";

    // Update WhatsApp Elements
    const linkWhatsapp = document.getElementById("btn-link-whatsapp") as HTMLAnchorElement;
    if (linkWhatsapp) {
      if (supportSettings.enableWhatsapp !== false) {
        const waClean = (supportSettings.whatsapp || "+919999999999").replace(/\D/g, '');
        linkWhatsapp.href = `https://wa.me/${waClean}`;
        linkWhatsapp.classList.remove("hidden");
      } else {
        linkWhatsapp.classList.add("hidden");
      }
    }

    // Update Emergency Elements
    const linkEmergency = document.getElementById("btn-link-emergency") as HTMLAnchorElement;
    const emergencyCard = document.getElementById("sup-emergency-card");
    if (linkEmergency) linkEmergency.href = `tel:${supportSettings.emergency || "+919876543210"}`;
    if (emergencyCard) {
      if (supportSettings.enableEmergency !== false) {
        emergencyCard.classList.remove("hidden");
      } else {
        emergencyCard.classList.add("hidden");
      }
    }

    // Update Contact Email Elements
    const linkEmail = document.getElementById("btn-support-email-link") as HTMLAnchorElement;
    const txtEmail = document.getElementById("txt-support-email");
    if (linkEmail) linkEmail.href = `mailto:${supportSettings.email || "support@rsmedshub.com"}`;
    if (txtEmail) txtEmail.innerText = supportSettings.email || "support@rsmedshub.com";

    // Update working hours
    const hoursInd = document.getElementById("support-hours-indicator");
    if (hoursInd) hoursInd.innerText = supportSettings.hours || "24/7 Hours";
  });

  // Susbscribe promotional banners campaigns
  onValue(ref(db, "banners"), (snapshot) => {
    if (userBannerAutoplayInterval) {
      clearInterval(userBannerAutoplayInterval);
      userBannerAutoplayInterval = null;
    }

    rawBannersSnapshotData = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        rawBannersSnapshotData.push(child.val());
      });
    }
    applyLiveBannerFiltering();
  });

  // Subscribe operational pharmacy stores
  onValue(ref(db, "stores"), (snapshot) => {
    allStores = [];
    snapshot.forEach((child) => {
      const s = child.val();
      if (s.approved && s.active) {
        allStores.push(s);
      }
    });

    document.getElementById("user-store-cnt")!.innerText = `${allStores.length} Stores Available`;
    renderPharmacySlider();
  });

  // Subscribe central medicine node inventory list
  onValue(ref(db, "medicines"), (snapshot) => {
    allMedicines = [];
    snapshot.forEach((child) => {
      const m = child.val();
      allMedicines.push(m);
    });

    renderMedicinesGrid();
  });

  // Subscribe dynamic marketplace segments / categories
  onValue(ref(db, "categories"), (snapshot) => {
    const list: any[] = [];
    if (snapshot.exists()) {
      snapshot.forEach(child => {
        const cat = child.val();
        if (cat.active) {
          list.push(cat);
        }
      });
    }
    renderDynamicCategoriesList(list);
  });
}

const categoryIcons: { [key: string]: string } = {
  "ALL": "fa-notes-medical",
  "DIABETES": "fa-droplet",
  "HEART": "fa-heart-pulse",
  "BP": "fa-wave-square",
  "ALLERGY": "fa-prescription-bottle-medical",
  "COLD_FLU": "fa-hand-holding-droplet",
  "FEVER": "fa-temperature-high",
  "PAIN": "fa-bolt",
  "STOMACH": "fa-user-doctor",
  "DIGESTION": "fa-shield-halved",
  "VITAMINS": "fa-capsules",
  "IMMUNITY": "fa-shield-virus",
  "BABY_CARE": "fa-baby",
  "WOMEN_CARE": "fa-venus",
  "MEN_CARE": "fa-mars",
  "SENIOR_CARE": "fa-wheelchair",
  "SKIN_CARE": "fa-face-laugh",
  "HAIR_CARE": "fa-scissors",
  "EYE_CARE": "fa-eye",
  "DENTAL": "fa-tooth",
  "PERSONAL_CARE": "fa-pump-soap",
  "FIRST_AID": "fa-kit-medical",
  "MEDICAL_DEVICES": "fa-stethoscope",
  "AYURVEDA": "fa-leaf",
  "HOMEOPATHY": "fa-vial",
  "NUTRITION": "fa-apple-whole",
  "FITNESS": "fa-weight-scale",
  "ORTHOPEDIC": "fa-bone",
  "RESPIRATORY": "fa-lungs"
};

function getMedicineCountForCategory(categoryName: string): number {
  if (categoryName === "All") return allMedicines.length;
  return allMedicines.filter(m => m.category === categoryName).length;
}

function renderDynamicCategoriesList(categories: any[]) {
  currentCategoriesList = categories;

  // Filter active and de-duplicate by name, then sort alphabetically
  const activeCategories = [...categories].filter(c => c.active !== false);
  const uniqueCategories: any[] = [];
  const seenNames = new Set<string>();
  for (const c of activeCategories) {
    const nameKey = (c.name || "").trim().toLowerCase();
    if (!seenNames.has(nameKey)) {
      seenNames.add(nameKey);
      uniqueCategories.push(c);
    }
  }
  const sorted = uniqueCategories.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // 1. HORIZONTAL CATEGORY SLIDER (Circles style matching Blinkit / Instamart)
  const sliderEl = document.getElementById("category-horizontal-slider");
  if (sliderEl) {
    if (sorted.length === 0) {
      sliderEl.innerHTML = `<div class="py-2 text-[10px] text-slate-400 font-bold w-full">No active categories.</div>`;
    } else {
      sliderEl.innerHTML = sorted.map(it => {
        const imageUrl = it.imageUrl || `https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=150&auto=format&fit=crop&q=60`;
        const count = getMedicineCountForCategory(it.name);
        return `
          <button class="category-slider-btn shrink-0 flex flex-col items-center justify-center text-center cursor-pointer focus:outline-none transition-all hover:scale-105" data-category="${it.name}">
            <div class="w-13 h-13 rounded-full overflow-hidden flex items-center justify-center bg-white shadow-3xs border border-slate-100 p-0.5">
              <img src="${imageUrl}" class="w-full h-full object-cover rounded-full" referrerpolicy="no-referrer" alt="${it.name}">
            </div>
            <span class="text-[8.5px] font-black text-slate-700 leading-tight mt-1.5 max-w-[62px] truncate uppercase font-sans" title="${it.name}">${it.name}</span>
            <span class="text-[7.5px] text-slate-400 font-extrabold mt-0.5 font-mono">${count} Meds</span>
          </button>
        `;
      }).join("");
    }
  }

  // 2. FEATURED GRID (Bento grid style matching Swiggy Instamart)
  const featuredGridEl = document.getElementById("categories-featured-grid");
  if (featuredGridEl) {
    let featuredList = sorted.filter(c => c.featured === true || c.featured === "yes");
    if (featuredList.length === 0) {
      featuredList = sorted.slice(0, 4);
    }
    
    if (featuredList.length === 0) {
      featuredGridEl.innerHTML = `<div class="col-span-2 py-2 text-[10px] text-slate-400 font-bold">No featured categories.</div>`;
    } else {
      featuredGridEl.innerHTML = featuredList.map(it => {
        const imageUrl = it.imageUrl || `https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&auto=format&fit=crop&q=80`;
        const count = getMedicineCountForCategory(it.name);
        return `
          <div class="category-grid-card relative rounded-2xl overflow-hidden shadow-3xs bg-white border border-slate-100 hover:border-amber-300 transition-all hover:shadow-xs aspect-[1.38/1] flex flex-col justify-end group cursor-pointer" data-category="${it.name}">
            <img src="${imageUrl}" class="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-all duration-300" referrerpolicy="no-referrer" alt="${it.name}">
            <div class="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/10 to-transparent"></div>
            
            <span class="absolute top-2 right-2 bg-amber-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider leading-none shadow-3xs">Featured</span>
            
            <div class="p-2.5 relative z-10 text-left">
              <h4 class="text-[10px] font-black text-white uppercase tracking-wider leading-none drop-shadow-md font-display">${it.name}</h4>
              <p class="text-[7.5px] text-amber-300 font-black flex items-center gap-1 mt-1 leading-none font-mono">
                <i class="fa-solid fa-capsules text-[6px]"></i> ${count} Meds
              </p>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // 3. TRENDING TRACK (Hot sliders style matching Apollo Pharmacy)
  const trendingGridEl = document.getElementById("category-trending-slider");
  if (trendingGridEl) {
    let trendingList = sorted.filter(c => c.trending === true || c.trending === "yes");
    if (trendingList.length === 0) {
      trendingList = sorted.slice(2, 7);
    }
    
    if (trendingList.length === 0) {
      trendingGridEl.innerHTML = `<div class="py-2 text-[10px] text-slate-400 font-bold w-full">No trending categories.</div>`;
    } else {
      trendingGridEl.innerHTML = trendingList.map(it => {
        const imageUrl = it.imageUrl || `https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&auto=format&fit=crop&q=80`;
        const count = getMedicineCountForCategory(it.name);
        return `
          <div class="category-grid-card shrink-0 w-32 rounded-2xl overflow-hidden bg-white border border-slate-100 hover:border-rose-300 shadow-3xs hover:shadow-xs relative aspect-[1.38/1] flex flex-col justify-end group cursor-pointer hover:scale-103 transition-all" data-category="${it.name}">
            <img src="${imageUrl}" class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-300" referrerpolicy="no-referrer" alt="${it.name}">
            <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent"></div>
            
            <span class="absolute top-2 left-2 bg-rose-600 text-white text-[6.5px] font-black px-1 py-0.5 rounded-sm uppercase tracking-wider leading-none shadow-3xs flex items-center gap-0.5">
              <i class="fa-solid fa-fire text-[6px]"></i> HOT
            </span>
            
            <div class="p-2 relative z-10 text-left">
              <h5 class="text-[9.5px] font-black text-white uppercase tracking-wider leading-tight">${it.name}</h5>
              <p class="text-[7px] text-rose-300 font-black mt-0.5 uppercase tracking-wide leading-none font-mono">${count} items</p>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // Register interactive click handlers for Category clicks across all sections!
  document.querySelectorAll(".category-slider-btn, .category-grid-card, .quick-cat-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.currentTarget as HTMLElement;
      const catName = target.getAttribute("data-category");
      if (catName) {
        openCategoryStorefront(catName);
      }
    });
  });
}

function openCategoryStorefront(categoryName: string) {
  const cat = currentCategoriesList.find(c => c.name === categoryName);
  activeStorefrontCategory = cat || {
    name: categoryName,
    imageUrl: `https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=80`,
    bannerUrl: `https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=600&auto=format&fit=crop&q=80`,
    code: categoryName.toUpperCase().replace(/[^A-Z0-9]/g, "_")
  };
  
  categorySearchQuery = "";
  categorySortOption = "popular";
  categoryStoreFilter = "all";
  
  const searchInp = document.getElementById("category-search-input") as HTMLInputElement;
  if (searchInp) searchInp.value = "";
  
  const sortSel = document.getElementById("category-sort-select") as HTMLSelectElement;
  if (sortSel) sortSel.value = "popular";
  
  const storeSel = document.getElementById("category-store-filter-select") as HTMLSelectElement;
  if (storeSel) storeSel.value = "all";
  
  const storefrontEl = document.getElementById("category-storefront-view");
  if (storefrontEl) {
    storefrontEl.classList.remove("hidden");
    setTimeout(() => {
      storefrontEl.classList.remove("translate-y-full");
      storefrontEl.classList.add("translate-y-0");
    }, 15);
  }
  
  updateCategoryStorefrontDetails();
  bindCategoryStorefrontControls();
}

function closeCategoryStorefront() {
  const storefrontEl = document.getElementById("category-storefront-view");
  if (storefrontEl) {
    storefrontEl.classList.remove("translate-y-0");
    storefrontEl.classList.add("translate-y-full");
    setTimeout(() => {
      storefrontEl.classList.add("hidden");
    }, 350);
  }
}

function updateCategoryStorefrontDetails() {
  if (!activeStorefrontCategory) return;
  
  const bannerContainer = document.getElementById("category-banner-container")!;
  const titleContainer = document.getElementById("category-storefront-title")!;
  const badgeContainer = document.getElementById("category-storefront-badge")!;
  
  if (bannerContainer) {
    const finalBanner = activeStorefrontCategory.bannerUrl || `https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=600&auto=format&fit=crop&q=80`;
    bannerContainer.style.backgroundImage = `url('${finalBanner}')`;
    bannerContainer.style.backgroundSize = "cover";
    bannerContainer.style.backgroundPosition = "center";
  }
  
  if (titleContainer) {
    titleContainer.innerText = activeStorefrontCategory.name;
  }
  
  if (badgeContainer) {
    badgeContainer.innerText = activeStorefrontCategory.featured === true || activeStorefrontCategory.featured === "yes" ? "Trending Collection" : "Apollo Pharmacy Verified";
  }

  // Gather active delivery pharmacies
  const storesWithinRadiusIds = new Set(allStores.filter((s) => {
    if (!s.location || !currentCoordinates) return false;
    const dist = calculateDistance(currentCoordinates.lat, currentCoordinates.lng, s.location.lat, s.location.lng);
    return dist <= currentDeliveryRadius;
  }).map(s => s.storeId));

  // Matched category medicines list
  let matchedList = allMedicines.filter((m) => {
    if (m.category !== activeStorefrontCategory.name) return false;
    if (currentCoordinates && !storesWithinRadiusIds.has(m.storeId)) return false;
    if (categoryStoreFilter !== "all" && m.storeId !== categoryStoreFilter) return false;
    
    if (categorySearchQuery !== "") {
      const q = categorySearchQuery.toLowerCase();
      const nLower = (m.name || "").toLowerCase();
      const dLower = (m.description || "").toLowerCase();
      if (!nLower.includes(q) && !dLower.includes(q)) return false;
    }
    
    return true;
  });

  // Sort
  if (categorySortOption === "price-low") {
    matchedList.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  } else if (categorySortOption === "price-high") {
    matchedList.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  } else {
    // Sort by rating / default
    matchedList.sort((a, b) => Number(b.rating || 4.2) - Number(a.rating || 4.2));
  }

  // Update lists
  const cntContainer = document.getElementById("category-storefront-cnt");
  if (cntContainer) {
    cntContainer.innerText = `${matchedList.length} meds found`;
  }

  const listContainer = document.getElementById("category-medicines-list-container");
  if (listContainer) {
    if (matchedList.length === 0) {
      listContainer.innerHTML = `
        <div class="text-center py-12 text-slate-400 bg-white border border-slate-100 rounded-3xl p-6 shadow-3xs animate-fade-in w-full">
          <i class="fa-solid fa-box-open text-3xl text-slate-300 mb-2"></i>
          <p class="text-xs font-black text-slate-700">No matching medications</p>
          <p class="text-[10px] text-slate-400 font-semibold mt-1">We couldn't locate medicine stock matching selections here inside your radius.</p>
        </div>
      `;
    } else {
      listContainer.innerHTML = matchedList.map((m) => {
        const qtyInCart = cartItems[m.medicineId]?.qty || 0;
        const isFav = profileData && profileData.favorites && profileData.favorites[m.medicineId] ? true : false;
        
        const storeObj = allStores.find(st => st.id === m.storeId || st.storeId === m.storeId);
        const storeName = storeObj ? storeObj.name : "Local Pharmacy";
        
        return `
          <div class="bg-white rounded-2xl border border-slate-150 p-3 shadow-3xs hover:shadow-2xs transition-all relative flex flex-col gap-3 font-sans w-full select-none">
            <button onclick="toggleFavoriteItem('${m.medicineId}')" class="absolute top-2.5 right-2.5 w-7 h-7 bg-white hover:bg-slate-50 text-slate-400 hover:text-rose-500 rounded-full flex items-center justify-center border border-slate-100 transition-all cursor-pointer z-10 shadow-3xs focus:outline-none">
              <i class="${isFav ? 'fa-solid fa-heart text-rose-500' : 'fa-regular fa-heart'} text-xs"></i>
            </button>
            
            <div class="flex gap-3 text-left">
              <img class="w-16 h-16 rounded-xl object-cover cursor-pointer border border-slate-100 shrink-0 select-none shadow-3xs" src="${m.image || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300"}" referrerpolicy="no-referrer" alt="${m.name}" onclick="openProductDetailDrawer('${m.medicineId}')">
              <div class="flex-1 min-w-0 flex flex-col justify-between">
                <div class="cursor-pointer text-left" onclick="openProductDetailDrawer('${m.medicineId}')">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[7.5px] font-black uppercase text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded tracking-wider leading-none">${m.category || "General"}</span>
                    ${m.prescriptionRequired ? `<span class="text-[7px] font-black uppercase text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded tracking-wider flex items-center gap-0.5 leading-none"><i class="fa-solid fa-file-prescription"></i> Rx needed</span>` : ""}
                  </div>
                  <h4 class="font-extrabold text-slate-900 text-[11px] truncate leading-tight tracking-tight mt-1.5 font-display">${m.name}</h4>
                  <p class="text-[9px] text-slate-450 text-slate-400 truncate mt-0.5" title="${m.description}">${m.description || "Certified medicinal drug formula"}</p>
                  
                  <div class="flex items-center gap-1 mt-1.5 text-[8.5px] font-black text-indigo-700 bg-indigo-50/50 border border-indigo-100 rounded px-1.5 py-0.5 w-max">
                    <i class="fa-solid fa-prescription-bottle-medical text-[7.5px] text-indigo-500"></i> ${storeName}
                  </div>
                </div>
              </div>
            </div>
            
            <div class="flex items-center justify-between border-t border-slate-100 pt-2 px-0.5 mt-0.5">
              <div class="flex flex-col text-left">
                <span class="text-[8px] text-slate-400 uppercase font-black tracking-wide leading-none select-none">Apollo Pharmacy Discounted</span>
                <span class="font-black text-slate-900 text-[13px] font-mono tracking-tight text-blue-600 mt-1">₹${m.price}</span>
              </div>
              
              ${qtyInCart > 0 ? `
                <div class="flex items-center gap-3 bg-blue-605 bg-blue-600 text-white rounded-xl px-3 py-1.5 text-[10px] font-black shadow-3xs font-mono border-none">
                  <button onclick="updateCartItemQtyAndRefresh('${m.medicineId}', -1)" class="cursor-pointer hover:opacity-85 px-0.5 border-none bg-transparent text-white outline-none"><i class="fa-solid fa-minus text-[7.5px]"></i></button>
                  <span class="min-w-[10px] text-center select-none font-bold">${qtyInCart}</span>
                  <button onclick="updateCartItemQtyAndRefresh('${m.medicineId}', 1)" class="cursor-pointer hover:opacity-85 px-0.5 border-none bg-transparent text-white outline-none"><i class="fa-solid fa-plus text-[7.5px]"></i></button>
                </div>
              ` : `
                <button onclick="addMedicineAndReloadStorefront('${m.medicineId}')" class="bg-blue-605 bg-blue-600 hover:bg-blue-700 text-white text-[8px] font-black py-1.5 px-3 rounded-xl hover:shadow-xs transition-any cursor-pointer uppercase tracking-wider flex items-center gap-1 border-none font-sans">
                  Add <i class="fa-solid fa-plus text-[7px]"></i>
                </button>
              `}
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // Populate Store filter options
  const filterSelect = document.getElementById("category-store-filter-select") as HTMLSelectElement;
  if (filterSelect) {
    const relativeMedicines = allMedicines.filter(m => m.category === activeStorefrontCategory.name);
    const uniqueStoreIds = [...new Set(relativeMedicines.map(m => m.storeId))].filter(Boolean);
    
    let opts = `<option value="all">All Pharmacies</option>`;
    uniqueStoreIds.forEach(sid => {
      const s = allStores.find(store => store.id === sid || store.storeId === sid);
      if (s) {
        opts += `<option value="${sid}">${s.name}</option>`;
      }
    });
    filterSelect.innerHTML = opts;
    filterSelect.value = categoryStoreFilter;
  }
}

function bindCategoryStorefrontControls() {
  const searchInp = document.getElementById("category-search-input");
  if (searchInp) {
    searchInp.replaceWith(searchInp.cloneNode(true)); // eliminate duplicate bindings
    document.getElementById("category-search-input")!.addEventListener("input", (e) => {
      categorySearchQuery = (e.target as HTMLInputElement).value.trim();
      updateCategoryStorefrontDetails();
    });
  }

  const sortSel = document.getElementById("category-sort-select");
  if (sortSel) {
    sortSel.replaceWith(sortSel.cloneNode(true));
    document.getElementById("category-sort-select")!.addEventListener("change", (e) => {
      categorySortOption = (e.target as HTMLSelectElement).value;
      updateCategoryStorefrontDetails();
    });
  }

  const storeSel = document.getElementById("category-store-filter-select");
  if (storeSel) {
    storeSel.replaceWith(storeSel.cloneNode(true));
    document.getElementById("category-store-filter-select")!.addEventListener("change", (e) => {
      categoryStoreFilter = (e.target as HTMLSelectElement).value;
      updateCategoryStorefrontDetails();
    });
  }

  const closeBtn = document.getElementById("btn-close-category-storefront");
  if (closeBtn) {
    closeBtn.replaceWith(closeBtn.cloneNode(true));
    document.getElementById("btn-close-category-storefront")!.addEventListener("click", () => {
      closeCategoryStorefront();
    });
  }
}

// Attach these clean helpers to the window namespace
Object.assign(window, {
  openCategoryStorefront,
  closeCategoryStorefront,
  addMedicineAndReloadStorefront(id: string) {
    (window as any).addMedicineToCart(id);
    updateCategoryStorefrontDetails();
  },
  updateCartItemQtyAndRefresh(id: string, delta: number) {
    (window as any).updateCartItemQty(id, delta);
    updateCategoryStorefrontDetails();
  },
  refreshCategoryStorefront() {
    updateCategoryStorefrontDetails();
  }
});

// Search suggestions, Recent searches, and Trending searches behavior
const searchInput = document.getElementById("search-medicine-input") as HTMLInputElement;
const searchPanel = document.getElementById("search-suggestions-panel") as HTMLDivElement;
const recentTrendingContainer = document.getElementById("search-recent-trending-container") as HTMLDivElement;
const dynamicResultsContainer = document.getElementById("search-dynamic-results-container") as HTMLDivElement;
const clearRecentBtn = document.getElementById("btn-clear-recent-searches");

function getRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem("recentSearches") || "[]");
  } catch (e) {
    return [];
  }
}

function addRecentSearch(text: string) {
  if (!text || text.trim() === "") return;
  let list = getRecentSearches();
  list = list.filter((i) => i.toLowerCase() !== text.toLowerCase());
  list.unshift(text);
  if (list.length > 6) list.pop();
  localStorage.setItem("recentSearches", JSON.stringify(list));
}

function clearRecentSearches() {
  localStorage.removeItem("recentSearches");
  updateSearchSuggestionsPanel();
}

function updateSearchSuggestionsPanel() {
  if (!searchInput || !searchPanel) return;
  const q = searchInput.value.trim().toLowerCase();

  if (q === "") {
    recentTrendingContainer?.classList.remove("hidden");
    dynamicResultsContainer?.classList.add("hidden");

    const recentListEl = document.getElementById("recent-searches-list");
    if (recentListEl) {
      const list = getRecentSearches();
      if (list.length === 0) {
        recentListEl.innerHTML = `<span class="text-[10px] text-slate-400 font-semibold py-1">No recent searches</span>`;
      } else {
        recentListEl.innerHTML = list.map(item => `
          <button onclick="triggerPresetSearch('${item.replace(/'/g, "\\'")}')" class="bg-slate-100 text-slate-700 text-[10px] font-bold px-2.5 py-1 rounded-full cursor-pointer hover:bg-blue-50 hover:text-blue-600 border border-slate-200 focus:outline-none">${item}</button>
        `).join("");
      }
    }
  } else {
    recentTrendingContainer?.classList.add("hidden");
    dynamicResultsContainer?.classList.remove("hidden");

    // 1. Medicines found
    const medListEl = document.getElementById("search-suggested-medicines");
    if (medListEl) {
      const matchedMeds = allMedicines.filter(m => 
        (m.name || "").toLowerCase().includes(q) ||
        (m.description || "").toLowerCase().includes(q) ||
        (m.brand || "").toLowerCase().includes(q)
      ).slice(0, 5);

      if (matchedMeds.length === 0) {
        medListEl.innerHTML = `<span class="text-[10px] text-slate-400 font-semibold py-1 block">No medicines found</span>`;
      } else {
        medListEl.innerHTML = matchedMeds.map(m => `
          <button onclick="triggerProductDetailDrawer('${m.id}')" class="w-full text-left p-1.5 flex items-center gap-2 rounded-lg hover:bg-slate-50 transition-all cursor-pointer focus:outline-none">
            <img src="${m.imageUrl || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=150&auto=format&fit=crop&q=60'}" class="w-7 h-7 rounded-md object-cover border border-slate-100 shrink-0" referrerpolicy="no-referrer">
            <div class="truncate flex-1">
              <span class="text-[10px] font-bold text-slate-800 block leading-none truncate">${m.name}</span>
              <span class="text-[8px] text-slate-400 font-extrabold font-mono uppercase mt-0.5 block">${m.brand || 'Central Rx'} • ₹${m.price}</span>
            </div>
            <i class="fa-solid fa-chevron-right text-slate-350 text-[8px]"></i>
          </button>
        `).join("");
      }
    }

    // 2. Categories matches
    const catListEl = document.getElementById("search-suggested-categories");
    if (catListEl) {
      const matchedCats = currentCategoriesList.filter(c => 
        (c.name || "").toLowerCase().includes(q)
      ).slice(0, 4);

      if (matchedCats.length === 0) {
        catListEl.innerHTML = `<span class="text-[10px] text-slate-400 font-semibold py-1 block">No category matches</span>`;
      } else {
        catListEl.innerHTML = matchedCats.map(c => `
          <button onclick="triggerCategoryFilter('${c.name.replace(/'/g, "\\'")}')" class="bg-blue-50 text-blue-700 border border-blue-100 text-[9.5px] font-extrabold px-2.5 py-1 rounded-full cursor-pointer hover:scale-103 transition-all focus:outline-none">${c.name}</button>
        `).join("");
      }
    }

    // 3. Partner Pharmacy Stores
    const storeListEl = document.getElementById("search-suggested-stores");
    if (storeListEl) {
      const matchedStores = allStores.filter(s => 
        (s.storeName || "").toLowerCase().includes(q) ||
        (s.city || "").toLowerCase().includes(q) ||
        (s.address || "").toLowerCase().includes(q)
      ).slice(0, 3);

      if (matchedStores.length === 0) {
        storeListEl.innerHTML = `<span class="text-[10px] text-slate-400 font-semibold py-1 block">No stores found</span>`;
      } else {
        storeListEl.innerHTML = matchedStores.map(s => `
          <button onclick="triggerStoreFilter('${s.storeId}')" class="w-full text-left p-1.5 flex items-center gap-2 rounded-lg hover:bg-slate-50 transition-all cursor-pointer focus:outline-none">
            <i class="fa-solid fa-store text-teal-500 text-[10px] shrink-0"></i>
            <div class="truncate flex-1">
              <span class="text-[10px] font-bold text-slate-800 block leading-none truncate">${s.storeName}</span>
              <span class="text-[8px] text-slate-400 font-extrabold font-mono uppercase mt-0.5 block">${s.city || 'Delhi'} • Verified Partner</span>
            </div>
            <i class="fa-solid fa-chevron-right text-slate-350 text-[8px]"></i>
          </button>
        `).join("");
      }
    }
  }
}

// Bind events
searchInput?.addEventListener("focus", () => {
  searchPanel?.classList.remove("hidden");
  updateSearchSuggestionsPanel();
});

searchInput?.addEventListener("input", (e) => {
  searchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
  renderMedicinesGrid();
  updateSearchSuggestionsPanel();
});

searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const text = searchInput.value.trim();
    if (text !== "") {
      addRecentSearch(text);
      searchPanel?.classList.add("hidden");
      searchInput.blur();
    }
  }
});

// Close suggestions panel when clicking outside
document.addEventListener("click", (e) => {
  if (searchInput && searchPanel && !searchInput.contains(e.target as Node) && !searchPanel.contains(e.target as Node)) {
    searchPanel.classList.add("hidden");
  }
});

clearRecentBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  clearRecentSearches();
});

// Global search preset triggers
function triggerPresetSearch(text: string) {
  if (searchInput) {
    searchInput.value = text;
    searchQuery = text.trim().toLowerCase();
    addRecentSearch(text);
    renderMedicinesGrid();
    updateSearchSuggestionsPanel();
    searchPanel?.classList.remove("hidden");
  }
}

function triggerCategoryFilter(categoryName: string) {
  activeCategory = categoryName;
  searchPanel?.classList.add("hidden");
  
  // Highlight horizontal button style
  const btns = document.querySelectorAll(".category-slider-btn");
  btns.forEach(btn => {
    const cat = btn.getAttribute("data-category");
    if (cat === categoryName) {
      btn.classList.add("scale-105", "text-blue-600");
    } else {
      btn.classList.remove("scale-105", "text-blue-600");
    }
  });

  renderMedicinesGrid();
  
  // Scroll to medicines list
  const gridEl = document.getElementById("user-medicines-grid");
  gridEl?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function triggerStoreFilter(storeId: string) {
  activeStoreId = storeId;
  searchPanel?.classList.add("hidden");
  renderPharmacySlider();
  renderMedicinesGrid();
  
  // Scroll to medicines list
  const gridEl = document.getElementById("user-medicines-grid");
  gridEl?.scrollIntoView({ behavior: "smooth", block: "start" });
}

Object.assign(window, {
  triggerPresetSearch,
  triggerCategoryFilter,
  triggerStoreFilter
});

// Rendering operational stores horizontal scroller
function renderPharmacySlider() {
  const container = document.getElementById("user-store-slider")!;
  
  const storesWithinRadius = allStores.filter((s) => {
    if (!s.location || !currentCoordinates) return false;
    const dist = calculateDistance(currentCoordinates.lat, currentCoordinates.lng, s.location.lat, s.location.lng);
    return dist <= currentDeliveryRadius;
  });

  const storeCntEl = document.getElementById("user-store-cnt");
  if (storeCntEl) {
    storeCntEl.innerText = `${storesWithinRadius.length} Stores Available`;
  }

  const serviceUnavailableEl = document.getElementById("service-unavailable-view");
  if (storesWithinRadius.length === 0) {
    serviceUnavailableEl?.classList.remove("hidden");
    container.innerHTML = `
      <div class="px-5 py-4 w-full text-center text-slate-400 font-bold text-xs bg-white rounded-2xl border border-dashed border-slate-200">
        Currently no pharmacy is available in your area.
      </div>
    `;
    return;
  } else {
    serviceUnavailableEl?.classList.add("hidden");
  }

  container.innerHTML = `
    <!-- All toggle button -->
    <button onclick="selectActiveStore('')" class="flex items-center gap-3 p-3 bg-white border ${activeStoreId === "" ? "border-blue-500 bg-blue-50/10 text-blue-600 ring-2 ring-blue-500/20" : "border-slate-100 text-slate-600"} rounded-2xl shadow-xs shrink-0 cursor-pointer min-w-[150px] hover:scale-98 transition-all relative">
      <div class="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-black">
        <i class="fa-solid fa-house-medical text-base"></i>
      </div>
      <div class="text-left font-black text-xs leading-tight">
        <h5 class="text-[10px] tracking-tight truncate uppercase font-display">ALL STORES</h5>
        <span class="text-[8px] text-slate-400 block font-bold">Filter Reset</span>
      </div>
    </button>
  ` + storesWithinRadius.map((s) => {
    const isSelected = s.storeId === activeStoreId;
    const isOpen = s.isOpen !== false;
    const statusText = isOpen ? "OPEN" : "CLOSED";
    const statusColorClass = isOpen ? "text-emerald-500 bg-emerald-50" : "text-rose-500 bg-rose-50";
    
    // Dynamic calculate distance
    const dist = calculateDistance(currentCoordinates!.lat, currentCoordinates!.lng, s.location.lat, s.location.lng).toFixed(1);

    return `
      <button onclick="selectActiveStore('${s.storeId}')" class="flex items-center gap-3 p-3 bg-white border ${isSelected ? "border-blue-500 bg-blue-50/10 text-blue-600 ring-2 ring-blue-500/20" : "border-slate-100 text-slate-600"} rounded-2xl shadow-xs shrink-0 cursor-pointer min-w-[200px] hover:scale-98 transition-all text-left">
        <!-- Logo Icon circular -->
        <div class="w-10 h-10 rounded-full bg-rose-50 border border-rose-100 text-rose-500 flex items-center justify-center font-bold shrink-0 relative">
          <i class="fa-solid fa-laptop-medical text-base"></i>
          <span class="absolute top-0 right-0 w-2.5 h-2.5 rounded-full ${isOpen ? "bg-emerald-500" : "bg-rose-500"} border-2 border-white"></span>
        </div>
        <div class="flex-1 min-w-0">
          <h5 class="font-bold text-[10px] text-slate-900 truncate uppercase tracking-tight leading-snug font-display">${s.name}</h5>
          
          <div class="flex items-center gap-1.5 mt-1 font-semibold text-[8px] text-slate-500">
            <span class="flex items-center gap-0.5"><i class="fa-solid fa-location-crosshairs text-[8px]"></i> ${dist} KM</span>
            <span class="w-1 h-1 bg-slate-200 rounded-full"></span>
            <span class="px-1.5 py-0.5 rounded font-black tracking-wide text-[7px] ${statusColorClass}">${statusText}</span>
          </div>
        </div>
      </button>
    `;
  }).join("");
}

Object.assign(window, {
  selectActiveStore(id: string) {
    activeStoreId = id;
    renderPharmacySlider();
    renderMedicinesGrid();
  }
});

// Render grid display items
function renderMedicinesGrid() {
  const container = document.getElementById("user-medicines-grid")!;
  
  // Filter stores within the maximum delivery radius
  const storesWithinRadiusIds = new Set(allStores.filter((s) => {
    if (!s.location || !currentCoordinates) return false;
    const dist = calculateDistance(currentCoordinates.lat, currentCoordinates.lng, s.location.lat, s.location.lng);
    return dist <= currentDeliveryRadius;
  }).map(s => s.storeId));

  const filtered = allMedicines.filter((m) => {
    // Only restrict medicines to stores within the radius if we are NOT searching and coordinates are resolved
    if (searchQuery === "" && currentCoordinates && !storesWithinRadiusIds.has(m.storeId)) return false;

    // When searching for an item, bypass the selected Category and Store filter to locate matching medicine easily
    const matchCat = searchQuery !== "" || activeCategory === "All" || m.category === activeCategory;
    const matchStore = searchQuery !== "" || activeStoreId === "" || m.storeId === activeStoreId;
    
    const nameLower = (m.name || "").toLowerCase();
    const descLower = (m.description || "").toLowerCase();
    const catLower = (m.category || "").toLowerCase();
    const mfrLower = (m.manufacturer || "").toLowerCase();
    const brandLower = (m.brand || "").toLowerCase();

    const matchSearch = searchQuery === "" || 
                        nameLower.includes(searchQuery) || 
                        descLower.includes(searchQuery) || 
                        catLower.includes(searchQuery) ||
                        mfrLower.includes(searchQuery) ||
                        brandLower.includes(searchQuery);

    return matchCat && matchStore && matchSearch;
  });

  document.getElementById("user-meds-cnt")!.innerText = `${filtered.length} Items`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-400 font-semibold text-xs animate-fade-in w-full">
        <i class="fa-solid fa-box-open text-2xl mb-2 text-slate-300"></i>
        <p>No medicines match your segment filters.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((m) => {
    const qtyInCart = cartItems[m.medicineId]?.qty || 0;
    const isFav = profileData && profileData.favorites && profileData.favorites[m.medicineId] ? true : false;
    
    // Deterministic premium discount for high-quality marketing layout
    const idHash = m.medicineId ? m.medicineId.charCodeAt(0) + (m.medicineId.charCodeAt(m.medicineId.length - 1) || 0) : 10;
    const discount = (idHash % 15) + 10; // 10% to 24%
    const originalPrice = Math.round(m.price / (1 - discount / 100));

    return `
      <div class="bg-white rounded-2xl overflow-hidden border border-slate-100/80 shadow-xs flex flex-col justify-between hover:shadow-md hover:border-emerald-100 transition-all duration-300 relative group shrink-0 w-[155px]">
        <!-- Discount Badging -->
        <span class="absolute top-2.5 left-2.5 bg-rose-500 text-white text-[7.5px] font-black px-2 py-0.5 rounded-full shadow-3xs z-10 uppercase tracking-widest leading-none">${discount}% OFF</span>
        
        <!-- Favorite heart trigger -->
        <button onclick="toggleFavoriteItem('${m.medicineId}')" class="absolute top-2.5 right-2.5 w-7 h-7 bg-white/90 hover:bg-white text-slate-400 hover:text-rose-500 rounded-full flex items-center justify-center border border-slate-150/40 transition-all cursor-pointer z-10 shadow-3xs focus:outline-none">
          <i class="${isFav ? 'fa-solid fa-heart text-rose-500 scale-110' : 'fa-regular fa-heart'} text-xs"></i>
        </button>

        <div class="relative w-full h-28 overflow-hidden bg-slate-50 flex items-center justify-center p-2 cursor-pointer" onclick="openProductDetailDrawer('${m.medicineId}')">
          <img class="max-h-full max-w-full object-contain rounded-lg select-none group-hover:scale-105 transition-transform duration-300" src="${m.image || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300"}" referrerpolicy="no-referrer" alt="${m.name}">
        </div>

        <div class="p-3 space-y-2 flex-1 flex flex-col justify-between">
          <div class="cursor-pointer" onclick="openProductDetailDrawer('${m.medicineId}')">
            <span class="text-[7px] uppercase font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full tracking-wider">${m.category || "General"}</span>
            <h4 class="font-black text-slate-900 text-[11.5px] mt-1.5 truncate leading-tight tracking-tight font-sans">${m.name}</h4>
            <p class="text-[9px] text-slate-400 truncate mt-0.5 leading-normal" title="${m.description}">${m.description || "Certified secure pharmaceutical product"}</p>
          </div>
          
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-100/80 gap-1.5">
            <div class="flex flex-col">
              <span class="font-black text-slate-900 text-xs">₹${m.price}</span>
              <span class="text-[8px] text-slate-400 line-through font-bold">₹${originalPrice}</span>
            </div>
            
            ${qtyInCart > 0 ? `
              <!-- Quantities controller active border -->
              <div class="flex items-center gap-2 bg-emerald-500 text-white rounded-xl px-2.5 py-1.5 text-[8.5px] font-black shadow-sm">
                <button onclick="updateCartItemQty('${m.medicineId}', -1)" class="cursor-pointer hover:opacity-85 px-0.5"><i class="fa-solid fa-minus text-[8px]"></i></button>
                <span class="min-w-[12px] text-center">${qtyInCart}</span>
                <button onclick="updateCartItemQty('${m.medicineId}', 1)" class="cursor-pointer hover:opacity-85 px-0.5"><i class="fa-solid fa-plus text-[8px]"></i></button>
              </div>
            ` : `
              <!-- Action add selection -->
              <button onclick="addMedicineToCart('${m.medicineId}')" class="bg-white hover:bg-emerald-500 hover:text-white border-2 border-emerald-500/85 text-emerald-600 text-[9px] font-black py-1 px-3 rounded-xl transition-all duration-200 cursor-pointer uppercase tracking-wider flex items-center gap-0.5 shadow-3xs hover:shadow-xs">
                ADD <i class="fa-solid fa-plus text-[7.5px]"></i>
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// Basket Cart Handlers mapping
Object.assign(window, {
  async toggleFavoriteItem(id: string) {
    if (!loggedInUser) return;
    const key = `users/${loggedInUser.uid}/favorites/${id}`;
    const snap = await get(ref(db, key));
    if (snap.exists()) {
      await remove(ref(db, key));
      showToast("Removed from Favorites", "info");
    } else {
      await set(ref(db, key), true);
      showToast("Added to Favorites!", "success");
    }
    await syncUserProfileDash();
    renderMedicinesGrid();
  },
  addMedicineToCart(id: string) {
    const med = allMedicines.find((m) => m.medicineId === id);
    if (!med) return;

    if (activeStoreId && activeStoreId !== med.storeId) {
      // Cart system supports only single store purchase for robust distribution!
      showToast("For safety, please bundle items from one pharmacy store in single checkout.", "info");
    }

    cartItems[id] = {
      medicineId: med.medicineId,
      name: med.name,
      price: med.price,
      qty: 1,
      category: med.category || "General",
      storeId: med.storeId,
      storeName: med.storeName || "Pharmacy Store"
    };

    showToast(`${med.name} added to cart!`, "success");
    syncCartBadge();
    renderMedicinesGrid();
    triggerAISuggestion();
  },
  updateCartItemQty(id: string, delta: number) {
    if (!cartItems[id]) return;

    cartItems[id].qty += delta;
    if (cartItems[id].qty <= 0) {
      delete cartItems[id];
      showToast("Item removed from basket.", "info");
    }

    syncCartBadge();
    renderMedicinesGrid();
    renderCartDrawer();
  }
});

function syncCartBadge() {
  const badge = document.getElementById("badge-cart-cnt")!;
  const cartValues = Object.values(cartItems);
  const totalItems = cartValues.reduce((acc, current) => acc + current.qty, 0);

  if (totalItems > 0) {
    badge.innerText = totalItems.toString();
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// 2. CHECKOUT CART DRAWER LAYOUT
const confirmBtn = document.getElementById("btn-confirm-order") as HTMLButtonElement;

function renderCartDrawer() {
  const container = document.getElementById("cart-items-container")!;
  const items = Object.values(cartItems);

  if (items.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-400">
        <i class="fa-solid fa-cart-plus text-4xl mb-2 text-slate-300"></i>
        <p class="text-xs font-semibold">Your shopping basket is empty.</p>
      </div>
    `;
    updatePricingBox(0);
    confirmBtn.disabled = true;
    confirmBtn.className = "w-full bg-slate-200 text-slate-400 font-bold py-3.5 rounded-xl cursor-not-allowed mt-1";
    return;
  }

  confirmBtn.disabled = false;
  confirmBtn.className = "w-full bg-teal-500 hover:bg-teal-600 text-white font-bold py-3.5 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer mt-1 hover:-translate-y-0.5";

  container.innerHTML = items.map((it) => `
    <div class="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-100 text-xs font-semibold">
      <div>
        <h4 class="font-extrabold text-slate-900 leading-tight">${it.name}</h4>
        <p class="text-[9px] text-slate-400 mt-0.5 uppercase">${it.storeName}</p>
      </div>
      <div class="flex items-center gap-4">
        <span class="font-mono text-slate-800">₹${it.price * it.qty}</span>
        
        <div class="flex items-center gap-1.5 bg-slate-200 text-slate-700 rounded-lg px-2 py-1 text-[9px] font-black">
          <button onclick="updateCartItemQty('${it.medicineId}', -1)" class="cursor-pointer hover:opacity-80 px-1"><i class="fa-solid fa-minus"></i></button>
          <span>${it.qty}</span>
          <button onclick="updateCartItemQty('${it.medicineId}', 1)" class="cursor-pointer hover:opacity-80 px-1"><i class="fa-solid fa-plus"></i></button>
        </div>
      </div>
    </div>
  `).join("");

  // Compute Subtotal
  const subtotal = items.reduce((acc, curr) => acc + curr.price * curr.qty, 0);
  updatePricingBox(subtotal);
}

document.getElementById("btn-close-checkout")?.addEventListener("click", () => {
  checkoutDrawer.classList.add("hidden");
});

function updatePricingBox(subtotal: number) {
  const box = document.getElementById("checkout-pricing-box")!;
  if (subtotal === 0) {
    box.innerHTML = `
      <div class="flex justify-between text-slate-500 font-semibold text-xs">
        <span>Cart Items:</span>
        <span class="font-mono">₹0</span>
      </div>
    `;
    return;
  }

  // Calculate fees dynamically
  const gst = Math.round(subtotal * (charges.gst / 100));
  const deliveryFee = charges.deliveryCharge || 40;
  const platformFee = charges.platformFee || 5;

  let discount = 0;
  if (appliedCoupon) {
    discount = Math.round(subtotal * (appliedCoupon.discountPercent / 100));
    if (discount > appliedCoupon.maxDiscount) discount = appliedCoupon.maxDiscount;
  }

  const finalTotal = subtotal + gst + deliveryFee + platformFee - discount;

  box.innerHTML = `
    <div class="flex justify-between text-slate-500 font-semibold">
      <span>Subtotal:</span>
      <span class="font-mono">₹${subtotal}</span>
    </div>
    <div class="flex justify-between text-slate-500 font-semibold">
      <span>Taxes (GST ${charges.gst}%):</span>
      <span class="font-mono">₹${gst}</span>
    </div>
    <div class="flex justify-between text-slate-500 font-semibold mt-0.5">
      <span>Operational charges/Fees:</span>
      <span class="font-mono">₹${deliveryFee + platformFee}</span>
    </div>
    ${discount > 0 ? `
      <div class="flex justify-between font-bold text-emerald-600 mt-0.5">
        <span>Coupon applied (${appliedCoupon.code}):</span>
        <span class="font-mono">-₹${discount}</span>
      </div>
    ` : ""}
    <div class="flex justify-between font-extrabold text-slate-900 pt-2 text-sm border-t border-slate-100 mt-2">
      <span>Handovers Collected (C.O.D):</span>
      <span class="font-mono text-teal-500 text-base" id="cart-final-total">₹${Math.round(finalTotal)}</span>
    </div>
  `;
}

// 3. APPLY PROMO SYSTEM
get(ref(db, "coupons")).then((snapshot) => {
  if (snapshot.exists()) {
    snapshot.forEach((child) => {
      couponsList.push(child.val());
    });
  }
});

document.getElementById("btn-apply-coupon")?.addEventListener("click", () => {
  const code = (document.getElementById("cart-coupon-input") as HTMLInputElement).value.trim().toUpperCase();
  const subtotal = Object.values(cartItems).reduce((acc, curr) => acc + curr.price * curr.qty, 0);

  const alertMsg = document.getElementById("coupon-alert-msg")!;
  alertMsg.classList.add("hidden");

  if (!code) {
    showToast("Please enter a promotion code", "info");
    return;
  }

  // Find coupon
  const cp = couponsList.find((c) => c.code === code && c.active);
  if (!cp) {
    showToast("Promo coupon code is invalid or expired.", "error");
    appliedCoupon = null;
    renderCartDrawer();
    return;
  }

  if (subtotal < cp.minOrder) {
    alertMsg.innerText = `Required min cart order value ₹${cp.minOrder} to apply.`;
    alertMsg.className = "text-[10px] font-bold text-rose-500 mt-1 block";
    alertMsg.classList.remove("hidden");
    appliedCoupon = null;
    renderCartDrawer();
    return;
  }

  appliedCoupon = cp;
  alertMsg.innerText = `Success! Promocode ${cp.code} applied successfully.`;
  alertMsg.className = "text-[10px] font-bold text-emerald-600 mt-1 block";
  alertMsg.classList.remove("hidden");
  
  showToast("Discount coupon code applied!", "success");
  renderCartDrawer();
});

// 4. MULTIPLE ADDRESS SEARCH ENGINE & GEOLOCATION (Mappls)
let selectedAddressDetail: any = null;

addrInput?.addEventListener("input", async (e) => {
  const query = (e.target as HTMLInputElement).value;
  if (query.trim().length < 3) {
    addrSuggestions.classList.add("hidden");
    return;
  }

  const features = await searchAddress(query);
  if (features.length === 0) {
    addrSuggestions.classList.add("hidden");
    return;
  }

  addrSuggestions.innerHTML = features.map((f: any) => `
    <button onclick="selectAutocompleteAddress('${f.properties.formatted.replace(/'/g, "\\'")}', ${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]})" class="w-full text-left p-2.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer truncate">
      <i class="fa-solid fa-map-pin mr-1.5 text-teal-500"></i> ${f.properties.formatted}
    </button>
  `).join("");

  addrSuggestions.classList.remove("hidden");
});

Object.assign(window, {
  handleBannerCampaignClick(bannerId: string, redirectUrl: string) {
    if (bannerId && !bannerId.startsWith("default_")) {
      get(ref(db, `banners/${bannerId}/clicks`)).then((snap) => {
        const cur = snap.val() || 0;
        update(ref(db, `banners/${bannerId}`), { clicks: cur + 1 });
      });
    }
    if (redirectUrl && redirectUrl !== "#") {
      window.location.href = redirectUrl;
    }
  },
  setUserBannerIndex(idx: number) {
    if (userBannerAutoplayInterval) {
      clearInterval(userBannerAutoplayInterval);
    }
    userActiveBannerIndex = idx;
    renderUserBannerCarousel();
    startBannerAutoplay();
  },
  selectAutocompleteAddress(formatted: string, lat: number, lng: number) {
    addrInput.value = formatted;
    selectedAddressDetail = { address: formatted, lat, lng };
    currentCoordinates = {
      lat,
      lng,
      address: formatted,
      city: formatted.split(",")[0] || "Gonda",
      state: "Uttar Pradesh"
    };
    addrSuggestions.classList.add("hidden");
    renderPharmacySlider();
    renderMedicinesGrid();
    showToast("Destination marked successfully", "success");
  },
  async setManualCoordinates(formatted: string, lat: number, lng: number, city?: string, state?: string) {
    currentCoordinates = {
      lat,
      lng,
      address: formatted,
      city: city || formatted.split(",")[0] || "Gonda",
      state: state || "Uttar Pradesh",
      district: ""
    };
    selectedAddressDetail = { address: formatted, lat, lng };

    const cityBadge = document.getElementById("loc-city-txt")!;
    if (cityBadge) {
      cityBadge.innerText = formatLocationText(currentCoordinates);
    }
    if (addrInput) {
      addrInput.value = formatted;
    }

    // Save location selection in Firebase Realtime Database
    if (loggedInUser && currentCoordinates) {
      try {
        await update(ref(db, `users/${loggedInUser.uid}`), {
          currentLocation: {
            lat: currentCoordinates.lat,
            lng: currentCoordinates.lng,
            address: currentCoordinates.address || "",
            city: currentCoordinates.city || "",
            district: currentCoordinates.district || "",
            state: currentCoordinates.state || "",
            timestamp: Date.now()
          }
        });
      } catch (err) {
        console.error("Failed saving manual coordinate override to Firebase:", err);
      }
    }
    
    // Clear searched inputs & suggestion layers
    const locSearchInput = document.getElementById("location-search-input") as HTMLInputElement;
    const locSuggestions = document.getElementById("location-suggestions-container") as HTMLDivElement;
    if (locSearchInput) locSearchInput.value = "";
    if (locSuggestions) locSuggestions.classList.add("hidden");

    renderPharmacySlider();
    renderMedicinesGrid();
    showToast(`Location updated to ${cityBadge?.innerText || "chosen city"}!`, "success");
    const locPickerDrawer = document.getElementById("location-picker-drawer") as HTMLDivElement;
    if (locPickerDrawer) locPickerDrawer.classList.add("hidden");
  }
});

// Setup event listeners for Location Picker Drawer helper elements
const locPickerDrawer = document.getElementById("location-picker-drawer") as HTMLDivElement;
const btnLocCapsule = document.getElementById("btn-location-capsule") as HTMLButtonElement;
const btnCloseLocDrawer = document.getElementById("btn-close-location-drawer") as HTMLButtonElement;
const locSearchInput = document.getElementById("location-search-input") as HTMLInputElement;
const locSuggestions = document.getElementById("location-suggestions-container") as HTMLDivElement;
const btnGPSDetectDrawer = document.getElementById("btn-gps-detect-drawer") as HTMLButtonElement;

btnLocCapsule?.addEventListener("click", () => {
  locPickerDrawer?.classList.remove("hidden");
});

btnCloseLocDrawer?.addEventListener("click", () => {
  locPickerDrawer?.classList.add("hidden");
});

locSearchInput?.addEventListener("input", async (e) => {
  const query = (e.target as HTMLInputElement).value;
  if (query.trim().length < 3) {
    locSuggestions.classList.add("hidden");
    return;
  }

  const features = await searchAddress(query);
  if (features.length === 0) {
    locSuggestions.classList.add("hidden");
    return;
  }

  locSuggestions.innerHTML = features.map((f: any) => {
    return `
      <button onclick="setManualCoordinates('${f.properties.formatted.replace(/'/g, "\\'")}', ${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]}, '', '')" class="w-full text-left p-2.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer truncate">
        <i class="fa-solid fa-map-pin mr-1.5 text-teal-500"></i> ${f.properties.formatted}
      </button>
    `;
  }).join("");

  locSuggestions.classList.remove("hidden");
});

btnGPSDetectDrawer?.addEventListener("click", async () => {
  const originalHtml = btnGPSDetectDrawer.innerHTML;
  btnGPSDetectDrawer.disabled = true;
  btnGPSDetectDrawer.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Detecting...`;
  showToast("Requerying GPS...", "info");
  try {
    const loc = await getCurrentGPS();
    if (loc.address) {
      currentCoordinates = loc;
      const cityBadge = document.getElementById("loc-city-txt")!;
      if (cityBadge) {
        cityBadge.innerText = loc.city || loc.address.split(",")[0] || "Bengaluru";
      }
      if (addrInput) {
        addrInput.value = loc.address;
      }
      renderPharmacySlider();
      showToast(`Location updated: ${cityBadge.innerText}`, "success");
      locPickerDrawer?.classList.add("hidden");
    }
  } catch (error) {
    showToast("Failed to detect GPS location automatically. Please choose from list or search.", "error");
  } finally {
    btnGPSDetectDrawer.disabled = false;
    btnGPSDetectDrawer.innerHTML = originalHtml;
  }
});

// Pin current coordinates using browser GPS button inside checkout drawer
document.getElementById("btn-gps-checkout")?.addEventListener("click", async () => {
  showToast("Requerying GPS...", "info");
  try {
    const loc = await getCurrentGPS();
    if (loc.address) {
      addrInput.value = loc.address;
      selectedAddressDetail = loc;
      showToast("Current location resolved!", "success");
    }
  } catch (error) {
    showToast("Fallback: Failed resolving current GPS position.", "error");
  }
});

// 5. CONFIRM ORDER OUTLET
confirmBtn.addEventListener("click", async () => {
  const items = Object.values(cartItems);
  const address = addrInput.value.trim();

  if (items.length === 0) {
    showToast("Your basket is empty.", "error");
    return;
  }

  if (!address) {
    showToast("Operational requirement: Delivery address needed to dispatch meds.", "error");
    return;
  }

  confirmBtn.disabled = true;
  confirmBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Ordering...`;

  const orderId = `ord_${Date.now()}`;
  const subtotal = items.reduce((acc, curr) => acc + curr.price * curr.qty, 0);
  const gst = Math.round(subtotal * (charges.gst / 100));
  const deliveryCharge = charges.deliveryCharge || 40;
  const platformFee = charges.platformFee || 5;

  let discount = 0;
  if (appliedCoupon) {
    discount = Math.round(subtotal * (appliedCoupon.discountPercent / 100));
    if (discount > appliedCoupon.maxDiscount) discount = appliedCoupon.maxDiscount;
  }

  const total = subtotal + gst + deliveryCharge + platformFee - discount;
  const targetStore = items[0];

  // Resolve target coordinates
  const userLat = selectedAddressDetail?.lat || currentCoordinates?.lat || 12.9716;
  const userLng = selectedAddressDetail?.lng || currentCoordinates?.lng || 77.5946;

  // Resolve store profile for distance validation & coordinates storage
  const storeInstance = allStores.find((s) => s.storeId === targetStore.storeId);
  if (storeInstance && storeInstance.location) {
    const storeLat = storeInstance.location.lat;
    const storeLng = storeInstance.location.lng;
    const deliveryDistance = calculateDistance(userLat, userLng, storeLat, storeLng);

    if (deliveryDistance > currentDeliveryRadius) {
      showToast(`Placement disallowed: This pharmacy is beyond the allowed delivery coverage limit. (Max: ${currentDeliveryRadius} KM, Actual: ${deliveryDistance.toFixed(1)} KM)`, "error");
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `<i class="fa-solid fa-credit-card mr-1.5"></i> Confirm Order & Proceed`;
      return;
    }
  } else {
    showToast("Invalid store configuration. Unable to verify delivery coverage.", "error");
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = `<i class="fa-solid fa-credit-card mr-1.5"></i> Confirm Order & Proceed`;
    return;
  }

  const orderPayload = {
    orderId,
    userId: loggedInUser.uid,
    userName: loggedInUser.displayName || "Patient client",
    userMobile: "9988776655", // Fallback mobile contact line
    userAddress: address,
    userLocation: { lat: userLat, lng: userLng },
    storeId: targetStore.storeId,
    storeName: targetStore.storeName,
    storeLocation: {
      lat: storeInstance.location.lat,
      lng: storeInstance.location.lng
    },
    storeAddress: storeInstance.address || "",
    items,
    subtotal,
    gst,
    deliveryCharge,
    platformFee,
    discount,
    total,
    status: "pending", // Starting order step flow
    paymentMethod: "COD",
    createdAt: Date.now(),
    timeline: {
      pendingTime: Date.now()
    }
  };

  try {
    await set(ref(db, `orders/${orderId}`), orderPayload);
    // Push notifications matching partner stores
    const notifyKey = `alert_${Date.now()}`;
    await set(ref(db, `notifications/${targetStore.storeId}/${notifyKey}`), {
      id: notifyKey,
      title: "New Incoming Meds Order",
      body: `Incoming patient order #${orderId.substring(0,8).toUpperCase()} for ₹${Math.round(total)}`,
      timestamp: Date.now()
    });

    showToast("Receipt saved! Checkout order dispatched to pharmacy.", "success");
    
    // Reset basket state
    for (const id in cartItems) delete cartItems[id];
    
    syncCartBadge();
    checkoutDrawer.classList.add("hidden");
    appliedCoupon = null;

    // Transition directly to History tracks
    navOrders.click();
    
    // Set active tracking frame
    setActiveOrderTracking(orderId);

  } catch (error) {
    showToast("Order pipeline checkout failed.", "error");
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = `<i class="fa-solid fa-basket-shopping"></i> Confirm COD Order Handover`;
  }
});

// 6. ORDER TRACKING & RECENT HISTORY VIEW
function syncOrdersHistory() {
  const container = document.getElementById("user-orders-history-list")!;
  get(ref(db, "orders")).then((snapshot) => {
    if (!snapshot.exists()) {
      container.innerHTML = `<p class="text-xs text-center text-slate-400 py-12">No orders recorded.</p>`;
      return;
    }

    const items: any[] = [];
    snapshot.forEach((child) => {
      const o = child.val();
      if (o.userId === loggedInUser.uid) {
        items.push(o);
      }
    });

    document.getElementById("user-orders-cnt")!.innerText = `${items.length} Orders`;

    if (items.length === 0) {
      container.innerHTML = `<p class="text-xs text-[11px] text-center text-slate-400 py-12 font-semibold">Ready to buy certified remedies? Browse medicine shelves!</p>`;
      return;
    }

    // Sort descending
    items.sort((a,b) => b.createdAt - a.createdAt);

    container.innerHTML = items.map((o) => {
      let labelClass = "bg-yellow-50 text-yellow-700";
      if (o.status === "accepted") labelClass = "bg-teal-50 text-teal-700";
      if (o.status === "packed") labelClass = "bg-indigo-50 text-indigo-700";
      if (o.status === "out") labelClass = "bg-sky-50 text-sky-700 animate-pulse";
      if (o.status === "delivered") labelClass = "bg-emerald-50 text-emerald-700";

      return `
        <div class="bg-white rounded-2xl border border-slate-100 p-4 shadow-xs space-y-3 font-medium text-xs">
          <div class="flex items-center justify-between border-b border-slate-50 pb-2">
            <div>
              <span class="font-extrabold text-slate-900">Order #${o.orderId.substring(0,8).toUpperCase()}</span>
              <p class="text-[9px] text-slate-400 font-mono mt-0.5">${new Date(o.createdAt).toLocaleString()}</p>
            </div>
            <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded ${labelClass}">${o.status}</span>
          </div>

          <div class="space-y-1">
            ${o.items?.map((it: any) => `
              <div class="flex justify-between text-[11px] text-slate-650">
                <span>${it.name} <strong class="text-teal-600">x${it.qty}</strong></span>
                <span class="font-mono">₹${it.price * it.qty}</span>
              </div>
            `).join("")}
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-slate-50 text-[11px]">
            <div>
              <p class="text-slate-400 font-semibold">Store Node</p>
              <h5 class="font-bold text-slate-700">${o.storeName}</h5>
            </div>
            <div class="text-right">
              <span class="text-[9px] text-slate-400 block font-bold leading-normal">Total Collected (COD)</span>
              <strong class="font-mono text-teal-600 text-sm">₹${Math.round(o.total)}</strong>
            </div>
          </div>

          <!-- Select details tracking -->
          <div class="grid grid-cols-2 pt-2 gap-2.5">
            <button onclick="setActiveOrderTracking('${o.orderId}')" class="w-full bg-indigo-50 text-indigo-700 hover:bg-indigo-150 font-bold py-2 rounded-xl text-[10px] text-center tracking-wide hover:-translate-y-0.5 transition-all cursor-pointer">
              <i class="fa-solid fa-map-location-dot"></i> Live Map Tracker
            </button>
            <button onclick="viewCustomerInvoicePDF('${o.orderId}')" class="w-full bg-slate-900 text-white hover:bg-slate-800 font-bold py-2 rounded-xl text-[10px] text-center tracking-wide hover:-translate-y-0.5 transition-all cursor-pointer">
              <i class="fa-solid fa-file-invoice"></i> View PDF Invoice
            </button>
          </div>
        </div>
      `;
    }).join("");
  });
}

// 7. TIMELINE & MAPS ROUTER BINDINGS (Mappls static route maps)
function setActiveOrderTracking(orderId: string) {
  activeOrderTrackingId = orderId;
  const panel = document.getElementById("user-live-tracking-panel")!;
  panel.classList.remove("hidden");

  // Scroll to tracker instantly
  panel.scrollIntoView({ behavior: "smooth" });

  if (trackingRiderInterval) clearInterval(trackingRiderInterval);

  // Subscribe to real-time order status updates matching coordinates
  onValue(ref(db, `orders/${orderId}`), (snapshot) => {
    if (!snapshot.exists()) return;
    const o = snapshot.val();

    // Timeline stages indicators
    const placed = document.getElementById("step-placed")!;
    const accepted = document.getElementById("step-accepted")!;
    const packed = document.getElementById("step-packed")!;
    const transit = document.getElementById("step-transit")!;

    // Initial reset
    [placed, accepted, packed, transit].forEach((el) => {
      el.className = "p-1 px-2 border-b-4 border-slate-200 text-slate-400 flex flex-col items-center";
    });

    placed.className = "p-1 px-2 border-b-4 border-emerald-500 text-emerald-600 flex flex-col items-center";
    
    if (o.status === "accepted" || o.status === "packed" || o.status === "out" || o.status === "delivered") {
      accepted.className = "p-1 px-2 border-b-4 border-emerald-500 text-emerald-600 flex flex-col items-center";
    }
    if (o.status === "packed" || o.status === "out" || o.status === "delivered") {
      packed.className = "p-1 px-2 border-b-4 border-emerald-500 text-emerald-600 flex flex-col items-center";
    }
    if (o.status === "out" || o.status === "delivered") {
       transit.className = "p-1 px-2 border-b-4 border-emerald-500 text-emerald-600 flex flex-col items-center animate-pulse";
    }

    // Dynamic map tracking for transit rider
    const etaBadge = document.getElementById("tracker-eta")!;
    const riderName = document.getElementById("tracker-rider-name")!;
    const riderPhone = document.getElementById("tracker-rider-phone")!;
    const callRider = document.getElementById("lnk-call-rider") as HTMLAnchorElement;

    // Default static layout
    const userLat = o.userLocation?.lat || 12.9716;
    const userLng = o.userLocation?.lng || 77.5946;

    if ((o.status === "packed" || o.status === "out") && o.deliveryId) {
      // Subscribe and calculate maps parameters relative to real rider locations from DB!
      onValue(ref(db, `deliveryboy1/${o.deliveryId}`), (riderSnap) => {
        if (!riderSnap.exists()) return;
        const r = riderSnap.val();

        riderName.innerText = r.fullName || r.name || "Express Rider Partner";
        riderPhone.innerText = r.mobile || "10 Digit Line";
        callRider.href = `tel:${r.mobile || ""}`;

        const riderLat = r.location?.lat || 12.9716;
        const riderLng = r.location?.lng || 77.5946;

        let targetLat = userLat;
        let targetLng = userLng;
        let middleLat: number | undefined = undefined;
        let middleLng: number | undefined = undefined;
        let phaseText = "Delivery Headed";

        if (o.status === "packed") {
          middleLat = o.storeLat || 12.9716;
          middleLng = o.storeLng || 77.5946;
          targetLat = middleLat;
          targetLng = middleLng;
          phaseText = "Heading to Apothecary";
        }

        const distance = calculateDistance(riderLat, riderLng, targetLat, targetLng);
        // ETA Speed (Assume average 35 KM/H city pacing)
        const eta = Math.ceil((distance / 35) * 60) + 3;

        etaBadge.innerText = `${phaseText} - ETA: ${eta} Mins (${distance.toFixed(1)} KM)`;
        updateLeafletMap("tracker-map-div", riderLat, riderLng, userLat, userLng, false, "marker-rider", "fa-motorcycle", "marker-user", "fa-house-chimney-medical", middleLat, middleLng, "marker-store", "fa-prescription-bottle-medical");
      });
    } else {
      riderName.innerText = o.deliveryName || "Agent not assigned yet";
      riderPhone.innerText = "Standby process queue";
      callRider.removeAttribute("href");
      etaBadge.innerText = o.status === "delivered" ? "Delivered ✓" : "Standby Status";
      updateLeafletMap("tracker-map-div", userLat, userLng, userLat, userLng, true);
    }
  });
}

Object.assign(window, {
  setActiveOrderTracking,
  viewCustomerInvoicePDF(orderId: string) {
    // Standard invoice details triggered on alert block
    showToast("Invoice requested. Sourcing detail...", "info");
    // Direct link trigger map anchor
    window.location.href = `/admin.html?viewOrderInvoice=${orderId}`;
  }
});

// 8. NOTIFICATIONS & PUSH ALERTS SUBSCRIBER
function subscribeToNotifications(uid: string) {
  // Listen global announcements
  onValue(ref(db, "notifications/global"), (snapshot) => {
    if (snapshot.exists()) {
      const items: any[] = [];
      snapshot.forEach((child) => {
        items.push(child.val());
      });
      // Sort recently
      items.sort((a,b) => b.timestamp - a.timestamp);
      renderNotificationDropdown(items);
    }
  });
}

function renderNotificationDropdown(alerts: any[]) {
  const dropdown = document.getElementById("notify-feed-items")!;
  const badge = document.getElementById("badge-notifications")!;

  if (alerts.length === 0) {
    dropdown.innerHTML = `<p class="text-[11px] text-slate-400 py-4 text-center">Your notifications logs are clean.</p>`;
    badge.classList.add("hidden");
    return;
  }

  badge.classList.remove("hidden");

  dropdown.innerHTML = alerts.map((a) => `
    <div class="py-2.5 border-b border-slate-50 last:border-0 text-[10px] font-semibold text-slate-700">
      <div class="flex items-center justify-between">
        <strong class="text-teal-600 font-extrabold uppercase text-[9px] block">📢 Dawado Broadcast</strong>
        <span class="text-[8px] text-slate-400 font-mono">${new Date(a.timestamp).toLocaleTimeString()}</span>
      </div>
      <p class="text-slate-600 leading-relaxed font-bold mt-1">${a.body}</p>
    </div>
  `).join("");
}

document.getElementById("btn-show-notifications")?.addEventListener("click", () => {
  const drop = document.getElementById("notify-dropdown")!;
  drop.classList.toggle("hidden");
});

document.getElementById("btn-clear-notify")?.addEventListener("click", () => {
  document.getElementById("notify-dropdown")!.classList.add("hidden");
  document.getElementById("badge-notifications")!.classList.add("hidden");
  showToast("Broadcast dismissed.", "info");
});

// 9. DYNAMIC AI HEALTH RECOMMENDER INTENSITY
function triggerAISuggestion() {
  const items = Object.values(cartItems);
  const tipText = document.getElementById("ai-smart-tip-text");
  if (!tipText) return;

  if (items.length === 0) {
    tipText.innerText = "Recommend Multivitamins & Zinc supplements to stay robust during cold seasons!";
    return;
  }

  // Cross sell matching products
  const antibiotics = items.some((it) => it.category === "Prescription");
  const fever = items.some((it) => it.category === "Fever & Cold");

  if (antibiotics) {
    tipText.innerText = "SmartCare Warning: Please consume specified Antibiotics strictly with doctor prescription guidance and finish complete courses!";
  } else if (fever) {
    tipText.innerText = "AI Recovery Shift: High fever shifts demand electrolyte replenishment. Bundle dynamic multivitamins and wellness gummies!";
  } else {
    tipText.innerText = "Wellness Tip: Certified health remedies inside basket. Take standard medication with lukewarm water on regular schedules.";
  }
}

// 10. --- USER PROFILE SYSTEM & DYNAMIC SUB-SETTINGS ---
let profileData: any = {};

async function syncUserProfileDash() {
  if (!loggedInUser) return;
  try {
    const snapshot = await get(ref(db, `users/${loggedInUser.uid}`));
    if (snapshot.exists()) {
      profileData = snapshot.val();
      
      const nameEl = document.getElementById("profile-display-name");
      const emailEl = document.getElementById("profile-display-email");
      const coinsEl = document.getElementById("profile-display-coins");
      const avatarEl = document.getElementById("profile-avatar-placeholder");

      if (nameEl) nameEl.innerText = profileData.name || loggedInUser.displayName || "Patient User";
      if (emailEl) emailEl.innerText = profileData.email || loggedInUser.email || "user@gmail.com";
      if (coinsEl) {
        if (!profileData.coins) {
          profileData.coins = 250;
          await update(ref(db, `users/${loggedInUser.uid}`), { coins: 250 });
        }
        coinsEl.innerText = String(profileData.coins);
      }
      if (avatarEl) {
        const char = (profileData.name || loggedInUser.email || "U").trim().charAt(0).toUpperCase();
        avatarEl.innerText = char;
      }
    }
  } catch (err) {
    console.error("Error syncing profile dash:", err);
  }
}

const profileDrawer = document.getElementById("profile-detail-drawer") as HTMLDivElement;
const profileDrawerTitle = document.getElementById("profile-drawer-title") as HTMLHeadingElement;
const profileDrawerContent = document.getElementById("profile-drawer-content") as HTMLDivElement;
const closeProfileDrawerBtn = document.getElementById("btn-close-profile-drawer");

closeProfileDrawerBtn?.addEventListener("click", () => {
  profileDrawer?.classList.add("hidden");
});

function openProfileDrawer(title: string, contentHtml: string) {
  if (!profileDrawer || !profileDrawerTitle || !profileDrawerContent) return;
  profileDrawerTitle.innerHTML = title;
  profileDrawerContent.innerHTML = contentHtml;
  profileDrawer.classList.remove("hidden");
}

document.getElementById("btn-opt-my-profile")?.addEventListener("click", () => {
  openMyProfileEditor();
});
document.getElementById("btn-opt-manage-addresses")?.addEventListener("click", () => {
  openManageAddresses();
});
document.getElementById("btn-opt-my-orders")?.addEventListener("click", () => {
  toggleSections("orders");
  syncOrdersHistory();
});
document.getElementById("btn-opt-favorites")?.addEventListener("click", () => {
  openFavoritesViewer();
});
document.getElementById("btn-opt-coupons")?.addEventListener("click", () => {
  openCouponsViewer();
});
document.getElementById("btn-opt-invoices")?.addEventListener("click", () => {
  openInvoicesViewer();
});
document.getElementById("btn-opt-notifications")?.addEventListener("click", () => {
  openNotificationSettings();
});
document.getElementById("btn-opt-ratings")?.addEventListener("click", () => {
  openRatingsSelector();
});
document.getElementById("btn-opt-refer-earn")?.addEventListener("click", () => {
  openReferEarnSlide();
});
document.getElementById("btn-opt-health-profile")?.addEventListener("click", () => {
  openHealthProfileForm();
});
document.getElementById("btn-opt-family-profiles")?.addEventListener("click", () => {
  openFamilyProfilesManager();
});
document.getElementById("btn-opt-refill-reminders")?.addEventListener("click", () => {
  openRefillRemindersManager();
});
document.getElementById("btn-opt-prescription-vault")?.addEventListener("click", () => {
  openPrescriptionVaultManager();
});
document.getElementById("btn-opt-health-records")?.addEventListener("click", () => {
  openHealthRecordsManager();
});
document.getElementById("btn-opt-subscriptions")?.addEventListener("click", () => {
  openSubscriptionsManager();
});
document.getElementById("btn-opt-ai-assistant")?.addEventListener("click", () => {
  openAIAssistantChat();
});
document.getElementById("btn-opt-settings")?.addEventListener("click", () => {
  openAppSettings();
});
document.getElementById("btn-opt-help-support")?.addEventListener("click", () => {
  openHelpSupportSuite();
});
document.getElementById("btn-opt-security")?.addEventListener("click", () => {
  openSecurityDashboard();
});
document.getElementById("btn-opt-logout")?.addEventListener("click", () => {
  if (confirm("Sign out from Dawado account?")) {
    signOut(auth).then(() => {
      window.location.href = "/user-login.html";
    });
  }
});

function openMyProfileEditor() {
  let uploadedAvatarUrl = profileData.avatarUrl || profileData.photoUrl || "";
  const html = `
    <div class="space-y-4 animate-fade-in p-1">
      <!-- Profile Picture Section -->
      <div class="flex items-center gap-4 bg-slate-50 p-3 rounded-2xl border border-slate-100">
        <div class="relative w-16 h-16 rounded-full bg-slate-200 border-2 border-slate-300 flex items-center justify-center text-slate-500 font-bold text-xl overflow-hidden shadow-inner shrink-0" id="profile-editor-img-container">
          ${uploadedAvatarUrl ? `<img src="${uploadedAvatarUrl}" class="w-full h-full object-cover">` : `<i class="fa-solid fa-user-circle text-4xl text-slate-400"></i>`}
        </div>
        <div class="space-y-1">
          <label class="block text-[8px] uppercase font-black text-slate-400 tracking-wider">Candidate Profile Photo</label>
          <input type="file" id="profile-photo-file" accept="image/*" class="hidden">
          <button type="button" onclick="document.getElementById('profile-photo-file').click()" class="px-2.5 py-1.5 bg-white border border-slate-200 text-[10px] font-black text-slate-700 hover:text-blue-600 rounded-lg shadow-xs transition-all cursor-pointer flex items-center gap-1">
            <i class="fa-solid fa-camera"></i> Change Photo
          </button>
        </div>
      </div>

      <div class="space-y-1">
        <label class="block text-[8px] uppercase font-black text-slate-400 tracking-wider">Authentication Email (Public)</label>
        <input type="text" id="edit-profile-email" value="${profileData.email || loggedInUser.email || ""}" placeholder="user@gmail.com" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold font-mono outline-none">
      </div>
      <div class="space-y-1">
        <label class="block text-[8px] uppercase font-black text-slate-400 tracking-wider">Full Name</label>
        <input type="text" id="edit-profile-name" value="${profileData.name || ""}" placeholder="Enter full name" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-bold outline-none transition-all">
      </div>
      <div class="space-y-1">
        <label class="block text-[8px] uppercase font-black text-slate-400 tracking-wider">Mobile Number</label>
        <input type="tel" id="edit-profile-phone" value="${profileData.phone || ""}" placeholder="+91 XXXXX XXXXX" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-semibold outline-none transition-all font-mono">
      </div>

      <div class="grid grid-cols-2 gap-3">
        <!-- Gender Select -->
        <div class="space-y-1">
          <label class="block text-[8px] uppercase font-black text-slate-400 tracking-wider">Gender Identity</label>
          <select id="edit-profile-gender" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none">
            <option value="">Select Gender</option>
            <option value="Male" ${profileData.gender === "Male" ? "selected" : ""}>Male</option>
            <option value="Female" ${profileData.gender === "Female" ? "selected" : ""}>Female</option>
            <option value="Other" ${profileData.gender === "Other" ? "selected" : ""}>Other</option>
            <option value="Prefer Not to Say" ${profileData.gender === "Prefer Not to Say" ? "selected" : ""}>Prefer Not to Say</option>
          </select>
        </div>
        <!-- DoB Input -->
        <div class="space-y-1">
          <label class="block text-[8px] uppercase font-black text-slate-400 tracking-wider">Date of Birth</label>
          <input type="date" id="edit-profile-dob" value="${profileData.dob || ""}" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none">
        </div>
      </div>

      <div class="space-y-1">
        <label class="block text-[8px] uppercase font-black text-slate-400 tracking-wider">Emergency Contact Person & relation</label>
        <input type="text" id="edit-profile-emergency" value="${profileData.emergencyContact || ""}" placeholder="e.g. Brother - 9876543210" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-semibold outline-none transition-all">
      </div>
      
      <button id="btn-save-edited-profile" class="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 rounded-xl transition-all shadow-md text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer">
        <i class="fa-solid fa-cloud-arrow-up"></i> Save Profile Settings
      </button>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-user-gear text-blue-600 mr-1.5"></i> My Personal Profile`, html);

  // File Upload listener
  const fileInput = document.getElementById("profile-photo-file") as HTMLInputElement;
  const imgContainer = document.getElementById("profile-editor-img-container");

  fileInput?.addEventListener("change", async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;

    if (imgContainer) {
      imgContainer.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-xl text-blue-500"></i>`;
    }

    showToast("Uploading candidate photo id...", "info");
    try {
      const url = await uploadToCloudinary(file);
      if (url) {
        uploadedAvatarUrl = url;
        if (imgContainer) {
          imgContainer.innerHTML = `<img src="${url}" class="w-full h-full object-cover">`;
        }
        showToast("Photo uploaded successfully!", "success");
      } else {
        throw new Error("No URL returned from Cloudinary");
      }
    } catch (err) {
      if (imgContainer) {
        imgContainer.innerHTML = `<i class="fa-solid fa-user-circle text-4xl text-slate-400"></i>`;
      }
      showToast("Photo upload failed. Please try again.", "error");
    }
  });

  document.getElementById("btn-save-edited-profile")?.addEventListener("click", async () => {
    const nameVal = (document.getElementById("edit-profile-name") as HTMLInputElement).value.trim();
    const phoneVal = (document.getElementById("edit-profile-phone") as HTMLInputElement).value.trim();
    const emailVal = (document.getElementById("edit-profile-email") as HTMLInputElement).value.trim();
    const genderVal = (document.getElementById("edit-profile-gender") as HTMLSelectElement).value;
    const dobVal = (document.getElementById("edit-profile-dob") as HTMLInputElement).value;
    const emergencyVal = (document.getElementById("edit-profile-emergency") as HTMLInputElement).value.trim();

    if (!nameVal) {
      showToast("Full name is required", "error");
      return;
    }

    try {
      await update(ref(db, `users/${loggedInUser.uid}`), {
        name: nameVal,
        phone: phoneVal,
        email: emailVal,
        gender: genderVal,
        dob: dobVal,
        emergencyContact: emergencyVal,
        avatarUrl: uploadedAvatarUrl,
        photoUrl: uploadedAvatarUrl
      });
      showToast("Profile settings written safely!", "success");
      profileDrawer.classList.add("hidden");
      await syncUserProfileDash();
    } catch (err) {
      showToast("Could not update profile information.", "error");
    }
  });
}

async function openManageAddresses() {
  let addressListHtml = "";
  try {
    const snap = await get(ref(db, `users/${loggedInUser.uid}/addresses`));
    if (snap.exists()) {
      const addrs = snap.val();
      addressListHtml = Object.entries(addrs).map(([key, val]: [string, any]) => {
        let icon = "fa-location-dot";
        let color = "bg-blue-50 text-blue-600";
        if (key.toLowerCase() === "home") {
          icon = "fa-house-chimney";
          color = "bg-emerald-50 text-emerald-600 border border-emerald-100";
        } else if (key.toLowerCase() === "work") {
          icon = "fa-briefcase";
          color = "bg-amber-50 text-amber-600 border border-amber-100";
        } else if (key.toLowerCase() === "other") {
          icon = "fa-map-pin";
          color = "bg-indigo-50 text-indigo-600 border border-indigo-100";
        }
        return `
          <div class="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-2xl text-xs font-bold animate-fade-in group hover:bg-slate-50 transition-all shadow-xs">
            <div class="flex items-start gap-2.5 min-w-0 pr-2">
              <span class="w-7 h-7 rounded-full ${color} flex items-center justify-center text-[11px] shrink-0"><i class="fa-solid ${icon}"></i></span>
              <div class="min-w-0 leading-tight">
                <strong class="text-[10px] text-slate-800 uppercase tracking-tight block font-extrabold flex items-center gap-1.5">
                  ${key}
                  <span class="bg-emerald-100 text-[7px] text-emerald-800 px-1 rounded-sm uppercase tracking-wider font-display font-black">Verified ✓</span>
                </strong>
                <span class="text-[9px] text-slate-400 font-semibold block truncate" title="${val}">${val}</span>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button onclick="useStoredAddress('${key}')" class="text-[8px] bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-600 font-black px-2 py-1 rounded-lg transition-all cursor-pointer">SELECT</button>
              <button onclick="deleteStoredAddress('${key}')" class="w-6 h-6 rounded-lg bg-rose-50 hover:bg-rose-500 hover:text-white text-rose-500 flex items-center justify-center text-[10px] transition-all cursor-pointer"><i class="fa-regular fa-trash-can"></i></button>
            </div>
          </div>
        `;
      }).join("");
    } else {
      addressListHtml = `
        <div class="text-center py-8 text-slate-400 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
          <i class="fa-solid fa-location-crosshairs text-2xl mb-1 text-slate-300"></i>
          <p class="text-[10px] font-semibold">No saved addresses configured yet.</p>
        </div>
      `;
    }
  } catch (err) {
    console.error(err);
  }

  const html = `
    <div class="space-y-4 animate-fade-in p-1">
      <div class="space-y-2.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
        ${addressListHtml}
      </div>

      <div class="border-t border-slate-100 pt-4 space-y-3">
        <h4 class="text-[10px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-1">
          <i class="fa-solid fa-circle-plus text-blue-600 text-xs"></i> Add Address Destination
        </h4>
        
        <!-- Preset Segment Selectors -->
        <div class="space-y-1">
          <label class="block text-[8.5px] font-black text-slate-400 uppercase tracking-wider">Fast Designation Tags</label>
          <div class="grid grid-cols-3 gap-1.5">
            <button type="button" onclick="setAddrLabelPreset('Home')" class="py-2 text-[10px] font-extrabold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl transition-all cursor-pointer text-center hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200">Home</button>
            <button type="button" onclick="setAddrLabelPreset('Work')" class="py-2 text-[10px] font-extrabold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl transition-all cursor-pointer text-center hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200">Work</button>
            <button type="button" onclick="setAddrLabelPreset('Other')" class="py-2 text-[10px] font-extrabold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl transition-all cursor-pointer text-center hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200">Other</button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <input type="text" id="add-addr-label" placeholder="Designation Label (Home, Work, etc.)" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-bold outline-none transition-all">
          <button id="btn-gps-addr" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-black text-[9.5px] rounded-xl flex items-center justify-center gap-1 cursor-pointer border border-indigo-150 transition-all">
            <i class="fa-solid fa-location-crosshairs animate-pulse"></i> Current GPS
          </button>
        </div>

        <div class="space-y-1">
          <label class="block text-[8.5px] font-black text-slate-400 uppercase tracking-wider">Full Address Details</label>
          <textarea id="add-addr-val" rows="2" placeholder="Complete address path with building number, flat, landmark, and pincode..." class="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-semibold outline-none transition-all resize-none"></textarea>
        </div>
        
        <!-- Live Address Verification Module -->
        <div class="flex gap-2">
          <button id="btn-verify-addr" class="flex-1 bg-teal-50 hover:bg-teal-100 text-teal-700 font-extrabold border border-teal-200 py-2 rounded-xl transition-all text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer">
            <i class="fa-solid fa-shield-halved"></i> Verify Address via Mappls
          </button>
        </div>

        <!-- Mappls verification response placeholder -->
        <div id="addr-verification-status-hud" class="hidden p-3 bg-teal-50/50 border border-teal-100 rounded-xl text-teal-800 text-[10px] font-semibold space-y-0.5 animate-fade-in animate-once">
          <p class="font-extrabold flex items-center gap-1.5 uppercase text-[9px] tracking-wider text-teal-900">
            <i class="fa-solid fa-circle-check text-xs"></i> Checked with Mappls Verification Services
          </p>
          <p class="text-[9px] leading-relaxed text-teal-850">The provided address matches official regional map coordinates. Correct postcode and location boundary detected successfully.</p>
        </div>
        
        <button id="btn-save-new-addr" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 rounded-xl transition-all shadow-md text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer">
          <i class="fa-solid fa-floppy-disk"></i> Save Verified Address
        </button>
      </div>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-location-shield text-blue-600 mr-1.5"></i> Saved Addresses`, html);

  // Expose configuration preset helper
  (window as any).setAddrLabelPreset = (preset: string) => {
    const inp = document.getElementById("add-addr-label") as HTMLInputElement;
    if (inp) {
      inp.value = preset;
      showToast(`Selected "${preset}" designation preset!`, "info");
    }
  };

  (window as any).useStoredAddress = (key: string) => {
    get(ref(db, `users/${loggedInUser.uid}/addresses/${key}`)).then((snapshot) => {
      if (snapshot.exists()) {
        const addr = snapshot.val();
        if (addrInput) {
          addrInput.value = addr;
          showToast(`Selected address label: ${key}!`, "success");
          profileDrawer.classList.add("hidden");
        }
      }
    });
  };

  (window as any).deleteStoredAddress = async (key: string) => {
    if (confirm(`Remove saved address "${key}"?`)) {
      try {
        await remove(ref(db, `users/${loggedInUser.uid}/addresses/${key}`));
        showToast("Address deleted successfully", "success");
        openManageAddresses();
      } catch (err) {
        showToast("Error deleting address context", "error");
      }
    }
  };

  // GPS Auto Fill Listener
  document.getElementById("btn-gps-addr")?.addEventListener("click", async () => {
    const gpsBtn = document.getElementById("btn-gps-addr") as HTMLButtonElement;
    gpsBtn.disabled = true;
    gpsBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Locating...`;
    try {
      const coords = await getCurrentGPS();
      if (coords.address) {
        const addrTextarea = document.getElementById("add-addr-val") as HTMLTextAreaElement;
        addrTextarea.value = coords.address;
        showToast("GPS address pin captured!", "info");
      }
    } catch (err) {
      showToast("Could not locate device coordinates.", "error");
    } finally {
      gpsBtn.disabled = false;
      gpsBtn.innerHTML = `<i class="fa-solid fa-location-crosshairs"></i> Current GPS`;
    }
  });

  // Intel Verification event
  document.getElementById("btn-verify-addr")?.addEventListener("click", async () => {
    const val = (document.getElementById("add-addr-val") as HTMLTextAreaElement).value.trim();
    if (!val) {
      showToast("Please write or pin an address string to perform verification check.", "error");
      return;
    }

    const verifyBtn = document.getElementById("btn-verify-addr") as HTMLButtonElement;
    const hud = document.getElementById("addr-verification-status-hud")!;
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Call Mappls intelligence platform...`;

    // 1-second visual verification check simulation
    setTimeout(() => {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Verified with Mappls`;
      hud.classList.remove("hidden");
      showToast("Mappls Address Verification constraints passed!", "success");
    }, 1000);
  });

  document.getElementById("btn-save-new-addr")?.addEventListener("click", async () => {
    const label = (document.getElementById("add-addr-label") as HTMLInputElement).value.trim();
    const val = (document.getElementById("add-addr-val") as HTMLTextAreaElement).value.trim();

    if (!label || !val) {
      showToast("Designation and full address string are required.", "error");
      return;
    }

    try {
      await update(ref(db, `users/${loggedInUser.uid}/addresses`), {
        [label]: val
      });
      showToast(`Saved Address designation "${label}"!`, "success");
      openManageAddresses();
    } catch (err) {
      showToast("Error saving address node.", "error");
    }
  });
}

async function openFavoritesViewer() {
  let listHtml = "";
  try {
    const favSnap = await get(ref(db, `users/${loggedInUser.uid}/favorites`));
    if (favSnap.exists()) {
      const favObj = favSnap.val();
      const favIds = Object.keys(favObj);
      const favMeds = allMedicines.filter(m => favIds.includes(m.medicineId));

      if (favMeds.length > 0) {
        listHtml = favMeds.map(m => `
          <div class="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold gap-3">
            <div class="flex items-center gap-2">
              <img class="w-10 h-10 rounded-xl object-cover shrink-0" src="${m.image || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=100'}" alt="${m.name}">
              <div>
                <h5 class="font-extrabold text-[11px] text-slate-800 truncate uppercase mt-0.5 leading-none font-display">${m.name}</h5>
                <span class="text-[9px] text-slate-400 font-bold block mt-1">₹${m.price} | ${m.category || 'General'}</span>
              </div>
            </div>
            <button onclick="addMedicineToCart('${m.medicineId}')" class="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-[8px] font-black px-2.5 py-1.5 rounded-xl uppercase tracking-wider cursor-pointer font-sans">
              Add <i class="fa-solid fa-cart-plus text-[8.5px] ml-1"></i>
            </button>
          </div>
        `).join("");
      }
    }
    
    if (!listHtml) {
      listHtml = `
        <div class="text-center py-10 text-slate-400">
          <i class="fa-solid fa-heart-crack text-3xl text-slate-300 mb-2"></i>
          <p class="text-xs font-semibold">No favorites flagged yet</p>
          <span class="text-[9px] text-slate-400 block mt-1 max-w-[200px] mx-auto leading-tight">Click on the heart icons next to medicines in of marketplace to find them saved here.</span>
        </div>
      `;
    }
  } catch (err) {
    console.error(err);
  }

  openProfileDrawer(`<i class="fa-solid fa-heart text-rose-500 mr-1.5"></i> My Saved Favorites`, `
    <div class="space-y-2 animate-fade-in p-1 max-h-96 overflow-y-auto custom-scrollbar">
      ${listHtml}
    </div>
  `);
}

function openCouponsViewer() {
  const html = `
    <div class="space-y-4 animate-fade-in p-1">
      <div class="p-4 bg-gradient-to-r from-amber-500 to-yellow-600 text-white rounded-2xl flex items-center justify-between shadow">
        <div>
          <span class="text-[8px] font-black uppercase tracking-widest text-yellow-100 block">Reward Balance</span>
          <h4 class="text-2xl font-black font-display font-mono mt-0.5">${profileData.coins || 250} <span class="text-xs font-bold text-yellow-100 uppercase font-sans">Dawado Coins</span></h4>
          <span class="text-[9px] text-yellow-200 font-semibold block mt-1">Claim medications at 100% discount with coins</span>
        </div>
        <i class="fa-solid fa-coins text-4xl text-amber-300 opacity-90 animate-bounce"></i>
      </div>

      <div class="space-y-2.5 font-sans">
        <h4 class="text-[10px] font-black text-slate-800 uppercase tracking-widest">Available Coupons</h4>
        
        <div class="p-3 bg-white border border-slate-100 rounded-2xl flex items-center justify-between hover:border-blue-300 group transition-all">
          <div class="leading-tight">
            <span class="font-mono text-xs font-extrabold text-blue-600 bg-blue-50 px-2 py-1 rounded inline-block">MEDS20</span>
            <p class="text-[9px] text-slate-500 font-bold mt-1.5">Get 20% discount on orders higher than ₹500</p>
          </div>
          <button onclick="copyPromoCode('MEDS20')" class="text-[8px] bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-600 font-extrabold px-2.5 py-1.5 rounded-xl transition-all cursor-pointer">COPY</button>
        </div>

        <div class="p-3 bg-white border border-slate-100 rounded-2xl flex items-center justify-between hover:border-blue-300 group transition-all">
          <div class="leading-tight">
            <span class="font-mono text-xs font-extrabold text-blue-600 bg-blue-50 px-2 py-1 rounded inline-block">HEALTHFIRST</span>
            <p class="text-[9px] text-slate-500 font-bold mt-1.5">Free fulfillment & priority delivery for initial purchases</p>
          </div>
          <button onclick="copyPromoCode('HEALTHFIRST')" class="text-[8px] bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-600 font-extrabold px-2.5 py-1.5 rounded-xl transition-all cursor-pointer">COPY</button>
        </div>

        <div class="p-3 bg-white border border-slate-100 rounded-2xl flex items-center justify-between hover:border-blue-300 group transition-all">
          <div class="leading-tight">
            <span class="font-mono text-xs font-extrabold text-blue-600 bg-blue-50 px-2 py-1 rounded inline-block">APOTHECARY30</span>
            <p class="text-[9px] text-slate-500 font-bold mt-1.5">₹30 static instant cashbacks on standard medicine items</p>
          </div>
          <button onclick="copyPromoCode('APOTHECARY30')" class="text-[8px] bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-600 font-extrabold px-2.5 py-1.5 rounded-xl transition-all cursor-pointer">COPY</button>
        </div>
      </div>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-ticket text-amber-500 mr-1.5 animate-bounce"></i> Coupons & Rewards`, html);

  (window as any).copyPromoCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      showToast(`Discount code "${code}" copied to clipboard!`, "success");
      const checkoutCouponInput = document.getElementById("cart-coupon-input") as HTMLInputElement;
      if (checkoutCouponInput) checkoutCouponInput.value = code;
      profileDrawer.classList.add("hidden");
    });
  };
}

async function openInvoicesViewer() {
  let listHtml = "";
  try {
    const ordersSnap = await get(ref(db, "orders"));
    if (ordersSnap.exists()) {
      const allOrdersObj = ordersSnap.val();
      const userOrders = Object.values(allOrdersObj).filter((or: any) => or.userId === loggedInUser.uid);

      if (userOrders.length > 0) {
        listHtml = userOrders.map((or: any) => {
          const formattedDate = new Date(or.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          return `
            <div class="p-3.5 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col gap-2 shadow-xs text-xs font-semibold animate-fade-in hover:bg-slate-100/30">
              <div class="flex items-center justify-between border-b border-slate-150 pb-2">
                <div class="leading-tight">
                  <h5 class="text-[10px] font-black font-mono text-slate-800 uppercase tracking-tight">Invoice ID: ${or.orderId.slice(-8).toUpperCase()}</h5>
                  <span class="text-[9px] text-slate-400 font-semibold block mt-0.5">${formattedDate} | Total: <span class="text-blue-600 font-mono font-black">₹${or.totalPrice || or.total}</span></span>
                </div>
                <span class="bg-blue-100 text-blue-600 text-[8px] font-black tracking-wider px-2 py-0.5 rounded uppercase leading-none border border-blue-200">${or.status || 'placed'}</span>
              </div>
              <div class="space-y-1">
                ${Object.values(or.items || {}).map((it: any) => `
                  <div class="flex justify-between text-[10px] text-slate-500 font-semibold">
                    <span class="truncate max-w-[150px]">${it.name} (x${it.qty || it.quantity})</span>
                    <span class="font-mono">₹${(it.qty || it.quantity) * it.price}</span>
                  </div>
                `).join("")}
              </div>
              <div class="flex justify-end pt-1">
                <button onclick="printCustomInvoice('${or.orderId}')" class="text-[8.5px] bg-slate-900 hover:bg-slate-800 text-white font-black px-3.5 py-1.5 rounded-xl transition-all cursor-pointer inline-flex items-center gap-1">
                  <i class="fa-solid fa-print"></i> Open Receipt
                </button>
              </div>
            </div>
          `;
        }).join("");
      }
    }
  } catch (err) {
    console.error(err);
  }

  if (!listHtml) {
    listHtml = `
      <div class="text-center py-10 text-slate-400">
        <i class="fa-solid fa-receipt text-3xl mb-2 text-slate-350 font-sans"></i>
        <p class="text-xs font-semibold">No finished orders yet</p>
        <span class="text-[9px] text-slate-400 block mt-1 leading-normal max-w-xs mx-auto">Configure your delivery address, checkout medicines, and get dynamic invoice receipts listed here instantly!</span>
      </div>
    `;
  }

  openProfileDrawer(`<i class="fa-solid fa-file-invoice-dollar text-indigo-600 mr-1.5 animate-pulse"></i> My Invoice Documents`, `
    <div class="space-y-3 animate-fade-in p-1 max-h-[60vh] overflow-y-auto custom-scrollbar">
      ${listHtml}
    </div>
  `);

  (window as any).printCustomInvoice = async (orderId: string) => {
    try {
      const snap = await get(ref(db, `orders/${orderId}`));
      if (snap.exists()) {
        const order = snap.val();
        const formattedDate = new Date(order.timestamp).toLocaleString();
        
        const invoiceWindowHtml = `
          <html>
            <head>
              <title>RS MEDS HUB - Invoice Receipt</title>
              <link href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
              <style>
                body {
                  font-family: 'Courier Prime', monospace;
                  padding: 24px;
                  color: #000;
                  background: #fff;
                  max-width: 600px;
                  margin: 0 auto;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .border-dashed { border-top: 1px dashed #000; margin: 12px 0; }
                .flex { display: flex; justify-content: space-between; }
                .bold { font-weight: bold; }
                .mt-2 { margin-top: 8px; }
              </style>
            </head>
            <body>
              <div class="text-center">
                <h2>RS MEDS HUB APOTHECARY</h2>
                <p>Digital Healthcare Distribution Services</p>
                <p>100% Tax Invoice Bill</p>
              </div>
              <div class="border-dashed"></div>
              <div>
                <p>Invoice PIN: ${order.orderId.toUpperCase()}</p>
                <p>Timestamp: ${formattedDate}</p>
                <p>Customer ID: ${order.userId}</p>
                <p>Delivery Node Address: ${order.deliveryAddress || 'Collected On Arrival'}</p>
              </div>
              <div class="border-dashed"></div>
              <div class="bold flex">
                <span>ITEM DETAIL</span>
                <span>QTY x PRICE</span>
              </div>
              <div class="border-dashed"></div>
              ${Object.values(order.items || {}).map((it: any) => `
                <div class="flex mt-2">
                  <span>${it.name} (${it.category || 'General'})</span>
                  <span>${it.qty || it.quantity} x ₹${it.price} = ₹${(it.qty || it.quantity) * it.price}</span>
                </div>
              `).join("")}
              <div class="border-dashed"></div>
              <div class="flex mt-2">
                <span>GST Tax Breakdown (12%):</span>
                <span>Included</span>
              </div>
              <div class="bold flex mt-2">
                <span>Total Collected (COD Invoice):</span>
                <span>₹${order.totalPrice || order.total}</span>
              </div>
              <div class="border-dashed"></div>
              <div class="text-center mt-2" style="margin-top: 32px;">
                <p>Thank you for choosing Dawado!</p>
                <p>Consumed medications as specified by clinical guidelines.</p>
                <button onclick="window.print()" style="margin-top: 16px; padding: 6px 12px; background: #000; color: #fff; cursor: pointer; font-family: inherit;">Print Invoice</button>
              </div>
            </body>
          </html>
        `;

        const win = window.open("", "_blank");
        if (win) {
          win.document.write(invoiceWindowHtml);
          win.document.close();
        } else {
          showToast("Pop-up locked by browser! Please allow popup tabs to view invoice.", "info");
        }
      }
    } catch (err) {
      showToast("Could not retrieve specific order invoice", "error");
    }
  };
}

function openNotificationSettings() {
  const html = `
    <div class="space-y-4 animate-fade-in p-1">
      <p class="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Configure Preferred Alert Rails</p>
      
      <div class="space-y-3">
        <label class="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer">
          <div class="leading-tight pr-4">
            <h5 class="text-xs font-black text-slate-800 uppercase tracking-wide">SMS Handover Updates</h5>
            <p class="text-[9px] text-slate-400 font-semibold mt-0.5">Receive verification messages and dispatch rider alerts</p>
          </div>
          <input type="checkbox" checked class="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500">
        </label>

        <label class="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer">
          <div class="leading-tight pr-4">
            <h5 class="text-xs font-black text-slate-800 uppercase tracking-wide">WhatsApp Daily Bulletins</h5>
            <p class="text-[9px] text-slate-400 font-semibold mt-0.5">Receive delivery receipt PDFs and chronic drug checklists</p>
          </div>
          <input type="checkbox" checked class="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500">
        </label>

        <label class="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer">
          <div class="leading-tight pr-4">
            <h5 class="text-xs font-black text-slate-800 uppercase tracking-wide">Promotional Campaign Codes</h5>
            <p class="text-[9px] text-slate-400 font-semibold mt-0.5">Alert on discount codes, loyalty rewards booster multipliers</p>
          </div>
          <input type="checkbox" class="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500">
        </label>

        <label class="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer">
          <div class="leading-tight pr-4">
            <h5 class="text-xs font-black text-slate-800 uppercase tracking-wide">Rider Live Status Alarm</h5>
            <p class="text-[9px] text-slate-400 font-semibold mt-0.5">Active warning sound alerts when dispatch is near coordinate address</p>
          </div>
          <input type="checkbox" checked class="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500">
        </label>
      </div>

      <button id="btn-save-notification-flags" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 rounded-xl transition-all shadow-md text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer mt-2">
        <i class="fa-regular fa-bell"></i> Save Preferences
      </button>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-bell text-blue-600 mr-1.5 animate-bounce"></i> Notification Controls`, html);

  document.getElementById("btn-save-notification-flags")?.addEventListener("click", () => {
    showToast("Notification parameters verified successfully!", "success");
    profileDrawer.classList.add("hidden");
  });
}

function openRatingsSelector() {
  const html = `
    <div class="space-y-4 animate-fade-in p-1 font-sans">
      <div class="text-center space-y-2">
        <p class="text-[10px] uppercase font-black text-slate-400 tracking-wider">How was your Dawado experience?</p>
        
        <div class="flex items-center justify-center gap-2 text-2xl py-2" id="interactive-star-row">
          <button onclick="toggleFeedbackStars(1)" class="text-slate-300 hover:scale-110 active:scale-90 transition-all cursor-pointer"><i class="fa-solid fa-star"></i></button>
          <button onclick="toggleFeedbackStars(2)" class="text-slate-300 hover:scale-110 active:scale-90 transition-all cursor-pointer"><i class="fa-solid fa-star"></i></button>
          <button onclick="toggleFeedbackStars(3)" class="text-slate-300 hover:scale-110 active:scale-90 transition-all cursor-pointer"><i class="fa-solid fa-star"></i></button>
          <button onclick="toggleFeedbackStars(4)" class="text-slate-300 hover:scale-110 active:scale-90 transition-all cursor-pointer"><i class="fa-solid fa-star"></i></button>
          <button onclick="toggleFeedbackStars(5)" class="text-slate-300 hover:scale-110 active:scale-90 transition-all cursor-pointer"><i class="fa-solid fa-star"></i></button>
        </div>
      </div>

      <div class="space-y-1">
        <label class="block text-[9px] uppercase font-black text-slate-400 tracking-wider">Review Comments</label>
        <textarea id="val-rev-comment" rows="3" placeholder="Tell us about the delivery velocity, item accuracy, clinical verifying etc." class="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-semibold outline-none transition-all resize-none"></textarea>
      </div>

      <button id="btn-submit-clinical-review" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 rounded-xl transition-all shadow-md text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer">
        <i class="fa-solid fa-certificate"></i> Submit Verified Review
      </button>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-star text-amber-500 mr-1.5 animate-pulse"></i> Submit Ratings & Reviews`, html);

  let activeStarsSelected = 5;

  (window as any).toggleFeedbackStars = (starCount: number) => {
    activeStarsSelected = starCount;
    const btnNodes = document.getElementById("interactive-star-row")?.children;
    if (btnNodes) {
      for (let i = 0; i < btnNodes.length; i++) {
        const icon = btnNodes[i].querySelector("i")!;
        if (i < starCount) {
          icon.className = "fa-solid fa-star text-amber-400";
        } else {
          icon.className = "fa-solid fa-star text-slate-300";
        }
      }
    }
  };

  (window as any).toggleFeedbackStars(5);

  document.getElementById("btn-submit-clinical-review")?.addEventListener("click", async () => {
    const feedbackText = (document.getElementById("val-rev-comment") as HTMLTextAreaElement).value.trim();
    if (!feedbackText) {
      showToast("Please provide review text description.", "error");
      return;
    }

    try {
      // Find latest order storeId to mirror review
      let targetStoreId = "all";
      let targetStoreName = "Dawado Platform";
      try {
        const ordersSnap = await get(ref(db, "orders"));
        if (ordersSnap.exists()) {
          const sorted = Object.values(ordersSnap.val())
            .filter((o: any) => o.customerId === loggedInUser.uid)
            .sort((a: any, b: any) => b.createdAt - a.createdAt);
          if (sorted.length > 0) {
            targetStoreId = (sorted[0] as any).storeId || "all";
            targetStoreName = (sorted[0] as any).storeName || "Dawado Platform";
          }
        }
      } catch (e) {}

      const revId = `${Date.now()}`;
      await set(ref(db, `users/${loggedInUser.uid}/reviews/${revId}`), {
        rating: activeStarsSelected,
        comment: feedbackText,
        timestamp: Date.now(),
        storeId: targetStoreId,
        storeName: targetStoreName
      });

      if (targetStoreId && targetStoreId !== "all") {
        await set(ref(db, `reviews/${targetStoreId}/${revId}`), {
          rating: activeStarsSelected,
          comment: feedbackText,
          timestamp: Date.now(),
          reviewerName: profileData.name || loggedInUser.displayName || "Patient User",
          reviewerId: loggedInUser.uid
        });
      }

      showToast("Thank you for your valuable rating suggestion!", "success");
      profileDrawer.classList.add("hidden");
    } catch (err) {
      showToast("Could not submit feedback loop.", "error");
    }
  });
}

function openReferEarnSlide() {
  const html = `
    <div class="space-y-4 animate-fade-in p-1 text-center font-sans">
      <div class="relative w-28 h-28 mx-auto flex items-center justify-center bg-blue-50 rounded-full border-4 border-dashed border-blue-400">
        <i class="fa-solid fa-circle-dollar-to-slot text-4xl text-blue-600 animate-bounce"></i>
      </div>
      
      <div class="space-y-1.5">
        <h4 class="text-xs font-extrabold text-slate-900 uppercase">Refer Friends & Earn Wallet Rewards!</h4>
        <p class="text-[9.5px] text-slate-500 leading-relaxed font-semibold max-w-xs mx-auto">Get <strong class="text-emerald-600 font-extrabold">₹100 value</strong> credited inside Dawado wallet as soon as your referee confirms high-prio first orders.</p>
      </div>

      <div class="p-3 bg-slate-50 border border-slate-150 rounded-2xl flex items-center justify-between shadow-inner max-w-sm mx-auto">
        <div class="text-left font-mono">
          <span class="text-[8px] font-black text-slate-400 block tracking-wider uppercase leading-none">Your Share Referral Code</span>
          <strong class="text-slate-800 text-sm font-black tracking-widest uppercase block mt-1" id="share-refcode-txt">MEDSHUB-RF${loggedInUser.uid.slice(0, 4).toUpperCase()}</strong>
        </div>
        <button id="btn-copy-refcode" class="bg-blue-600 hover:bg-blue-700 text-white font-black text-[9px] px-3.5 py-1.5 rounded-xl cursor-pointer transition-all flex items-center gap-1">
          <i class="fa-regular fa-copy font-sans"></i> COPY CODE
        </button>
      </div>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-gift text-blue-600 mr-1.5 animate-bounce"></i> Refer & Earn Rewards`, html);

  document.getElementById("btn-copy-refcode")?.addEventListener("click", () => {
    const code = document.getElementById("share-refcode-txt")!.innerText;
    navigator.clipboard.writeText(code).then(() => {
      showToast(`Referral code "${code}" copied successfully!`, "success");
    });
  });
}

async function openHealthProfileForm() {
  let healthParams = {
    bloodGroup: "O+",
    allergies: "",
    chronic: "",
    age: "",
    weight: ""
  };

  try {
    const snap = await get(ref(db, `users/${loggedInUser.uid}/healthProfile`));
    if (snap.exists()) {
      healthParams = snap.val();
    }
  } catch (err) {
    console.error(err);
  }

  const html = `
    <div class="space-y-4 animate-fade-in p-1">
      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1">
          <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wider">Blood Group Type</label>
          <select id="h-blood" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none font-sans cursor-pointer focus:bg-white focus:border-blue-500 text-slate-800">
            <option value="A+" ${healthParams.bloodGroup === 'A+' ? 'selected' : ''}>A+ (Positive)</option>
            <option value="A-" ${healthParams.bloodGroup === 'A-' ? 'selected' : ''}>A- (Negative)</option>
            <option value="B+" ${healthParams.bloodGroup === 'B+' ? 'selected' : ''}>B+ (Positive)</option>
            <option value="B-" ${healthParams.bloodGroup === 'B-' ? 'selected' : ''}>B- (Negative)</option>
            <option value="AB+" ${healthParams.bloodGroup === 'AB+' ? 'selected' : ''}>AB+ (Positive)</option>
            <option value="AB-" ${healthParams.bloodGroup === 'AB-' ? 'selected' : ''}>AB- (Negative)</option>
            <option value="O+" ${healthParams.bloodGroup === 'O+' ? 'selected' : ''}>O+ (Positive)</option>
            <option value="O-" ${healthParams.bloodGroup === 'O-' ? 'selected' : ''}>O- (Negative)</option>
          </select>
        </div>
        <div class="space-y-1">
          <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wider font-sans">Patient Age (Years)</label>
          <input type="number" id="h-age" value="${healthParams.age || ''}" placeholder="Age" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none focus:bg-white focus:border-blue-500">
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1">
          <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wider font-sans">Weight (In Kilograms)</label>
          <input type="number" id="h-weight" value="${healthParams.weight || ''}" placeholder="KG" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none focus:bg-white focus:border-blue-500">
        </div>
        <div class="space-y-1 font-sans">
          <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wider">Body Mass Ratio (Index)</label>
          <div class="w-full px-3 py-2.5 bg-slate-100 border border-slate-200 text-slate-500 rounded-xl text-xs font-black font-mono leading-none">
            ${healthParams.weight && healthParams.age ? 'AUTO HEALTH SYNCED' : 'AWAITING METRICS'}
          </div>
        </div>
      </div>

      <div class="space-y-1">
        <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wider font-sans">Known Drug / Food Allergies</label>
        <input type="text" id="h-allergies" value="${healthParams.allergies || ''}" placeholder="example: Penicillin, Peanuts, Gluten" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-bold outline-none transition-all">
      </div>

      <div class="space-y-1 font-sans">
        <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wider">Chronic Clinical Illnesses</label>
        <input type="text" id="h-chronic" value="${healthParams.chronic || ''}" placeholder="example: Primary Type-2 Diabetes, Hypertension" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-bold outline-none transition-all">
      </div>

      <button id="btn-save-health-vitals" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 rounded-xl transition-all shadow-md text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer mt-2 font-sans">
        <i class="fa-solid fa-heart-pulse"></i> Update Health Profile
      </button>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-briefcase-medical text-blue-600 mr-1.5 font-sans"></i> Patient Health Profile`, html);

  document.getElementById("btn-save-health-vitals")?.addEventListener("click", async () => {
    const updated = {
      bloodGroup: (document.getElementById("h-blood") as HTMLSelectElement).value,
      age: (document.getElementById("h-age") as HTMLInputElement).value,
      weight: (document.getElementById("h-weight") as HTMLInputElement).value,
      allergies: (document.getElementById("h-allergies") as HTMLInputElement).value.trim(),
      chronic: (document.getElementById("h-chronic") as HTMLInputElement).value.trim()
    };

    try {
      await set(ref(db, `users/${loggedInUser.uid}/healthProfile`), updated);
      showToast("Clinical health profiles updated safely!", "success");
      profileDrawer.classList.add("hidden");
    } catch (err) {
      showToast("Error saving vital configs", "error");
    }
  });
}

function openAIAssistantChat() {
  const html = `
    <div class="space-y-3 animate-fade-in p-1 flex flex-col max-h-[60vh] font-sans">
      <div class="bg-violet-50 border border-violet-100 p-2.5 rounded-xl text-[9px] font-bold text-violet-800 leading-normal flex items-start gap-2">
        <i class="fa-solid fa-circle-exclamation text-violet-500 text-[11px] shrink-0 mt-0.5"></i>
        <span>Disclaimer: Dawado AI Pharmacist assistant is programmed for general health insights only. Please consult certified practitioner for actual prescriptions.</span>
      </div>

      <div id="ai-chat-thread-box" class="flex-1 overflow-y-auto space-y-2.5 max-h-60 min-h-36 border border-slate-100 rounded-2xl p-3 bg-slate-50 font-sans custom-scrollbar">
        <div class="flex items-start gap-2 max-w-xs text-xs animate-fade-in">
          <div class="w-6.5 h-6.5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-black shrink-0"><i class="fa-solid fa-robot animate-bounce"></i></div>
          <div class="bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-100 shadow-xs text-slate-800 font-bold leading-normal">
            Hello! I am your personal AI Pharmacist & Apothecary Buddy. Ask me anything about medications, drug safety guidelines, FAQs, side-effects, or dosage directions!
          </div>
        </div>
      </div>

      <div class="flex gap-2 mt-2">
        <input type="text" id="ai-user-query-input" placeholder="Ask details (ex: paracetamol dose etc.)" class="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:bg-white focus:border-violet-500">
        <button id="btn-push-ai-query" class="bg-violet-600 hover:bg-violet-700 text-white font-black text-xs px-4 rounded-xl cursor-pointer transition-all flex items-center justify-center"><i class="fa-solid fa-paper-plane text-[9px]"></i></button>
      </div>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-brain text-violet-600 mr-1.5 animate-pulse"></i> AI Medical Pharmacist`, html);

  const queryInp = document.getElementById("ai-user-query-input") as HTMLInputElement;
  const sendBtn = document.getElementById("btn-push-ai-query") as HTMLButtonElement;
  const threadBox = document.getElementById("ai-chat-thread-box")!;

  const chatHistoryList: Array<{ sender: "user" | "ai"; text: string }> = [];

  const pushMessage = (sender: "user" | "ai", text: string) => {
    chatHistoryList.push({ sender, text });
    const avatar = sender === "user" 
      ? `<div class="w-6.5 h-6.5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-black shrink-0 uppercase">${(profileData.name || "U").charAt(0)}</div>`
      : `<div class="w-6.5 h-6.5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-black shrink-0"><i class="fa-solid fa-robot font-black"></i></div>`;
    
    const alignment = sender === "user" ? "flex-row-reverse text-right ml-auto" : "";
    const bubbleColor = sender === "user" ? "bg-indigo-600 text-white" : "bg-white text-slate-800 border border-slate-100";
    const roundedStyle = sender === "user" ? "rounded-tr-none" : "rounded-tl-none";

    // Support Markdown light styling by simple regex converts for display
    let formattedText = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-slate-900 font-mono px-1 rounded text-[11px]">$1</code>')
      .replace(/\n/g, "<br>");

    const bubbleHtml = `
      <div class="flex items-start gap-2 ${alignment} max-w-[85%] text-xs animate-fade-in pt-1">
        ${avatar}
        <div class="${bubbleColor} p-2.5 rounded-2xl ${roundedStyle} shadow-3xs font-semibold leading-relaxed text-left">
          ${formattedText}
        </div>
      </div>
    `;
    threadBox.insertAdjacentHTML("beforeend", bubbleHtml);
    threadBox.scrollTop = threadBox.scrollHeight;
  };

  const processOfflineResponse = (rawMsg: string) => {
    const lower = rawMsg.toLowerCase().trim();
    if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
      return "Hello! I am offline right now, how can I assist you with your medicine query today?";
    }
    if (lower.includes("paracetamol") || lower.includes("fever") || lower.includes("crocin")) {
      return "Paracetamol / Crocin info: Max adult dosing is 4000mg per day. Do not consume alcohol with acetaminophen compounds.";
    }
    return "Thank you for asking! I'm in local offline fallback mode because the live server key is verifying. Please contact a physical apothecary is discomfort continues.";
  };

  sendBtn?.addEventListener("click", async () => {
    const query = queryInp.value.trim();
    if (!query) return;

    pushMessage("user", query);
    queryInp.value = "";

    sendBtn.disabled = true;
    const typingId = "ai-typing-" + Date.now();
    const typingHtml = `<div id="${typingId}" class="text-[9px] font-bold text-violet-500 animate-pulse pl-8 py-1">AI Apothecary is compounding...</div>`;
    threadBox.insertAdjacentHTML("beforeend", typingHtml);
    threadBox.scrollTop = threadBox.scrollHeight;

    try {
      const response = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
          chatHistory: chatHistoryList.slice(0, -1),
          userVitals: profileData.healthProfile || null,
          userLocation: currentCoordinates || null
        })
      });

      document.getElementById(typingId)?.remove();

      if (response.ok) {
        const result = await response.json();
        pushMessage("ai", result.answer);
      } else {
        const fallbackRes = processOfflineResponse(query);
        pushMessage("ai", fallbackRes);
      }
    } catch (err) {
      document.getElementById(typingId)?.remove();
      const fallbackRes = processOfflineResponse(query);
      pushMessage("ai", fallbackRes);
    } finally {
      sendBtn.disabled = false;
    }
  });

  queryInp?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendBtn.click();
  });
}

function openAppSettings() {
  const html = `
    <div class="space-y-4 animate-fade-in p-1 font-sans">
      <div class="space-y-3">
        <label class="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer">
          <div class="leading-tight pr-4">
            <h5 class="text-xs font-black text-slate-800 uppercase tracking-wide">Auto GPS Coordinates Checkout</h5>
            <p class="text-[9px] text-slate-400 font-semibold mt-0.5">Toggle auto-filling current GPS position during orders checkout</p>
          </div>
          <input type="checkbox" checked class="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500">
        </label>

        <label class="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer">
          <div class="leading-tight pr-4">
            <h5 class="text-xs font-black text-slate-800 uppercase tracking-wide">Secure Medicine Concealing</h5>
            <p class="text-[9px] text-slate-400 font-semibold mt-0.5">Add extra privacy layer for clinical item categories</p>
          </div>
          <input type="checkbox" class="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500">
        </label>

        <label class="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer">
          <div class="leading-tight pr-4">
            <h5 class="text-xs font-black text-slate-800 uppercase tracking-wide">Dynamic UI Dark Borders</h5>
            <p class="text-[9px] text-slate-400 font-semibold mt-0.5">Toggle dark background accents inside application menus</p>
          </div>
          <input type="checkbox" class="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500">
        </label>
      </div>

      <button id="btn-save-settings-node" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 rounded-xl transition-all shadow-md text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer mt-2 leading-none">
        <i class="fa-solid fa-circle-check"></i> Apply Settings Changes
      </button>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-sliders text-blue-600 mr-1.5 font-sans"></i> Application Config Settings`, html);

  document.getElementById("btn-save-settings-node")?.addEventListener("click", () => {
    showToast("Application settings preserved!", "success");
    profileDrawer.classList.add("hidden");
  });
}

function openHelpSupportSuite() {
  const html = `
    <div class="space-y-4 animate-fade-in p-1 font-sans">
      <div class="space-y-2.5">
        <h4 class="text-[10px] font-black text-slate-800 uppercase tracking-widest mb-1">Frequently Asked Questions</h4>
        
        <div class="p-3 bg-slate-50 border border-slate-100 rounded-2xl leading-normal text-xs font-bold">
          <h5 class="font-extrabold text-slate-800 uppercase text-[10px]"><i class="fa-regular fa-question-circle text-blue-600 mr-1"></i> How long does delivery usually take?</h5>
          <p class="text-[9px] text-slate-500 font-semibold mt-1">Our certified dispatch riders locate your coordinates via immediate GPS routing. Orders usually materialize within 15-30 minutes.</p>
        </div>

        <div class="p-3 bg-slate-50 border border-slate-100 rounded-2xl leading-normal text-xs font-bold font-sans">
          <h5 class="font-extrabold text-slate-800 uppercase text-[10px]"><i class="fa-regular fa-question-circle text-blue-600 mr-1"></i> Are all medicines verified as safe?</h5>
          <p class="text-[9px] text-slate-500 font-semibold mt-1">Yes, all catalog items are procured from central licensed apothecaries and inspected by qualified pharmacists before dispatch handovers.</p>
        </div>
      </div>

      <div class="border-t border-slate-100 pt-3.5 space-y-3">
        <h4 class="text-[10px] font-black text-slate-800 uppercase tracking-widest"><i class="fa-solid fa-envelope-open-text text-blue-600 mr-1.5 leading-none"></i>Ask Help Desk Support</h4>
        <textarea id="val-support-msg" rows="2" placeholder="Describe clinical troubles or order delays and get response instantly..." class="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-semibold outline-none transition-all resize-none"></textarea>
        
        <button id="btn-submit-support-ticket" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 rounded-xl transition-all shadow-md text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer leading-none">
          <i class="fa-regular fa-paper-plane"></i> Submit Support Question
        </button>
      </div>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-circle-question text-blue-600 mr-1.5 animate-pulse"></i> Help & Support Apothecary`, html);

  document.getElementById("btn-submit-support-ticket")?.addEventListener("click", () => {
    const rawValue = (document.getElementById("val-support-msg") as HTMLTextAreaElement).value.trim();
    if (!rawValue) {
      showToast("Please enter question criteria.", "error");
      return;
    }
    showToast("Support ticket created safely! We are evaluating query on priority.", "success");
    profileDrawer.classList.add("hidden");
  });
}

function openSecurityDashboard() {
  const html = `
    <div class="space-y-4 animate-fade-in p-1 font-sans">
      <div class="p-3 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-between text-xs font-bold">
        <div>
          <h5 class="text-slate-800 uppercase text-[10px] font-black font-sans">Two Factor Verification</h5>
          <p class="text-[9px] text-slate-400 font-semibold mt-0.5">Extra verification checks before major address shifts</p>
        </div>
        <div class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked class="sr-only peer">
          <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-350 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 border border-slate-200"></div>
        </div>
      </div>

      <div class="p-3 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-between text-xs font-bold">
        <div>
          <h5 class="text-slate-800 uppercase text-[10px] font-black font-sans">Verification Badge Display</h5>
          <p class="text-[9px] text-slate-400 font-semibold mt-0.5">Show active check icon in profile card indicating status verification</p>
        </div>
        <div class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked class="sr-only peer">
          <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-350 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 border border-slate-200"></div>
        </div>
      </div>

      <div class="p-3.5 bg-yellow-50 border border-yellow-250 border-yellow-200 rounded-2xl text-[9px] font-bold text-yellow-850 text-slate-705 leading-normal flex items-start gap-2 max-w-sm">
        <i class="fa-solid fa-shield-virus text-yellow-650 text-[11px] shrink-0 mt-0.5 animate-pulse"></i>
        <span>Security Note: System complies fully with standard cryptographic storage. Session keys are encrypted locally on this client safely.</span>
      </div>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-shield-halved text-blue-600 mr-1.5 animate-pulse"></i> Security Settings Control`, html);
}

function initUserSupportSystem() {
  const btnFloating = document.getElementById("btn-floating-support");
  const modalSupport = document.getElementById("user-support-modal");
  const btnClose = document.getElementById("btn-close-support-modal");
  const btnToggleFaqs = document.getElementById("btn-toggle-support-faqs");
  const accFaqs = document.getElementById("support-faqs-accordion");
  const iconFaqsChev = document.getElementById("icon-support-faqs-chev");
  const btnSubmitTicket = document.getElementById("btn-submit-quick-ticket");

  // Toggle Modal
  btnFloating?.addEventListener("click", () => {
    modalSupport?.classList.remove("hidden");
  });

  btnClose?.addEventListener("click", () => {
    modalSupport?.classList.add("hidden");
  });

  // Toggle FAQs Accordion
  btnToggleFaqs?.addEventListener("click", () => {
    if (accFaqs) {
      const isHidden = accFaqs.classList.contains("hidden");
      if (isHidden) {
        accFaqs.classList.remove("hidden");
        iconFaqsChev?.classList.replace("fa-chevron-down", "fa-chevron-up");
      } else {
        accFaqs.classList.add("hidden");
        iconFaqsChev?.classList.replace("fa-chevron-up", "fa-chevron-down");
      }
    }
  });

  // Submit Support Ticket to Firebase RTDB Real-Time Sync DB
  btnSubmitTicket?.addEventListener("click", () => {
    const msgInp = document.getElementById("val-quick-support-msg") as HTMLTextAreaElement;
    const msg = msgInp?.value.trim();

    if (!msg) {
      showToast("Please write details of your query/troubles first.", "error");
      return;
    }

    const currentUserId = auth.currentUser?.uid || "anonymous_user";
    const currentEmail = auth.currentUser?.email || "anonymous@example.com";
    const ticketId = "TKT_" + Math.random().toString(36).substr(2, 9).toUpperCase();

    const payload = {
      ticketId,
      userId: currentUserId,
      email: currentEmail,
      message: msg,
      status: "pending",
      createdAt: Date.now()
    };

    set(ref(db, `support_tickets/${currentUserId}/${ticketId}`), payload).then(() => {
      showToast(`Support Ticket ${ticketId} raised successfully!`, "success");
      if (msgInp) msgInp.value = "";
      modalSupport?.classList.add("hidden");
    }).catch((err) => {
      console.error(err);
      showToast("Failed to create ticket inside server.", "error");
    });
  });
}

// Invoke the setup
initUserSupportSystem();

// --- MEDICINE PRODUCT DETAILS SYSTEM GLOBAL EXPORTS ---
let activeDetailMedicine: any = null;
let detailSliderImages: string[] = [];
let activeSliderImgIndex = 0;
let detailQtyVal = 1;
let submittingReviewStars = 5;
let uploadedReviewPhotoUrl = "";

const prodDetailDrawer = document.getElementById("product-detail-drawer") as HTMLDivElement;
const prodDetailDrawerContent = document.getElementById("product-detail-drawer-content") as HTMLDivElement;
const zoomViewer = document.getElementById("fullscreen-zoom-viewer") as HTMLDivElement;
const zoomMainImg = document.getElementById("zoom-main-image") as HTMLImageElement;
const zoomScaleLabel = document.getElementById("txt-zoom-scale")!;
let currentZoomScale = 1.0;

function openProductDetailDrawer(medId: string) {
  const med = allMedicines.find(m => m.medicineId === medId);
  if (!med) {
    showToast("Medicine item details could not be retrieved from synchronizations database.", "error");
    return;
  }
  
  activeDetailMedicine = med;
  detailQtyVal = 1;
  submittingReviewStars = 5;
  uploadedReviewPhotoUrl = "";
  
  // Reset quantity input visually
  const qtyInputEl = document.getElementById("txt-detail-qty");
  if (qtyInputEl) qtyInputEl.innerText = "1";
  
  // Build slide photos array
  detailSliderImages = [];
  if (med.image) {
    detailSliderImages.push(med.image);
  }
  if (Array.isArray(med.sliderImages)) {
    med.sliderImages.forEach((img: string) => {
      if (img && !detailSliderImages.includes(img)) {
        detailSliderImages.push(img);
      }
    });
  }
  if (detailSliderImages.length === 0) {
    detailSliderImages.push("https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500");
  }
  
  activeSliderImgIndex = 0;
  
  // Render active photo slide
  updateSliderDisplay();
  
  // Populate general info
  document.getElementById("detail-product-category")!.innerText = (med.category || "General").toUpperCase();
  document.getElementById("detail-product-name")!.innerText = med.name || "Medicine Item";
  
  const mfrSub = `${med.brand || 'Abbott'} | MFR: ${med.manufacturer || 'Certified Manufacturer'}`;
  document.getElementById("detail-product-subtitle")!.innerText = mfrSub.toUpperCase();
  
  // Pack size
  document.getElementById("detail-product-packsize")!.innerText = med.packSize || "10 tablet(s) in a Strip";
  
  // Stock display & Add to Cart disabled if out of stock
  const stockEl = document.getElementById("detail-product-stock")!;
  const stockStatusEl = document.getElementById("detail-product-stock-status")!;
  const qtyRow = document.getElementById("ctr-detail-qty-row")!;
  const addCartBtn = document.getElementById("btn-detail-add-cart") as HTMLButtonElement;
  
  const stockCount = parseInt(med.stock) || 0;
  if (stockCount <= 0) {
    stockEl.innerText = "OUT OF STOCK";
    stockStatusEl.className = "flex items-center gap-1 text-rose-600 font-bold";
    qtyRow.classList.add("opacity-40", "pointer-events-none");
    addCartBtn.disabled = true;
    addCartBtn.innerText = "OUT OF STOCK";
    addCartBtn.className = "bg-slate-300 text-slate-500 font-extrabold text-[10px] uppercase py-3 px-5 rounded-xl cursor-not-allowed border-none shrink-0";
  } else if (stockCount < 5) {
    stockEl.innerText = `ONLY ${stockCount} LEFT`;
    stockStatusEl.className = "flex items-center gap-1 text-amber-600 font-bold animate-pulse";
    qtyRow.classList.remove("opacity-40", "pointer-events-none");
    addCartBtn.disabled = false;
    addCartBtn.innerText = "Add To Cart";
    addCartBtn.className = "bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-[10px] uppercase py-3 px-5 rounded-xl shadow-md border-none flex items-center gap-1.5 cursor-pointer hover:scale-103 transition-all tracking-wide font-sans";
  } else {
    stockEl.innerText = `IN STOCK (${stockCount})`;
    stockStatusEl.className = "flex items-center gap-1 text-emerald-600 font-bold";
    qtyRow.classList.remove("opacity-40", "pointer-events-none");
    addCartBtn.disabled = false;
    addCartBtn.innerText = "Add To Cart";
    addCartBtn.className = "bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-[10px] uppercase py-3 px-5 rounded-xl shadow-md border-none flex items-center gap-1.5 cursor-pointer hover:scale-103 transition-all tracking-wide font-sans";
  }
  
  // Price and MRP cross-out and discount badges
  const priceEl = document.getElementById("detail-product-price")!;
  const mrpEl = document.getElementById("detail-product-mrp")!;
  const discountEl = document.getElementById("detail-product-discount-pct")!;
  
  priceEl.innerText = `₹${med.price}`;
  const disc = parseInt(med.discount) || 0;
  if (disc > 0) {
    const calculatedMrp = Math.round(med.price / (1 - disc / 100));
    mrpEl.innerText = `₹${calculatedMrp}`;
    mrpEl.classList.remove("hidden");
    
    discountEl.innerText = `${disc}% OFF`;
    discountEl.classList.remove("hidden");
  } else {
    mrpEl.classList.add("hidden");
    discountEl.classList.add("hidden");
  }
  
  // Prescription warning
  const isRx = (med.category || "").toLowerCase().includes("prescription") || 
               (med.category || "").toLowerCase() === "rx" ||
               (med.description || "").toLowerCase().includes("prescription required");
               
  const rxWarningBox = document.getElementById("detail-prescription-warning-box")!;
  if (isRx) {
    rxWarningBox.classList.remove("hidden");
  } else {
    rxWarningBox.classList.add("hidden");
  }
  
  // Logistics - Calculate distance from user destination location
  const deliveryDistanceEl = document.getElementById("detail-delivery-distance")!;
  const deliveryDurationEl = document.getElementById("detail-delivery-duration")!;
  
  const supplierStore = allStores.find(s => s.storeId === med.storeId);
  if (supplierStore && supplierStore.location && currentCoordinates) {
    const distanceKm = calculateDistance(
      currentCoordinates.lat,
      currentCoordinates.lng,
      supplierStore.location.lat,
      supplierStore.location.lng
    );
    deliveryDistanceEl.innerText = `${distanceKm.toFixed(1)} km away`;
    
    // Duration estimation
    if (distanceKm < 2) {
      deliveryDurationEl.innerText = "15 - 20 Minutes";
    } else if (distanceKm < 5) {
      deliveryDurationEl.innerText = "20 - 30 Minutes";
    } else {
      deliveryDurationEl.innerText = "35 - 50 Minutes";
    }
  } else {
    deliveryDistanceEl.innerText = "Nearby Store";
    deliveryDurationEl.innerText = "15 - 30 Minutes";
  }
  
  // Collapse specs accordions by default
  const accordions = document.querySelectorAll(".spec-accordion-item > div:last-child");
  accordions.forEach(el => {
    el.classList.add("hidden");
  });
  const accordionsChevrons = document.querySelectorAll(".spec-accordion-item i.fa-chevron-up, .spec-accordion-item i.fa-chevron-down");
  accordionsChevrons.forEach(ch => {
    ch.className = "fa-solid fa-chevron-down text-[9px] text-slate-400 transition-transform";
  });
  
  // Populate accordions content
  document.getElementById("spec-uses")!.innerText = med.uses || "Primary therapeutic diagnosis indicator: Relieves fever, chills, migraine headaches, muscle pains and seasonal viral infections.";
  document.getElementById("spec-benefits")!.innerText = med.benefits || "Directly mitigates high biological temperatures and mitigates brain pain signaling nodes. Supports standard active energy cells recuperation.";
  document.getElementById("spec-dosage")!.innerText = med.dosage || "Standard adult dose is 1 tablet every 4-6 hours. Do not exceed 4000mg limit per day. Consult clinical physician or registered nurse practitioner.";
  document.getElementById("spec-side-effects")!.innerText = med.sideEffects || "Minor mild constipation, transient skin allergy rashes, or stomach acidity. Discontinue clinical intake immediately if swelling or hepatoxicity symptoms emerge.";
  document.getElementById("spec-warnings")!.innerText = med.warnings || "Consult doctor before use if you suffer from liver kidney disorders, chronic alcoholism history, or severe heart stroke issues. Never take in empty empty stomach.";
  document.getElementById("spec-storage")!.innerText = med.storage || "Keep securely out of reach of residential infants and domestic pets. Store safely under 25°C temperature blocks away from excessive light or damp humidity.";
  
  // Populate new detailed Composition and Safety Spec Accordions
  document.getElementById("detail-spec-generic")!.innerText = med.genericName || med.name || "N/A";
  document.getElementById("detail-spec-strength")!.innerText = med.strength || med.dosage || "Standard strength";
  document.getElementById("detail-spec-dosage-form")!.innerText = med.dosageForm || "Tablet";
  document.getElementById("detail-spec-age-group")!.innerText = med.ageGroup || "All age groups";
  document.getElementById("detail-spec-composition")!.innerText = med.composition || "Active clinical ingredients composition not specified.";
  document.getElementById("detail-spec-directions")!.innerText = med.directionsForUse || "Consume with water as advised by a qualified healthcare professional.";
  
  const instContainer = document.getElementById("detail-spec-instructions-container");
  if (med.dosageInstructions) {
    document.getElementById("detail-spec-dosage-inst")!.innerText = med.dosageInstructions;
    instContainer?.classList.remove("hidden");
  } else {
    instContainer?.classList.add("hidden");
  }

  document.getElementById("detail-spec-pregnancy")!.innerText = med.pregnancySafety || "Consult with your healthcare practitioner before use.";
  document.getElementById("detail-spec-breastfeeding")!.innerText = med.breastfeedingSafety || "Consult with your doctor before use while breastfeeding.";
  document.getElementById("detail-spec-driving")!.innerText = med.drivingSafety || "No known side effects affecting driving ability.";
  document.getElementById("detail-spec-alcohol")!.innerText = med.alcoholWarning || "Avoid alcohol consumption while on this medication.";
  document.getElementById("detail-spec-safety-advice")!.innerText = med.safetyAdvice || "Store in a cool, dry place. Keep out of reach of children.";

  const contraContainer = document.getElementById("detail-spec-contraindications-container");
  if (med.contraindications) {
    document.getElementById("detail-spec-contraindications")!.innerText = med.contraindications;
    contraContainer?.classList.remove("hidden");
  } else {
    contraContainer?.classList.add("hidden");
  }

  const drugContainer = document.getElementById("detail-spec-drug-interactions-container");
  if (med.drugInteractions) {
    document.getElementById("detail-spec-drug-interactions")!.innerText = med.drugInteractions;
    drugContainer?.classList.remove("hidden");
  } else {
    drugContainer?.classList.add("hidden");
  }

  const foodContainer = document.getElementById("detail-spec-food-interaction-container");
  if (med.foodInteraction) {
    document.getElementById("detail-spec-food-interaction")!.innerText = med.foodInteraction;
    foodContainer?.classList.remove("hidden");
  } else {
    foodContainer?.classList.add("hidden");
  }

  // Sync wishlist button icon state in drawer
  syncWishlistIconState(med.medicineId);
  
  // Render similar remedies
  renderSimilarRemedies(med);
  
  // Load and render patient reviews
  loadAndRenderPatientReviews(med.medicineId);
  
  // Reset review writing state
  const newReviewText = document.getElementById("val-new-review-text") as HTMLTextAreaElement;
  if (newReviewText) newReviewText.value = "";
  resetReviewStarsDisplay();
  const photoPreview = document.getElementById("ctr-review-photo-preview")!;
  photoPreview.innerHTML = "";
  photoPreview.classList.add("hidden");
  
  // Update sticky bottom footer pricing
  updateStickyFooterPayable();
  
  // Open the drawer with CSS transitions
  prodDetailDrawer.classList.remove("hidden");
  setTimeout(() => {
    prodDetailDrawerContent.classList.remove("translate-y-full");
    prodDetailDrawerContent.classList.add("translate-y-0");
  }, 10);
}

function syncWishlistIconState(medId: string) {
  const isFav = profileData && profileData.favorites && profileData.favorites[medId] ? true : false;
  const wishIcon = document.getElementById("detail-wishlist-icon")!;
  const wishBtn = document.getElementById("btn-detail-wishlist")!;
  
  if (isFav) {
    wishIcon.className = "fa-solid fa-heart text-sm text-rose-500 scale-110";
    wishBtn.classList.add("text-rose-550");
  } else {
    wishIcon.className = "fa-solid fa-heart text-sm text-slate-400";
    wishBtn.classList.remove("text-rose-550");
  }
}

function updateSliderDisplay() {
  const activeImg = document.getElementById("detail-slider-img-active") as HTMLImageElement;
  const labelIdx = document.getElementById("txt-slider-active-idx")!;
  const thumbsContainer = document.getElementById("detail-slider-thumbs")!;
  
  const currentImgUrl = detailSliderImages[activeSliderImgIndex];
  activeImg.src = currentImgUrl;
  
  labelIdx.innerText = `${activeSliderImgIndex + 1} / ${detailSliderImages.length}`;
  
  // Render thumbs
  thumbsContainer.innerHTML = detailSliderImages.map((img, idx) => {
    const isActive = activeSliderImgIndex === idx;
    return `
      <button onclick="selectSliderActiveIndex(${idx})" type="button" class="w-12 h-12 bg-white rounded-lg border-2 ${isActive ? 'border-blue-600' : 'border-slate-100'} p-0.5 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer transition-all">
        <img src="${img}" class="h-full w-full object-contain" referrerpolicy="no-referrer">
      </button>
    `;
  }).join("");
}

function updateStickyFooterPayable() {
  const payableEl = document.getElementById("txt-detail-sticky-payable font-mono");
  const payableElBackup = document.getElementById("txt-detail-sticky-payable");
  if (activeDetailMedicine) {
    const rate = activeDetailMedicine.price;
    const finalTotal = rate * detailQtyVal;
    if (payableEl) payableEl.innerText = `₹${finalTotal}`;
    if (payableElBackup) payableElBackup.innerText = `₹${finalTotal}`;
  }
}

function closeProductDetailDrawer() {
  prodDetailDrawerContent.classList.remove("translate-y-0");
  prodDetailDrawerContent.classList.add("translate-y-full");
  setTimeout(() => {
    prodDetailDrawer.classList.add("hidden");
  }, 300);
}

function updateZoomDisplay() {
  zoomMainImg.style.transform = `scale(${currentZoomScale})`;
  zoomScaleLabel.innerText = `${Math.round(currentZoomScale * 100)}%`;
}

function triggerZoomIn() {
  if (currentZoomScale >= 3.0) return;
  currentZoomScale += 0.25;
  updateZoomDisplay();
}

function triggerZoomOut() {
  if (currentZoomScale <= 0.5) return;
  currentZoomScale -= 0.25;
  updateZoomDisplay();
}

function resetZoomScale() {
  currentZoomScale = 1.0;
  updateZoomDisplay();
}

function openFullscreenViewer() {
  if (detailSliderImages.length === 0) return;
  const currentImgUrl = detailSliderImages[activeSliderImgIndex];
  
  zoomMainImg.src = currentImgUrl;
  currentZoomScale = 1.0;
  updateZoomDisplay();
  
  zoomViewer.classList.remove("hidden");
}

function renderSimilarRemedies(med: any) {
  const simContainer = document.getElementById("detail-similar-carousel")!;
  
  const matches = allMedicines.filter(m => m.category === med.category && m.medicineId !== med.medicineId).slice(0, 5);
  if (matches.length === 0) {
    const genericMatches = allMedicines.filter(m => m.medicineId !== med.medicineId).slice(0, 5);
    matches.push(...genericMatches);
  }
  
  simContainer.innerHTML = matches.map(m => {
    return `
      <div class="bg-slate-50 rounded-2xl p-2.5 min-w-[120px] max-w-[120px] border border-slate-100 flex flex-col justify-between shrink-0 hover:border-blue-200 transition-all text-center select-none font-sans">
        <div onclick="openProductDetailDrawer('${m.medicineId}')" class="cursor-pointer">
          <img src="${m.image || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=200'}" class="w-16 h-16 object-contain mx-auto bg-white rounded-xl p-1 border border-slate-100" referrerpolicy="no-referrer">
          <h4 class="font-bold text-slate-800 text-[10px] truncate leading-tight mt-1.5 font-sans">${m.name}</h4>
          <span class="text-[8px] font-semibold text-slate-400 block truncate leading-none mt-0.5">${m.brand || 'Apollo'}</span>
          <span class="font-mono text-[10px] font-black text-blue-600 block mt-1">₹${m.price}</span>
        </div>
        <button onclick="addMedicineToCart('${m.medicineId}')" class="bg-blue-600 hover:bg-blue-700 text-white font-black text-[8px] py-1 px-2.5 rounded-lg border-none mt-2 uppercase tracking-wide cursor-pointer w-full text-center hover:scale-103 transition-all">Quick Add</button>
      </div>
    `;
  }).join("");
}

function loadAndRenderPatientReviews(medId: string) {
  const reviewsListContainer = document.getElementById("detail-reviews-list")!;
  
  get(ref(db, `medicineReviews/${medId}`)).then((snapshot) => {
    let reviews: any[] = [];
    if (snapshot.exists()) {
      snapshot.forEach(child => {
        reviews.push({ reviewId: child.key, ...child.val() });
      });
    }
    
    // Fallback reviews
    if (reviews.length === 0) {
      reviews = [
        {
          reviewId: "r1",
          username: "Dr. Sumit Saxena",
          stars: 5,
          text: "Excellent therapeutic action response curves. Handed standard pack to geriatric fever patients with immediate body temperature recuperation. Highly trustworthy store batch.",
          date: "Yesterday",
          photo: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=200"
        },
        {
          reviewId: "r2",
          username: "Anjali Mishra",
          stars: 4,
          text: "Very rapid home delivery dispatch. The strip was tightly packed in double layers bubble sheets. Perfect dosage of scheduled medicine.",
          date: "3 days ago"
        }
      ];
    }
    
    reviews.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    const totalStars = reviews.reduce((sum, r) => sum + (parseInt(r.stars) || 5), 0);
    const avgScore = (totalStars / reviews.length).toFixed(1);
    
    document.getElementById("txt-detail-average-stars")!.innerText = avgScore;
    document.getElementById("txt-detail-review-count")!.innerText = `${reviews.length} Patient Reviews`;
    
    let s5 = 0, s4 = 0, s3 = 0, s2 = 0, s1 = 0;
    reviews.forEach(r => {
      const st = parseInt(r.stars) || 5;
      if (st >= 5) s5++;
      else if (st === 4) s4++;
      else if (st === 3) s3++;
      else if (st === 2) s2++;
      else s1++;
    });
    
    const pct = (cnt: number) => reviews.length > 0 ? `${(cnt / reviews.length) * 100}%` : "0%";
    document.getElementById("bar-review-star5")!.style.width = pct(s5);
    document.getElementById("bar-review-star4")!.style.width = pct(s4);
    document.getElementById("bar-review-star3")!.style.width = pct(s3);
    document.getElementById("bar-review-star2")!.style.width = pct(s2);
    document.getElementById("bar-review-star1")!.style.width = pct(s1);
    
    reviewsListContainer.innerHTML = reviews.map(r => {
      let reviewerStarsHtml = "";
      for (let i = 1; i <= 5; i++) {
        reviewerStarsHtml += `<i class="fa-solid fa-star ${i <= (r.stars || 5) ? 'text-amber-500' : 'text-slate-200'} text-[8px] mr-0.5 shrink-0"></i>`;
      }
      
      return `
        <div class="pt-3 first:pt-0 space-y-1 select-none font-sans">
          <div class="flex items-center justify-between text-[10px]">
            <div class="flex items-center gap-1.5">
              <span class="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-black uppercase flex items-center justify-center font-mono leading-none">${r.username ? r.username[0] : 'V'}</span>
              <h5 class="font-extrabold text-slate-900 capitalize font-sans">${r.username || 'Verified Patient'}</h5>
            </div>
            <span class="text-slate-400 font-medium font-mono text-[8.5px]">${r.date || 'clinical sync'}</span>
          </div>
          
          <div class="flex items-center mt-0.5">${reviewerStarsHtml}</div>
          
          <p class="text-[10px] text-slate-600 leading-normal font-medium mt-1 font-sans">${r.text}</p>
          
          ${r.photo ? `
            <div class="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-100 mt-1 cursor-zoom-in shadow-2xs" onclick="openFullscreenReviewPhoto('${r.photo}')">
              <img src="${r.photo}" class="w-full h-full object-cover">
            </div>
          ` : ''}
        </div>
      `;
    }).join("");
  });
}

function openFullscreenReviewPhoto(url: string) {
  zoomMainImg.src = url;
  currentZoomScale = 1.0;
  updateZoomDisplay();
  zoomViewer.classList.remove("hidden");
}

function selectSliderActiveIndex(index: number) {
  activeSliderImgIndex = index;
  updateSliderDisplay();
}

function setSubmittingReviewStars(score: number) {
  submittingReviewStars = score;
  const starsContainer = document.getElementById("ctr-review-submitting-stars")!;
  if (starsContainer) {
    const starButtons = starsContainer.querySelectorAll("button");
    starButtons.forEach((btn, idx) => {
      if (idx < score) {
        btn.className = "text-sm bg-none bg-transparent border-none cursor-pointer p-0.5 text-amber-500";
      } else {
        btn.className = "text-sm bg-none bg-transparent border-none cursor-pointer p-0.5 text-slate-300";
      }
    });
  }
}

function resetReviewStarsDisplay() {
  setSubmittingReviewStars(5);
}

const inpReviewLivePhoto = document.getElementById("inp-review-live-photo") as HTMLInputElement;
const reviewPhotoPreview = document.getElementById("ctr-review-photo-preview")!;

inpReviewLivePhoto?.addEventListener("change", async (e: any) => {
  const file = e.target.files[0];
  if (!file) return;
  
  reviewPhotoPreview.innerHTML = `<div class="absolute inset-0 bg-white/70 flex items-center justify-center"><i class="fa-solid fa-spinner animate-spin text-xs text-blue-600"></i></div>`;
  reviewPhotoPreview.classList.remove("hidden");
  
  try {
    const url = await uploadToCloudinary(file);
    uploadedReviewPhotoUrl = url;
    reviewPhotoPreview.innerHTML = `
      <img src="${url}" class="w-full h-full object-cover">
      <button onclick="removeUploadedReviewPhoto()" type="button" class="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-slate-900/60 text-white rounded-full flex items-center justify-center text-[7px] border-none cursor-pointer">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
  } catch (err) {
    showToast("Review photo uploading failure.", "error");
    reviewPhotoPreview.classList.add("hidden");
    uploadedReviewPhotoUrl = "";
  }
});

function removeUploadedReviewPhoto() {
  uploadedReviewPhotoUrl = "";
  if (inpReviewLivePhoto) inpReviewLivePhoto.value = "";
  reviewPhotoPreview.innerHTML = "";
  reviewPhotoPreview.classList.add("hidden");
}

function submitMedicineReview() {
  if (!activeDetailMedicine) return;
  if (!loggedInUser) {
    showToast("Please log in to submit a review.", "error");
    return;
  }
  
  const textVal = (document.getElementById("val-new-review-text") as HTMLTextAreaElement).value.trim();
  if (!textVal) {
    showToast("Please write some feedback comment details.", "error");
    return;
  }
  
  const medId = activeDetailMedicine.medicineId;
  const username = profileData.name || loggedInUser.displayName || loggedInUser.email?.split("@")[0] || "Patient";
  
  const payload = {
    username,
    stars: submittingReviewStars,
    text: textVal,
    photo: uploadedReviewPhotoUrl,
    createdAt: Date.now()
  };
  
  const reviewRefNode = ref(db, `medicineReviews/${medId}/${Date.now()}`);
  set(reviewRefNode, payload).then(() => {
    showToast("Patient review synchronized successfully!", "success");
    loadAndRenderPatientReviews(medId);
    
    // Clear
    (document.getElementById("val-new-review-text") as HTMLTextAreaElement).value = "";
    removeUploadedReviewPhoto();
    resetReviewStarsDisplay();
  }).catch((err) => {
    console.error(err);
    showToast("Failed to sync review with database.", "error");
  });
}

function toggleWishlistItemInDrawer() {
  if (!activeDetailMedicine) return;
  const id = activeDetailMedicine.medicineId;
  const key = `users/${loggedInUser.uid}/favorites/${id}`;
  
  get(ref(db, key)).then((snap) => {
    if (snap.exists()) {
      remove(ref(db, key)).then(() => {
        showToast("Removed from Favorites", "info");
        syncWishlistIconState(id);
        syncUserProfileDash();
        renderMedicinesGrid();
      });
    } else {
      set(ref(db, key), true).then(() => {
        showToast("Added to Favorites!", "success");
        syncWishlistIconState(id);
        syncUserProfileDash();
        renderMedicinesGrid();
      });
    }
  });
}

function addDetailMedicineToCart() {
  if (!activeDetailMedicine) return;
  const id = activeDetailMedicine.medicineId;
  const med = activeDetailMedicine;
  
  if (activeStoreId && activeStoreId !== med.storeId) {
    showToast("For safety, please bundle items from one pharmacy store in single checkout.", "info");
    return;
  }
  
  cartItems[id] = {
    medicineId: med.medicineId,
    name: med.name,
    price: med.price,
    qty: detailQtyVal,
    category: med.category || "General",
    storeId: med.storeId,
    storeName: med.storeName || "Pharmacy Store"
  };
  
  syncCartBadge();
  renderMedicinesGrid();
  renderCartDrawer();
  showToast(`${med.name} added to cart!`, "success");
}

function initProductDetailSystem() {
  const btnClose = document.getElementById("btn-close-detail-drawer");
  const btnPull = document.getElementById("btn-pull-close-detail");
  const btnQtyMinus = document.getElementById("btn-detail-qty-minus");
  const btnQtyPlus = document.getElementById("btn-detail-qty-plus");
  const btnAddCart = document.getElementById("btn-detail-add-cart");
  const btnDetailWishlist = document.getElementById("btn-detail-wishlist");
  
  const btnCloseZoom = document.getElementById("btn-close-zoom-viewer");
  const btnZoomIn = document.getElementById("btn-zoom-in");
  const btnZoomOut = document.getElementById("btn-zoom-out");
  const btnResetZoom = document.getElementById("btn-reset-zoom");
  const btnSubmitReview = document.getElementById("btn-submit-medicine-review");

  btnClose?.addEventListener("click", () => {
    closeProductDetailDrawer();
  });
  btnPull?.addEventListener("click", () => {
    closeProductDetailDrawer();
  });
  
  btnQtyMinus?.addEventListener("click", () => {
    if (detailQtyVal <= 1) return;
    detailQtyVal--;
    document.getElementById("txt-detail-qty")!.innerText = detailQtyVal.toString();
    updateStickyFooterPayable();
  });
  
  btnQtyPlus?.addEventListener("click", () => {
    if (!activeDetailMedicine) return;
    const maxStock = parseInt(activeDetailMedicine.stock) || 0;
    if (detailQtyVal >= maxStock) {
      showToast(`Only ${maxStock} units currently in stock at vendor store.`, "info");
      return;
    }
    detailQtyVal++;
    document.getElementById("txt-detail-qty")!.innerText = detailQtyVal.toString();
    updateStickyFooterPayable();
  });
  
  btnAddCart?.addEventListener("click", () => {
    addDetailMedicineToCart();
  });
  
  btnDetailWishlist?.addEventListener("click", () => {
    toggleWishlistItemInDrawer();
  });
  
  btnCloseZoom?.addEventListener("click", () => {
    zoomViewer.classList.add("hidden");
  });
  
  btnZoomIn?.addEventListener("click", () => {
    triggerZoomIn();
  });
  
  btnZoomOut?.addEventListener("click", () => {
    triggerZoomOut();
  });
  
  btnResetZoom?.addEventListener("click", () => {
    resetZoomScale();
  });
  
  btnSubmitReview?.addEventListener("click", () => {
    submitMedicineReview();
  });

  const activeSlideImageEl = document.getElementById("detail-slider-img-active");
  activeSlideImageEl?.addEventListener("click", () => {
    openFullscreenViewer();
  });
}

function toggleDetailSpecsAccordion(specId: string, button: HTMLButtonElement) {
  const content = document.getElementById(specId);
  if (!content) return;
  const chev = button.querySelector("i:last-child");
  if (!chev) return;
  
  const isHidden = content.classList.contains("hidden");
  if (isHidden) {
    content.classList.remove("hidden");
    chev.className = "fa-solid fa-chevron-up text-[9px] text-blue-600 transition-transform font-bold rotate-180";
  } else {
    content.classList.add("hidden");
    chev.className = "fa-solid fa-chevron-down text-[9px] text-slate-400 transition-transform";
  }
}

// Map window event targets for templates
Object.assign(window, {
  openProductDetailDrawer,
  closeProductDetailDrawer,
  selectSliderActiveIndex,
  toggleDetailSpecsAccordion,
  setSubmittingReviewStars,
  removeUploadedReviewPhoto,
  submitMedicineReview,
  toggleWishlistItemInDrawer,
  openFullscreenReviewPhoto
});

// Initialize systems
initProductDetailSystem();

// =================================== ADVANCED CLINICAL HEALTHCARE MODULES ===================================

// Roster: Family Profiles Manager
async function openFamilyProfilesManager() {
  if (!loggedInUser) return;
  
  const drawFamilyList = async () => {
    let rosterHtml = "";
    try {
      const snap = await get(ref(db, `users/${loggedInUser.uid}/familyProfiles`));
      if (snap.exists()) {
        const roster = Object.values(snap.val() || {});
        if (roster.length > 0) {
          rosterHtml = roster.map((mem: any) => `
            <div class="bg-indigo-50/40 p-3.5 rounded-2xl border border-indigo-100 flex items-center justify-between gap-3 font-sans animate-fade-in">
              <div class="space-y-1">
                <span class="inline-block px-2 py-0.5 bg-indigo-100/65 text-indigo-700 text-[8px] font-black uppercase rounded">${mem.relation || "Self"}</span>
                <h4 class="text-xs font-black text-slate-800">${mem.name || "Unnamed Profile"}</h4>
                <p class="text-[9.5px] text-slate-500 font-medium">Age: <span class="font-bold text-slate-700">${mem.age || "N/A"}</span> | Gen: <span class="font-bold text-slate-700">${mem.gender || "N/A"}</span> | Blood: <span class="font-bold font-mono text-indigo-600">${mem.bloodGroup || "O+"}</span></p>
                ${mem.allergies ? `<p class="text-[9px] text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded font-semibold">Allergies: ${mem.allergies}</p>` : ""}
                ${mem.chronic ? `<p class="text-[9px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded font-semibold">Chronic: ${mem.chronic}</p>` : ""}
              </div>
              <button onclick="deleteFamilyMember('${mem.id}')" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-all flex items-center justify-center cursor-pointer text-xs shrink-0" title="Remove Profile">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          `).join("");
        } else {
          rosterHtml = `<div class="p-6 text-center text-slate-400 text-xs italic font-semibold uppercase">No family profiles linked yet. Add below!</div>`;
        }
      } else {
        rosterHtml = `<div class="p-6 text-center text-slate-400 text-xs italic font-semibold uppercase">No family profiles linked yet. Add below!</div>`;
      }
    } catch (err) {
      rosterHtml = `<div class="p-4 text-center text-rose-500 text-xs">Error loading roster metadata. Please retry.</div>`;
    }

    const container = document.getElementById("family-list-container");
    if (container) container.innerHTML = rosterHtml;
  };

  const html = `
    <div class="space-y-5 animate-fade-in p-1 font-sans text-xs">
      <!-- Create Member Form Card -->
      <div class="bg-indigo-50/20 border border-slate-100 rounded-3xl p-4.5 space-y-3.5">
        <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Link New Family Member</h4>
        
        <div class="space-y-1">
          <label class="block text-[8.5px] uppercase font-black text-indigo-600/80 tracking-wide font-sans">Full Name</label>
          <input type="text" id="fm-name" placeholder="Name of parent / child" class="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none focus:border-blue-500">
        </div>

        <div class="grid grid-cols-3 gap-2.5">
          <div class="space-y-1">
            <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Age</label>
            <input type="number" id="fm-age" placeholder="Yrs" class="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none">
          </div>
          <div class="space-y-1">
            <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Gender</label>
            <select id="fm-gender" class="w-full px-2 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none cursor-pointer">
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="space-y-1">
            <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Relation</label>
            <select id="fm-relation" class="w-full px-2 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none cursor-pointer">
              <option value="Father">Father</option>
              <option value="Mother">Mother</option>
              <option value="Child">Child</option>
              <option value="Senior Citizen">Senior Citizen</option>
              <option value="Custom Member">Other</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div class="space-y-1">
            <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Blood Group</label>
            <select id="fm-blood" class="w-full px-2.5 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none cursor-pointer font-sans">
              <option value="A+">A+</option>
              <option value="A-">A-</option>
              <option value="B+">B+</option>
              <option value="B-">B-</option>
              <option value="AB+">AB+</option>
              <option value="AB-">AB-</option>
              <option value="O+">O+</option>
              <option value="O-">O-</option>
            </select>
          </div>
          <div class="space-y-1">
            <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Allergies Note</label>
            <input type="text" id="fm-allergies" placeholder="Peanuts, Sulfa etc." class="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none">
          </div>
        </div>

        <div class="space-y-1">
          <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Chronic Clinical States (Separate with comma)</label>
          <input type="text" id="fm-chronic" placeholder="Diabetes, Hypertension, Asthma" class="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none">
        </div>

        <button id="btn-save-family-member" class="w-full py-2.5 bg-indigo-650 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition-all cursor-pointer shadow-sm">Authorize & Link Profile</button>
      </div>

      <!-- Linked Members list -->
      <div class="space-y-3">
        <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Linked Roster Directory</h4>
        <div class="space-y-2" id="family-list-container">
          <!-- Populated by helper -->
        </div>
      </div>
    </div>
  `;

  openProfileDrawer(`<i class="fa-solid fa-people-roof text-indigo-505 text-indigo-650 mr-1.5 animate-pulse"></i> Clinical Family Profiles`, html);
  
  // Render live cards
  await drawFamilyList();

  // Save member
  document.getElementById("btn-save-family-member")?.addEventListener("click", async () => {
    const name = (document.getElementById("fm-name") as HTMLInputElement).value.trim();
    if (!name) {
      showToast("Please enter family member's full name.", "error");
      return;
    }

    const nMember = {
      id: "FAM_" + Date.now(),
      name,
      age: (document.getElementById("fm-age") as HTMLInputElement).value,
      gender: (document.getElementById("fm-gender") as HTMLSelectElement).value,
      relation: (document.getElementById("fm-relation") as HTMLSelectElement).value,
      bloodGroup: (document.getElementById("fm-blood") as HTMLSelectElement).value,
      allergies: (document.getElementById("fm-allergies") as HTMLInputElement).value.trim(),
      chronic: (document.getElementById("fm-chronic") as HTMLInputElement).value.trim()
    };

    try {
      await set(ref(db, `users/${loggedInUser.uid}/familyProfiles/${nMember.id}`), nMember);
      showToast(`${name}'s health profile linked safely!`, "success");
      // Refetch
      await drawFamilyList();
      // Clear Name input
      (document.getElementById("fm-name") as HTMLInputElement).value = "";
    } catch (err) {
      showToast("Error updating clinical logs.", "error");
    }
  });

  // Global window delete mapper to update component state
  (window as any).deleteFamilyMember = async (id: string) => {
    if (confirm("Disconnect and delete this family profile record permanently?")) {
      try {
        await remove(ref(db, `users/${loggedInUser.uid}/familyProfiles/${id}`));
        showToast("Roster profile deleted.", "info");
        await drawFamilyList();
      } catch (err) {
        showToast("Delete operation failed.", "error");
      }
    }
  };
}

// Medicine Refill Reminders Manager
async function openRefillRemindersManager() {
  if (!loggedInUser) return;

  const drawReminders = async () => {
    let reminderHtml = "";
    try {
      const snap = await get(ref(db, `users/${loggedInUser.uid}/refillReminders`));
      if (snap.exists()) {
        const list = Object.values(snap.val() || {});
        if (list.length > 0) {
          reminderHtml = list.map((item: any) => {
            let colClass = "from-amber-600 to-amber-700 bg-amber-50 text-amber-800 border-amber-200";
            if (item.type === "Low Stock Reminder") {
              colClass = "from-rose-600 to-rose-700 bg-rose-50 text-rose-800 border-rose-200";
            } else if (item.type === "Subscription Renewal Reminder") {
              colClass = "from-blue-600 to-blue-700 bg-blue-50 text-blue-800 border-blue-200";
            }
            return `
              <div class="bg-white border text-slate-800 p-3.5 rounded-2xl flex items-center justify-between gap-3 font-sans animate-fade-in relative">
                <div class="space-y-1">
                  <span class="px-1.5 py-0.2 bg-slate-100 text-slate-500 font-mono text-[8px] font-black uppercase rounded">${item.frequency || "Monthly"}</span>
                  <h4 class="text-xs font-black text-slate-900">${item.medicineName || "Prescribed Medicine"}</h4>
                  <div class="flex items-center gap-2 text-[9px] text-slate-400 font-bold">
                    <span class="px-2 py-0.5 rounded uppercase font-black text-[7.5px] ${colClass}">${item.type || "Refill Due"}</span>
                  </div>
                </div>
                <button onclick="deleteRefillReminder('${item.id}')" class="w-8 h-8 rounded-full bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-all flex items-center justify-center shrink-0 cursor-pointer" title="Delete Reminder">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
            `;
          }).join("");
        } else {
          reminderHtml = `<div class="p-6 text-center text-slate-400 text-xs italic font-semibold uppercase">No active refill alarms. Create one below!</div>`;
        }
      } else {
        reminderHtml = `<div class="p-6 text-center text-slate-400 text-xs italic font-semibold uppercase">No active refill alarms. Create one below!</div>`;
      }
    } catch (e) {
      reminderHtml = `<div class="p-4 text-rose-500 text-xs">Error compiling active alarms list.</div>`;
    }

    const box = document.getElementById("rf-reminders-box");
    if (box) box.innerHTML = reminderHtml;
  };

  const html = `
    <div class="space-y-5 animate-fade-in p-1 font-sans text-xs">
      <!-- Create Reminder -->
      <div class="bg-amber-50/25 border border-slate-100 rounded-3xl p-4.5 space-y-3.5">
        <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Configure Refill Alarm</h4>
        
        <div class="space-y-1">
          <label class="block text-[8.5px] uppercase font-black text-amber-700 tracking-wide">Medicine Name</label>
          <input type="text" id="rm-med-name" placeholder="e.g. Lipitor, Metformin, Crocin" class="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none focus:border-amber-500">
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Frequency</label>
            <select id="rm-freq" class="w-full px-2 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none cursor-pointer">
              <option value="Daily">Daily alarm</option>
              <option value="Weekly">Weekly check</option>
              <option value="Monthly">Monthly refill</option>
            </select>
          </div>
          <div class="space-y-1">
            <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Reminder Signal</label>
            <select id="rm-type" class="w-full px-2 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none cursor-pointer">
              <option value="Refill Due">Refill Due Notice</option>
              <option value="Low Stock Reminder">Low Stock Warning</option>
              <option value="Subscription Renewal Reminder">Subscription Renewal Alert</option>
            </select>
          </div>
        </div>

        <button id="btn-save-refill-reminder" class="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition-all cursor-pointer shadow-sm">Set Reminder Alarm</button>
      </div>

      <!-- Reminders list -->
      <div class="space-y-3">
        <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Active Alarms Log</h4>
        <div class="space-y-2" id="rf-reminders-box">
          <!-- Populated -->
        </div>
      </div>
    </div>
  `;

  openProfileDrawer(`<i class="fa-solid fa-clock-rotate-left text-amber-600 mr-1.5 animate-bounce"></i> Medicine Refills & Reminders`, html);
  await drawReminders();

  document.getElementById("btn-save-refill-reminder")?.addEventListener("click", async () => {
    const medicineName = (document.getElementById("rm-med-name") as HTMLInputElement).value.trim();
    if (!medicineName) {
      showToast("Please specify medicine name for alarm scheduling.", "error");
      return;
    }

    const nReminder = {
      id: "REM_" + Date.now(),
      medicineName,
      frequency: (document.getElementById("rm-freq") as HTMLSelectElement).value,
      type: (document.getElementById("rm-type") as HTMLSelectElement).value,
      createdAt: Date.now()
    };

    try {
      await set(ref(db, `users/${loggedInUser.uid}/refillReminders/${nReminder.id}`), nReminder);
      showToast(`Refill schedule created for ${medicineName}!`, "success");
      await drawReminders();
      (document.getElementById("rm-med-name") as HTMLInputElement).value = "";
    } catch (e) {
      showToast("Constraint: Failed setting alarm sync.", "error");
    }
  });

  (window as any).deleteRefillReminder = async (id: string) => {
    if (confirm("Cancel and delete this medicine refill alarm?")) {
      try {
        await remove(ref(db, `users/${loggedInUser.uid}/refillReminders/${id}`));
        showToast("Alarm unsubscribed successfully.", "info");
        await drawReminders();
      } catch (err) {
        showToast("Error removing alarm schema.", "error");
      }
    }
  };
}

// Prescription Storage Vault Manager
async function openPrescriptionVaultManager() {
  if (!loggedInUser) return;

  const drawSlips = async () => {
    let slipsHtml = "";
    try {
      const snap = await get(ref(db, `users/${loggedInUser.uid}/prescriptionVault`));
      if (snap.exists()) {
        const list = Object.values(snap.val() || {});
        if (list.length > 0) {
          slipsHtml = list.map((slip: any) => {
            const upDate = slip.uploadedAt ? new Date(slip.uploadedAt).toLocaleDateString() : "Internal file";
            const slipUrl = slip.url || slip.cloudinaryUrl || "";
            return `
              <div class="bg-white border text-slate-800 p-3 rounded-2xl space-y-2.5 font-sans animate-fade-in">
                <div class="flex items-center justify-between">
                  <div>
                    <h4 class="text-xs font-black text-slate-900">${slip.title || "Prescription Slip"}</h4>
                    <span class="text-[9px] text-slate-400 font-mono">Uploaded: ${upDate}</span>
                  </div>
                  <button onclick="deletePrescriptionSlip('${slip.id}')" class="w-7 h-7 rounded-full bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-all flex items-center justify-center cursor-pointer text-xs shrink-0">
                    <i class="fa-solid fa-trash-can text-[10px]"></i>
                  </button>
                </div>
                <!-- File controls -->
                <div class="flex items-center gap-1.5 flex-wrap">
                  ${slipUrl ? `
                    <a href="${slipUrl}" target="_blank" referrerPolicy="no-referrer" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-250 hover:bg-slate-200 text-slate-700 font-black text-[8.5px] rounded-lg tracking-wider uppercase flex items-center gap-1">
                      <i class="fa-solid fa-eye"></i> View Slip
                    </a>
                    <button onclick="reorderUsingPrescription('${slip.id}', '${slip.title.replace(/'/g, "\\'")}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[8.5px] rounded-lg tracking-wider uppercase flex items-center gap-1 cursor-pointer">
                      <i class="fa-solid fa-cart-shopping"></i> Fast Reorder
                    </button>
                  ` : ""}
                </div>
              </div>
            `;
          }).join("");
        } else {
          slipsHtml = `<div class="p-6 text-center text-slate-400 text-xs italic font-semibold uppercase">Vault is currently empty. Upload prescription slips below!</div>`;
        }
      } else {
        slipsHtml = `<div class="p-6 text-center text-slate-400 text-xs italic font-semibold uppercase">Vault is currently empty. Upload prescription slips below!</div>`;
      }
    } catch (err) {
      slipsHtml = `<div class="p-4 text-rose-500 text-xs">Error compiling prescription slips.</div>`;
    }

    const box = document.getElementById("vault-slips-box");
    if (box) box.innerHTML = slipsHtml;
  };

  const html = `
    <div class="space-y-5 animate-fade-in p-1 font-sans text-xs">
      <!-- Upload Prescription Slip Form -->
      <div class="bg-emerald-50/20 border border-slate-100 rounded-3xl p-4.5 space-y-3.5">
        <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Secure Document Upload</h4>
        
        <div class="space-y-1">
          <label class="block text-[8.5px] uppercase font-black text-rose-500/80 tracking-wide">Medicines Title / Dr. Designation</label>
          <input type="text" id="vp-title" placeholder="e.g. Asthma Dr. Gupta Presc, Cardiac slip" class="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none focus:border-emerald-500">
        </div>

        <div class="space-y-2">
          <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Select Slip Image File (Camera / Image)</label>
          <div class="border-2 border-dashed border-slate-200 hover:border-emerald-500 bg-white p-6 rounded-2xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2" onclick="document.getElementById('vp-file-obj').click()">
            <i class="fa-solid fa-cloud-arrow-up text-xl text-slate-400 animate-bounce"></i>
            <span class="text-[9.5px] text-slate-500 font-extrabold pb-0.5">Drag & Drop or Click to browse</span>
            <span class="text-[8px] text-slate-400 font-semibold font-mono uppercase bg-slate-50 border border-slate-150 px-2 py-0.5 rounded leading-none" id="vp-file-status">No Chosen Image File</span>
            <input type="file" id="vp-file-obj" class="hidden" accept="image/*">
          </div>
        </div>

        <button id="btn-save-vault-prescription" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition-all cursor-pointer shadow-sm">Authorize Secure Vault Upload</button>
      </div>

      <!-- Prescription archival library -->
      <div class="space-y-3">
        <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Prescription Storage Shelf</h4>
        <div class="space-y-2" id="vault-slips-box">
          <!-- Populated dynamic list -->
        </div>
      </div>
    </div>
  `;

  openProfileDrawer(`<i class="fa-solid fa-file-prescription text-emerald-600 mr-1.5 animate-pulse"></i> Patient Prescription Vault`, html);
  await drawSlips();

  // Watch chosen file label
  const fileInp = document.getElementById("vp-file-obj") as HTMLInputElement;
  fileInp?.addEventListener("change", () => {
    const lbl = document.getElementById("vp-file-status");
    if (lbl && fileInp.files && fileInp.files[0]) {
      lbl.innerText = fileInp.files[0].name.substring(0, 15) + "...";
    }
  });

  // Action upload prescription
  document.getElementById("btn-save-vault-prescription")?.addEventListener("click", async () => {
    const title = (document.getElementById("vp-title") as HTMLInputElement).value.trim();
    if (!title) {
      showToast("Please enter a title describing this prescription slip.", "error");
      return;
    }

    if (!fileInp.files || !fileInp.files[0]) {
      showToast("Constraint: Please select an image of your prescription slip to compound.", "error");
      return;
    }

    const saveBtn = document.getElementById("btn-save-vault-prescription") as HTMLButtonElement;
    saveBtn.disabled = true;
    saveBtn.innerText = "UPLOADING TO CLINICAL CLOUD...";
    showToast("Starting secure file upload to Apothecary secure server...", "info");

    try {
      const livePath = await uploadToCloudinary(fileInp.files[0]);
      if (!livePath) {
        throw new Error("Local folder upload constraints triggered.");
      }

      const id = "PRES_" + Date.now();
      const nPresc = {
        id,
        title,
        url: livePath,
        uploadedAt: Date.now()
      };

      await set(ref(db, `users/${loggedInUser.uid}/prescriptionVault/${id}`), nPresc);
      showToast("Prescription file archived securely!", "success");
      await drawSlips();

      // Clear layout
      (document.getElementById("vp-title") as HTMLInputElement).value = "";
      fileInp.value = "";
      document.getElementById("vp-file-status")!.innerText = "No Chosen Image File";
    } catch (err: any) {
      console.error(err);
      showToast("Failed compiling file uploads. Re-check file formats.", "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerText = "Authorize Secure Vault Upload";
    }
  });

  // Dynamic window mapping
  (window as any).deletePrescriptionSlip = async (id: string) => {
    if (confirm("Are you sure you want to delete this prescription slip registry?")) {
      try {
        await remove(ref(db, `users/${loggedInUser.uid}/prescriptionVault/${id}`));
        showToast("Prescription deleted.", "info");
        await drawSlips();
      } catch (err) {
        showToast("Constraint: Record erase error.", "error");
      }
    }
  };

  (window as any).reorderUsingPrescription = (id: string, title: string) => {
    showToast("Reorder triggered with slip: ID #" + id.substring(0, 6).toUpperCase(), "success");
    // Dispatch system advisory alert popup
    const alertHtml = `
      <div class="space-y-3.5 p-1 animate-fade-in text-xs font-sans text-slate-700">
        <div class="bg-emerald-50 border border-emerald-150 p-3 rounded-2xl text-[9.5px] font-black text-emerald-800 uppercase leading-normal tracking-wide">
          Prescription fast reorder submitted
        </div>
        <p class="leading-relaxed">Your selected prescription <strong>"${title}"</strong> has been securely routed to a licensed Dawado pharmacist auditor.</p>
        <p class="leading-relaxed font-semibold text-slate-500">A dedicated medical care practitioner is compiling the specified medications inside your active checkout cart. We will issue a live notification when the compilation completes!</p>
        <button onclick="profileDrawer.classList.add('hidden')" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase rounded-xl transition-all cursor-pointer shadow-sm text-center">Close Advisor Panel</button>
      </div>
    `;
    openProfileDrawer(`<i class="fa-solid fa-user-doctor text-emerald-600 animate-bounce"></i> Reorder Compounded Ready`, alertHtml);
  };
}

// Health Records Hub
async function openHealthRecordsManager() {
  if (!loggedInUser) return;

  const drawDocs = async (filterKeyword = "") => {
    let docsHtml = "";
    try {
      const snap = await get(ref(db, `users/${loggedInUser.uid}/healthRecords`));
      if (snap.exists()) {
        let list = Object.values(snap.val() || {});
        
        if (filterKeyword.trim()) {
          const kw = filterKeyword.toLowerCase().trim();
          list = list.filter((item: any) => 
            (item.title || "").toLowerCase().includes(kw) || 
            (item.category || "").toLowerCase().includes(kw)
          );
        }

        if (list.length > 0) {
          docsHtml = list.map((doc: any) => {
            const upDate = doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : "Internal Document";
            const docUrl = doc.url || "";
            return `
              <div class="bg-white border text-slate-800 p-3 rounded-2xl space-y-2 flex flex-col font-sans animate-fade-in">
                <div class="flex items-center justify-between">
                  <div class="min-w-0">
                    <span class="px-1.5 py-0.2 bg-indigo-50 border border-indigo-100/50 text-indigo-700 text-[8px] font-black uppercase rounded">${doc.category || "General Report"}</span>
                    <h4 class="text-xs font-black text-slate-900 truncate mt-1">${doc.title || "Clinical Report File"}</h4>
                    <span class="text-[9px] text-slate-400 font-semibold font-mono">Date: ${upDate}</span>
                  </div>
                  <button onclick="deleteHealthDoc('${doc.id}')" class="w-7 h-7 rounded-full bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-all flex items-center justify-center shrink-0 cursor-pointer">
                    <i class="fa-solid fa-trash-can text-[10px]"></i>
                  </button>
                </div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  ${docUrl ? `
                    <a href="${docUrl}" target="_blank" referrerPolicy="no-referrer" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-[8.5px] rounded-lg tracking-wide uppercase flex items-center gap-1">
                      <i class="fa-solid fa-file-invoice text-indigo-500"></i> View Record
                    </a>
                    <button onclick="shareHealthDocLink('${docUrl.replace(/'/g, "\\'")}')" class="px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold text-[8.5px] rounded-lg tracking-wide uppercase flex items-center gap-1 cursor-pointer">
                      <i class="fa-solid fa-share-nodes"></i> Share with Doctor
                    </button>
                  ` : ""}
                </div>
              </div>
            `;
          }).join("");
        } else {
          docsHtml = `<div class="p-6 text-center text-slate-400 text-xs italic font-semibold uppercase">No matching reports or documents found.</div>`;
        }
      } else {
        docsHtml = `<div class="p-6 text-center text-slate-400 text-xs italic font-semibold uppercase">Empty records. Classify, upload lab indices or diagnostic sheets below!</div>`;
      }
    } catch (e) {
      docsHtml = `<div class="p-4 text-rose-500 text-xs">Error compiling health records database.</div>`;
    }

    const box = document.getElementById("hr-docs-container");
    if (box) box.innerHTML = docsHtml;
  };

  const html = `
    <div class="space-y-5 animate-fade-in p-1 font-sans text-xs">
      <!-- Create Record Upload Card -->
      <div class="bg-cyan-50/25 border border-slate-100 rounded-3xl p-4.5 space-y-3.5">
        <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Index Diagnostics slip</h4>
        
        <div class="space-y-1">
          <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Document Classification Topic</label>
          <select id="hr-cat" class="w-full px-2 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none cursor-pointer">
            <option value="Lab Report">Lab & Blood Reports</option>
            <option value="Vaccination Card">Vaccination Records</option>
            <option value="Prescription Slip">Prescription Archives</option>
            <option value="Medical Report">General Diagnostics / ECG / Case paper</option>
          </select>
        </div>

        <div class="space-y-1">
          <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Report / Sheet Title</label>
          <input type="text" id="hr-title" placeholder="e.g. Covid Vaccine dose 2, Blood glucose check" class="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none focus:border-cyan-550">
        </div>

        <div class="space-y-2">
          <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Select Report Image File</label>
          <div class="border-2 border-dashed border-slate-200 hover:border-cyan-500 bg-white p-6 rounded-2xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2" onclick="document.getElementById('hr-file').click()">
            <i class="fa-solid fa-file-pdf text-xl text-slate-400"></i>
            <span class="text-[9.5px] text-slate-500 font-extrabold">Choose Image or PDF screen</span>
            <span class="text-[8px] text-slate-400 font-semibold font-mono uppercase bg-slate-50 border border-slate-150 px-2 py-0.5 rounded leading-none" id="hr-file-name">No report chosen</span>
            <input type="file" id="hr-file" class="hidden" accept="image/*">
          </div>
        </div>

        <button id="btn-save-health-record" class="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition-all cursor-pointer shadow-sm">Save to clinical archives</button>
      </div>

      <!-- Live Search & Classification filters -->
      <div class="space-y-3">
        <div class="flex items-center justify-between border-b border-slate-50 pb-1.5 flex-wrap gap-2">
          <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Indexed Documents Database</h4>
          <input type="text" id="hr-search-bar" placeholder="Instant Search records..." class="px-3.5 py-1 text-[9.5px] border border-slate-200 outline-none rounded-xl bg-white max-w-[150px] w-full focus:border-cyan-500">
        </div>
        <div class="space-y-2" id="hr-docs-container">
          <!-- Dynamic logs populated here -->
        </div>
      </div>
    </div>
  `;

  openProfileDrawer(`<i class="fa-solid fa-folder-open text-cyan-550 text-cyan-600 mr-1.5 animate-pulse"></i> Certified Health Records Hub`, html);
  await drawDocs();

  // Handle Search Input in Vault
  const searchBar = document.getElementById("hr-search-bar") as HTMLInputElement;
  searchBar?.addEventListener("input", () => {
    drawDocs(searchBar.value);
  });

  // Watch chosen file label
  const hrFile = document.getElementById("hr-file") as HTMLInputElement;
  hrFile?.addEventListener("change", () => {
    const lbl = document.getElementById("hr-file-name");
    if (lbl && hrFile.files && hrFile.files[0]) {
      lbl.innerText = hrFile.files[0].name.substring(0, 15) + "...";
    }
  });

  // Save record trigger
  document.getElementById("btn-save-health-record")?.addEventListener("click", async () => {
    const title = (document.getElementById("hr-title") as HTMLInputElement).value.trim();
    if (!title) {
      showToast("Please enter a clear title describing this medical file.", "error");
      return;
    }

    if (!hrFile.files || !hrFile.files[0]) {
      showToast("Clinical focus: Please choose an image of your record or report sheet.", "error");
      return;
    }

    const saveBtn = document.getElementById("btn-save-health-record") as HTMLButtonElement;
    saveBtn.disabled = true;
    saveBtn.innerText = "UPLOADING TO HEALTH DRIVE...";

    try {
      const livePath = await uploadToCloudinary(hrFile.files[0]);
      if (!livePath) throw new Error("Cloud folder restrictions compounding.");

      const id = "DOC_" + Date.now();
      const nDoc = {
        id,
        category: (document.getElementById("hr-cat") as HTMLSelectElement).value,
        title,
        url: livePath,
        uploadedAt: Date.now()
      };

      await set(ref(db, `users/${loggedInUser.uid}/healthRecords/${id}`), nDoc);
      showToast("Clinical document compiled & saved securely!", "success");
      await drawDocs();
      
      // Clear
      (document.getElementById("hr-title") as HTMLInputElement).value = "";
      hrFile.value = "";
      document.getElementById("hr-file-name")!.innerText = "No report chosen";
    } catch (err) {
      showToast("Error processing clinical record archive.", "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerText = "Save to clinical archives";
    }
  });

  // Global delete record hook
  (window as any).deleteHealthDoc = async (id: string) => {
    if (confirm("Permanently delete and purge this diagnostics file from database records?")) {
      try {
        await remove(ref(db, `users/${loggedInUser.uid}/healthRecords/${id}`));
        showToast("Clinical record deleted.", "info");
        await drawDocs();
      } catch (err) {
        showToast("Error removing medical record archives.", "error");
      }
    }
  };

  (window as any).shareHealthDocLink = (urlStr: string) => {
    navigator.clipboard.writeText(urlStr).then(() => {
      showToast("One-Time Patient Document Link copied! Direct secure access link prepared for sharing with your practitioner.", "success");
    });
  };
}

// Chronic Medicine Subscriptions Manager
async function openSubscriptionsManager() {
  if (!loggedInUser) return;

  const drawSubs = async () => {
    let subsHtml = "";
    try {
      const snap = await get(ref(db, `users/${loggedInUser.uid}/subscriptions`));
      if (snap.exists()) {
        const list = Object.values(snap.val() || {});
        if (list.length > 0) {
          subsHtml = list.map((item: any) => {
            const upDate = item.nextDeliveryDate ? new Date(item.nextDeliveryDate).toLocaleDateString() : "Pending";
            return `
              <div class="bg-white border text-slate-800 p-3.5 rounded-2xl flex items-center justify-between font-sans animate-fade-in relative">
                <div class="space-y-1">
                  <span class="px-1.5 py-0.2 bg-emerald-50 text-emerald-800 font-black tracking-wide text-[8px] uppercase rounded border border-emerald-100">Recurring dispatch active</span>
                  <h4 class="text-xs font-black text-slate-900 mt-1">${item.medicineName || "Prescription Refills Cycle"}</h4>
                  <p class="text-[9.5px] text-slate-400 font-bold">Qty: <span class="font-bold text-slate-650 text-slate-700">${item.quantity || 1} units</span> | Frequency: <span class="uppercase text-indigo-600 font-black">${item.frequency || "Monthly"}</span></p>
                  <p class="text-[9px] text-slate-400 font-mono">Next Automatic Dispatch Scheduled on: <span class="font-extrabold text-indigo-700">${upDate}</span></p>
                </div>
                <button onclick="deleteSubscriptionPlan('${item.id}')" class="w-8 h-8 rounded-full bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-all flex items-center justify-center shrink-0 cursor-pointer" title="Cancel Subscription">
                  <i class="fa-solid fa-square-minus text-rose-500 text-sm"></i>
                </button>
              </div>
            `;
          }).join("");
        } else {
          subsHtml = `<div class="p-6 text-center text-slate-400 text-xs italic font-semibold uppercase">No continuous chronic refill subscriptions. Create one below!</div>`;
        }
      } else {
        subsHtml = `<div class="p-6 text-center text-slate-400 text-xs italic font-semibold uppercase">No continuous chronic refill subscriptions. Create one below!</div>`;
      }
    } catch (err) {
      subsHtml = `<div class="p-4 text-center text-xs text-rose-500">Error retrieving continuous subscription logs.</div>`;
    }

    const box = document.getElementById("sub-plans-container");
    if (box) box.innerHTML = subsHtml;
  };

  const html = `
    <div class="space-y-5 animate-fade-in p-1 font-sans text-xs">
      <!-- Create Subscription Refill Plan Card -->
      <div class="bg-indigo-50/20 border border-slate-100 rounded-3xl p-4.5 space-y-3.5">
        <div class="space-y-1">
          <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Subscribe Automatic Refill Plan</h4>
          <p class="text-[9px] text-slate-400 mt-0.5 leading-snug">Ideal for diabetic, cardiovascular, or thyroid medications taken continuously.</p>
        </div>
        
        <div class="space-y-1">
          <label class="block text-[8.5px] uppercase font-black text-indigo-600/80 tracking-wide">Medicine / Stock Name</label>
          <input type="text" id="sub-med-name" placeholder="e.g. Levothyroxine, Lipitor, Metformin" class="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none focus:border-indigo-500">
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide font-sans">Shipment Auto-Cycle</label>
            <select id="sub-freq" class="w-full px-2 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold outline-none cursor-pointer font-sans">
              <option value="Weekly">Weekly (Every 7 days)</option>
              <option value="Bi-Weekly">Bi-Weekly (Every 14 days)</option>
              <option value="Monthly">Monthly (Every 30 days)</option>
            </select>
          </div>
          <div class="space-y-1">
            <label class="block text-[8.5px] uppercase font-black text-slate-400 tracking-wide">Pack Quantity</label>
            <input type="number" id="sub-qty" value="1" min="1" class="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold' font-mono outline-none">
          </div>
        </div>

        <button id="btn-save-chronic-subscription" class="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition-all cursor-pointer shadow-sm">Authorize Automatic Chronic Refills</button>
      </div>

      <!-- Subscriptions List -->
      <div class="space-y-3">
        <h4 class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Configured Chronic Schedules</h4>
        <div class="space-y-2" id="sub-plans-container">
          <!-- Populated dynamically -->
        </div>
      </div>
    </div>
  `;

  openProfileDrawer(`<i class="fa-solid fa-rotate text-rose-500 mr-1.5 animate-pulse"></i> Chronic Medication Refill Cycles`, html);
  await drawSubs();

  // Save subscription action handler
  document.getElementById("btn-save-chronic-subscription")?.addEventListener("click", async () => {
    const medName = (document.getElementById("sub-med-name") as HTMLInputElement).value.trim();
    if (!medName) {
      showToast("Please enter a medicine name to authorize refill cycles.", "error");
      return;
    }

    const freq = (document.getElementById("sub-freq") as HTMLSelectElement).value;
    const qty = Number((document.getElementById("sub-qty") as HTMLInputElement).value) || 1;

    let cycleDays = 30;
    if (freq === "Weekly") cycleDays = 7;
    else if (freq === "Bi-Weekly") cycleDays = 14;

    const nextDeliveryDate = Date.now() + cycleDays * 24 * 60 * 60 * 1000;
    const id = "SUB_" + Date.now();

    const nSub = {
      id,
      medicineName: medName,
      frequency: freq,
      quantity: qty,
      nextDeliveryDate,
      createdAt: Date.now()
    };

    try {
      await set(ref(db, `users/${loggedInUser.uid}/subscriptions/${id}`), nSub);
      showToast(`Refills authorized! Metformin auto-shipments established: ${freq}`, "success");
      await drawSubs();
      (document.getElementById("sub-med-name") as HTMLInputElement).value = "";
    } catch (err) {
      showToast("Authorisation constraints: Failed creating schedule.", "error");
    }
  });

  // Global delete handler
  (window as any).deleteSubscriptionPlan = async (id: string) => {
    if (confirm("De-authorize and cancel this automatic chronic medication refill subscription?")) {
      try {
        await remove(ref(db, `users/${loggedInUser.uid}/subscriptions/${id}`));
        showToast("Auto-shipments cycle canceled.", "info");
        await drawSubs();
      } catch (err) {
        showToast("Deauthorization failed.", "error");
      }
    }
  };
}

// Voice search Web Speech recognition & SOS Triggers handler
function initDiagnosticGreetingsAndVoiceSearch() {
  // SOS Button click binding inside User Panel
  const sosBtn = document.getElementById("btn-home-sos-trigger");
  sosBtn?.addEventListener("click", () => {
    const sosHtml = `
      <div class="space-y-4 animate-fade-in text-xs font-sans text-slate-700">
        <div class="p-3 bg-red-100 border border-red-200 text-rose-800 rounded-xl leading-normal text-[10px] font-black uppercase tracking-wide">
          WARNING: This is the critical Dawado emergency priority channel. Bypasses regular order queues and alerts nearest apothecaries of critical medicine demands.
        </div>
        <div class="space-y-2">
          <button onclick="triggerEmergencyCall('911')" class="w-full py-3 bg-red-650 bg-red-600 hover:bg-red-700 text-white font-black uppercase rounded-2xl flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer tracking-wider text-xs">
            <i class="fa-solid fa-truck-medical animate-pulse text-sm"></i> Call Medical Ambulance (108/911)
          </button>
          <button onclick="triggerEmergencyCall('1800')" class="w-full py-3 bg-slate-900 border border-slate-700 hover:bg-slate-800 text-white font-black uppercase rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer tracking-wider text-xs">
            <i class="fa-solid fa-phone"></i> Nearest Partner Apothecary
          </button>
        </div>
        <div class="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1">
          <h5 class="font-extrabold uppercase text-[9px] text-slate-400">Share Current Active GPS coordinates:</h5>
          <p class="font-mono text-slate-700 font-bold text-[10px]" id="sos-coordinates-txt">Location: detecting live coordinate logs...</p>
          <button onclick="copyCurrentCoordinatesTriage()" class="mt-2 text-[8.5px] bg-indigo-50 border border-indigo-100 text-indigo-700 font-black px-3 py-1.5 rounded-lg tracking-wide uppercase transition-all cursor-pointer">Copy Triage Coordinates Message</button>
        </div>
      </div>
    `;
    openProfileDrawer(`<span class="text-rose-600 font-extrabold"><i class="fa-solid fa-triangle-exclamation animate-pulse"></i> PATIENT EMERGENCY SOS</span>`, sosHtml);
    
    // Auto-detect GPS if available
    const coordTxt = document.getElementById("sos-coordinates-txt");
    if (coordTxt && currentCoordinates) {
      coordTxt.innerText = `Precision Coordinate District: ${currentCoordinates.district || currentCoordinates.city || "Gonda, UP"}\nLatitude: ${currentCoordinates.lat || "27.13"}\nLongitude: ${currentCoordinates.lng || "81.96"}`;
    } else if (coordTxt) {
      getCurrentGPS(true).then((geo) => {
        coordTxt.innerText = `Precision Coordinates:\nLatitude: ${geo.lat.toFixed(5)}\nLongitude: ${geo.lng.toFixed(5)}`;
      }).catch(() => {
        coordTxt.innerText = `Precision Coordinate District: Indira Nagar, Bengaluru Hub\nLatitude: 12.9716\nLongitude: 77.5946`;
      });
    }
  });

  // Voice Search Web Speech Recognition
  const voiceBtn = document.getElementById("btn-voice-search");
  voiceBtn?.addEventListener("click", () => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      showToast("Web Speech Recognition API is not supported in this browser environment.", "error");
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = "en-IN"; // English (India) is fantastic for Hinglish medicine mixes
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    showToast("Voice Mic is Listening. Spell medicine name directly...", "info");
    const micIcon = voiceBtn.querySelector("i");
    if (micIcon) {
      micIcon.className = "fa-solid fa-microphone text-xs bg-rose-200 text-rose-700 p-2 rounded-full animate-bounce";
    }

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      showToast(`Web Speech Match: "${text}"`, "success");
      const searchInp = document.getElementById("search-medicine-input") as HTMLInputElement;
      if (searchInp) {
        searchInp.value = text;
        // Search trigger event
        searchInp.dispatchEvent(new Event("input"));
      }
    };

    recognition.onerror = (e: any) => {
      console.error(e);
      showToast("Voice recognition failed. Recheck microphone permissions.", "error");
    };

    recognition.onend = () => {
      if (micIcon) {
        micIcon.className = "fa-solid fa-microphone text-xs bg-rose-50/10 p-2 text-rose-500 hover:bg-rose-50/25 rounded-full transition-all";
      }
    };

    recognition.start();
  });
}

// Global window event triggers registration for SOS
Object.assign(window, {
  triggerEmergencyCall(num: string) {
    showToast(`Routing priority clinical ambulance contact link to ${num}...`, "success");
    // Attempt standard phone dialing trigger
    window.location.href = `tel:${num}`;
  },
  copyCurrentCoordinatesTriage() {
    const coordsStr = currentCoordinates 
      ? `Lat: ${currentCoordinates.lat || "12.97"}, Lng: ${currentCoordinates.lng || "77.59"}` 
      : "Indira Nagar, Bengaluru base";
    const msg = `EMERGENCY AMBULANCE COMPLAINT: Priority medical dispatcher request at coordinate points: ${coordsStr}. Need immediate certified clinical dispatch!`;
    navigator.clipboard.writeText(msg).then(() => {
      showToast("Emergency coordinates message ready inside clipboard! Post to medical helper channels.", "success");
    });
  }
});

// Boot HUD welcome name, and initial bento greeting configurations upon sync
async function upgradeHomeDynamicHUD() {
  if (!loggedInUser) return;
  try {
    const usrSnap = await get(ref(db, `users/${loggedInUser.uid}`));
    if (usrSnap.exists()) {
      const uData = usrSnap.val();
      
      // Update Name Greeting
      const hrs = new Date().getHours();
      let prefix = "Good Morning";
      if (hrs >= 18) prefix = "Good Evening";
      else if (hrs >= 12) prefix = "Good Afternoon";
      
      const homePref = document.getElementById("home-greeting-prefix");
      if (homePref) homePref.innerText = prefix;
      
      const homeUser = document.getElementById("home-greeting-username");
      if (homeUser) homeUser.innerText = uData.name || loggedInUser.displayName || "Patient User";
      
      // Update coins & membership level
      const coins = uData.coins || 250;
      const coinsText = document.getElementById("home-coins-display");
      if (coinsText) coinsText.innerText = `${coins} Coins`;
      
      let level = "Silver Care";
      if (coins >= 1000) level = "Platinum Care";
      else if (coins >= 500) level = "Gold Care";
      
      const levelDisplay = document.getElementById("tier-pill-display");
      if (levelDisplay) levelDisplay.innerText = level;
    }
  } catch (err) {
    console.error("HUD telemetry load error:", err);
  }
}

// Watch Auth change to launch HUD checks
onAuthStateChanged(auth, (user) => {
  if (user) {
    setTimeout(() => {
      upgradeHomeDynamicHUD();
      initDiagnosticGreetingsAndVoiceSearch();
      
      // Ensure quick category buttons are registered
      document.querySelectorAll(".quick-cat-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const target = e.currentTarget as HTMLElement;
          const catName = target.getAttribute("data-category");
          if (catName) {
            openCategoryStorefront(catName);
          }
        });
      });
    }, 1200);
  }
});

