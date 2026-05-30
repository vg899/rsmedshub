import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, get, update, remove } from "firebase/database";
import { showToast, getCurrentGPS, reverseGeocode, searchAddress, calculateDistance, getRouteMapUrl, getStaticMapUrl, GeoLocation } from "./utils";

// Core State variables
let loggedInUser: any = null;
let currentCoordinates: GeoLocation | null = null;
const cartItems: { [id: string]: { medicineId: string; name: string; price: number; qty: number; category: string; storeId: string; storeName: string } } = {};
let activeCategory = "All";
let activeStoreId = "";
let searchQuery = "";
let activeOrderTrackingId = "";
let trackingRiderInterval: any = null;

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
const navSearch = document.getElementById("navitem-search") as HTMLButtonElement;
const navCart = document.getElementById("navitem-cart") as HTMLButtonElement;
const navOrders = document.getElementById("navitem-orders") as HTMLButtonElement;
const navProfile = document.getElementById("navitem-profile") as HTMLButtonElement;

// Suggestions block
const addrSuggestions = document.getElementById("address-suggestions") as HTMLDivElement;
const addrInput = document.getElementById("checkout-address-input") as HTMLInputElement;

// Check authentication
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showToast("Session expired. Please log in.", "error");
    window.location.href = "/index.html";
    return;
  }

  loggedInUser = user;
  
  // Fetch profile detailed settings
  get(ref(db, `users/${user.uid}`)).then((snapshot) => {
    if (snapshot.exists()) {
      const uData = snapshot.val();
      if (uData.role !== "user") {
        showToast("Access Denied: Redirecting to your panel...", "info");
        if (uData.role === "admin") {
          window.location.href = "/admin.html";
        } else if (uData.role === "store") {
          window.location.href = "/store.html";
        } else if (uData.role === "delivery") {
          window.location.href = "/delivery.html";
        } else {
          signOut(auth).then(() => {
            window.location.href = "/index.html";
          });
        }
      } else {
        showToast(`Logged in safely!`, "success");
        bootstrapGeoLocation();
      }
    } else {
      signOut(auth).then(() => {
        window.location.href = "/index.html";
      });
    }
  });

  // Watch profile notifications
  subscribeToNotifications(user.uid);
});

// Capture and resolve GPS on load
async function bootstrapGeoLocation() {
  const cityBadge = document.getElementById("loc-city-txt")!;
  try {
    currentCoordinates = await getCurrentGPS();
    cityBadge.innerText = currentCoordinates.city || currentCoordinates.address?.split(",")[0] || "Bengaluru";
    console.log("Verified GPS coordinates of user:", currentCoordinates);
    
    // Auto preset address bar
    if (addrInput && currentCoordinates.address) {
      addrInput.value = currentCoordinates.address;
    }
  } catch (err) {
    cityBadge.innerText = "Karnataka, IN";
    // Defaults Bengaluru coords
    currentCoordinates = { lat: 12.9716, lng: 77.5946, address: "Indira Nagar, Bengaluru, Karnataka, India", city: "Bengaluru", state: "Karnataka" };
    if (addrInput) addrInput.value = currentCoordinates.address;
  }

  // Loaded primary listings after location resolved
  syncMainMarketplace();
}

// Global Nav bar transitions
navHome.addEventListener("click", () => {
  toggleSections("home");
});
navSearch.addEventListener("click", () => {
  toggleSections("home");
  const searchBar = document.getElementById("search-medicine-input") as HTMLInputElement;
  if (searchBar) {
    searchBar.focus();
    searchBar.scrollIntoView({ behavior: "smooth", block: "center" });
    // Flash visually to highlight search bar
    searchBar.classList.add("ring-2", "ring-blue-400");
    setTimeout(() => {
      searchBar.classList.remove("ring-2", "ring-blue-400");
    }, 1500);
  }
  navHome.className = "flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 text-[9px] font-bold flex-1 focus:outline-none transition-all cursor-pointer";
  navSearch.className = "flex flex-col items-center gap-1 text-blue-600 text-[9px] font-black flex-1 focus:outline-none transition-all cursor-pointer";
});
navCart.addEventListener("click", () => {
  checkoutDrawer.classList.remove("hidden");
  renderCartDrawer();
});
navOrders.addEventListener("click", () => {
  toggleSections("orders");
  syncOrdersHistory();
});
navProfile.addEventListener("click", () => {
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
    navSearch.className = inactiveClass;
    navProfile.className = inactiveClass;
  } else if (view === "orders") {
    userOrdersSection.classList.remove("hidden");
    userScrollSection.classList.add("hidden");
    userProfileSection?.classList.add("hidden");
    navOrders.className = activeClass;
    navHome.className = inactiveClass;
    navSearch.className = inactiveClass;
    navProfile.className = inactiveClass;
  } else if (view === "profile") {
    userProfileSection?.classList.remove("hidden");
    userScrollSection.classList.add("hidden");
    userOrdersSection.classList.add("hidden");
    navProfile.className = activeClass;
    navHome.className = inactiveClass;
    navOrders.className = inactiveClass;
    navSearch.className = inactiveClass;
  }
}

// Log Out actions
document.getElementById("btn-user-signout")?.addEventListener("click", async () => {
  if (confirm("Sign out from MedsHub portal?")) {
    await signOut(auth);
    window.location.href = "/index.html";
  }
});

// 1. SYNC MARKETPLACE NODES & FILTER BINDINGS
let allMedicines: any[] = [];
let allStores: any[] = [];

function syncMainMarketplace() {
  // Fetch live global charges configuration
  get(ref(db, "charges")).then((snap) => {
    if (snap.exists()) {
      charges = snap.val();
    }
  });

  // Susbscribe promotional banners campaigns
  onValue(ref(db, "banners"), (snapshot) => {
    const section = document.getElementById("banner-section")!;
    if (snapshot.exists()) {
      const banners: any[] = [];
      snapshot.forEach((child) => {
        const b = child.val();
        if (b.active) banners.push(b);
      });

      if (banners.length > 0) {
        // Sort by priority weight
        banners.sort((a,b) => (a.priority || 1) - (b.priority || 1));
        const activeAd = banners[0];
        
        section.innerHTML = `
          <div class="absolute inset-0 bg-slate-950/20 mix-blend-multiply"></div>
          <div class="p-5 relative z-10 max-w-[65%] space-y-1.5 text-white">
            <span class="bg-white/20 text-white text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider">Flash Campaign Ready</span>
            <h2 class="text-sm font-extrabold leading-tight">Surgical meds direct from premium labs</h2>
            <button onclick="window.location.href='${activeAd.redirectUrl || "#"}'" class="mt-2 bg-white text-teal-600 font-bold text-[10px] px-3.5 py-1.5 rounded-lg">Browse Offer</button>
          </div>
          <img class="absolute right-0 bottom-0 w-28 h-full object-cover" src="${activeAd.imageUrl}" alt="Flash promo">
        `;
      }
    }
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
}

// Category tabs toggle
document.querySelectorAll(".cat-badge-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const target = e.currentTarget as HTMLButtonElement;
    activeCategory = target.getAttribute("data-category")!;
    
    document.querySelectorAll(".cat-badge-btn").forEach((b) => {
      b.classList.remove("border-emerald-500", "bg-emerald-50/20", "ring-2", "ring-emerald-500/20");
      b.classList.add("border-slate-100", "bg-white");
    });
    
    target.classList.remove("border-slate-100", "bg-white");
    target.classList.add("border-emerald-500", "bg-emerald-50/20", "ring-2", "ring-emerald-500/20");

    renderMedicinesGrid();
    triggerAISuggestion();
  });
});

// Search input keyword tracking
document.getElementById("search-medicine-input")?.addEventListener("input", (e) => {
  searchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
  renderMedicinesGrid();
});

// Rendering operational stores horizontal scroller
function renderPharmacySlider() {
  const container = document.getElementById("user-store-slider")!;
  if (allStores.length === 0) {
    container.innerHTML = `
      <div class="px-5 py-4 w-full text-center text-slate-400 font-bold text-xs bg-white rounded-2xl border border-dashed border-slate-200">
        No active pharmacy branches operating in your city.
      </div>
    `;
    return;
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
  ` + allStores.map((s) => {
    const isSelected = s.storeId === activeStoreId;
    const isOpen = s.isOpen !== false;
    const statusText = isOpen ? "OPEN" : "CLOSED";
    const statusColorClass = isOpen ? "text-emerald-500 bg-emerald-50" : "text-rose-500 bg-rose-50";
    
    // Dynamic calculate distance
    const dist = (s.location && currentCoordinates)
      ? calculateDistance(currentCoordinates.lat, currentCoordinates.lng, s.location.lat, s.location.lng).toFixed(1)
      : (Math.random() * 2 + 1).toFixed(1);

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
  const filtered = allMedicines.filter((m) => {
    const matchCat = activeCategory === "All" || m.category === activeCategory;
    const matchStore = activeStoreId === "" || m.storeId === activeStoreId;
    const matchSearch = m.name.toLowerCase().includes(searchQuery) || m.description.toLowerCase().includes(searchQuery) || (m.category && m.category.toLowerCase().includes(searchQuery));
    return matchCat && matchStore && matchSearch;
  });

  document.getElementById("user-meds-cnt")!.innerText = `${filtered.length} Items`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-2 text-center py-12 text-slate-400 font-semibold text-xs animate-fade-in">
        <i class="fa-solid fa-box-open text-2xl mb-2 text-slate-300"></i>
        <p>No medicines match your segment filters.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((m) => {
    const qtyInCart = cartItems[m.medicineId]?.qty || 0;
    const isFav = profileData && profileData.favorites && profileData.favorites[m.medicineId] ? true : false;
    return `
      <div class="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-xs flex flex-col justify-between hover:shadow-md transition-all relative">
        <button onclick="toggleFavoriteItem('${m.medicineId}')" class="absolute top-2 right-2 w-7 h-7 bg-white/85 hover:bg-white text-slate-400 hover:text-rose-500 rounded-full flex items-center justify-center border border-slate-100 transition-all cursor-pointer z-10 shadow-xs focus:outline-none">
          <i class="${isFav ? 'fa-solid fa-heart text-rose-500' : 'fa-regular fa-heart'} text-xs"></i>
        </button>
        <img class="w-full h-28 object-cover-no-referrer" src="${m.image || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300"}" referrerpolicy="no-referrer" alt="${m.name}">
        <div class="p-3 space-y-2 flex-1 flex flex-col justify-between">
          <div>
            <span class="text-[7.5px] uppercase font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full tracking-wide">${m.category || "General"}</span>
            <h4 class="font-extrabold text-slate-900 text-[11px] mt-1.5 truncate leading-tight tracking-tight font-display">${m.name}</h4>
            <p class="text-[9px] text-slate-400 truncate mt-0.5 leading-normal" title="${m.description}">${m.description || "Certified secure pharmaceutical product"}</p>
          </div>
          
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 gap-1">
            <span class="font-black text-slate-900 text-xs text-blue-600">₹${m.price}</span>
            
            ${qtyInCart > 0 ? `
              <!-- Quantities controller active border -->
              <div class="flex items-center gap-1.5 bg-blue-600 text-white rounded-full px-2.5 py-1 text-[9px] font-black shadow-xs">
                <button onclick="updateCartItemQty('${m.medicineId}', -1)" class="cursor-pointer hover:opacity-85 px-0.5"><i class="fa-solid fa-minus text-[7px]"></i></button>
                <span class="min-w-[10px] text-center">${qtyInCart}</span>
                <button onclick="updateCartItemQty('${m.medicineId}', 1)" class="cursor-pointer hover:opacity-85 px-0.5"><i class="fa-solid fa-plus text-[7px]"></i></button>
              </div>
            ` : `
              <!-- Action add selection -->
              <button onclick="addMedicineToCart('${m.medicineId}')" class="bg-blue-600 hover:bg-blue-700 text-white text-[8.5px] font-black py-1.5 px-3 rounded-full hover:shadow-xs transition-all cursor-pointer uppercase tracking-tight flex items-center gap-1">
                Add <i class="fa-solid fa-plus text-[7px]"></i>
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

// 4. MULTIPLE ADDRESS SEARCH ENGINE & GEOLOCATION (Geoapify)
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
  selectAutocompleteAddress(formatted: string, lat: number, lng: number) {
    addrInput.value = formatted;
    selectedAddressDetail = { address: formatted, lat, lng };
    addrSuggestions.classList.add("hidden");
    showToast("Destination marked successfully", "success");
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

  const orderPayload = {
    orderId,
    userId: loggedInUser.uid,
    userName: loggedInUser.displayName || "Patient client",
    userMobile: "9988776655", // Fallback mobile contact line
    userAddress: address,
    userLocation: { lat: userLat, lng: userLng },
    storeId: targetStore.storeId,
    storeName: targetStore.storeName,
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

// 7. TIMELINE & MAPS ROUTER BINDINGS (Geoapify static route maps)
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
    const mapImg = document.getElementById("tracker-map-img") as HTMLImageElement;
    const etaBadge = document.getElementById("tracker-eta")!;
    const riderName = document.getElementById("tracker-rider-name")!;
    const riderPhone = document.getElementById("tracker-rider-phone")!;
    const callRider = document.getElementById("lnk-call-rider") as HTMLAnchorElement;

    // Default static layout
    const userLat = o.userLocation?.lat || 12.9716;
    const userLng = o.userLocation?.lng || 77.5946;

    if (o.status === "out" && o.deliveryId) {
      // Subscribe and calculate maps parameters relative to real rider locations from DB!
      onValue(ref(db, `delivery/${o.deliveryId}`), (riderSnap) => {
        if (!riderSnap.exists()) return;
        const r = riderSnap.val();

        riderName.innerText = r.name || "Express Rider Partner";
        riderPhone.innerText = r.mobile || "10 Digit Line";
        callRider.href = `tel:${r.mobile || ""}`;

        const riderLat = r.location?.lat || 12.9716;
        const riderLng = r.location?.lng || 77.5946;

        const distance = calculateDistance(riderLat, riderLng, userLat, userLng);
        // ETA Speed (Assume average 35 KM/H city pacing)
        const eta = Math.ceil((distance / 35) * 60) + 5; // Distance time + packing buffering

        etaBadge.innerText = `ETA: ${eta} Mins (${distance} KM)`;
        mapImg.src = getRouteMapUrl(riderLat, riderLng, userLat, userLng);
      });
    } else {
      riderName.innerText = o.deliveryName || "Agent not assigned yet";
      riderPhone.innerText = "Standby process queue";
      callRider.removeAttribute("href");
      etaBadge.innerText = "Standby Status";
      mapImg.src = getStaticMapUrl(userLat, userLng, 14, 400, 180);
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
        <strong class="text-teal-600 font-extrabold uppercase text-[9px] block">📢 MedsHub Broadcast</strong>
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
  const tipText = document.getElementById("ai-smart-tip-text")!;

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
  if (confirm("Sign out from RS Meds Hub account?")) {
    signOut(auth).then(() => {
      window.location.href = "/index.html";
    });
  }
});

function openMyProfileEditor() {
  const html = `
    <div class="space-y-4 animate-fade-in p-1">
      <div class="space-y-1">
        <label class="block text-[9px] uppercase font-black text-slate-400 tracking-wider">Authentication Email</label>
        <input type="text" value="${profileData.email || loggedInUser.email || ""}" disabled class="w-full px-3 py-2 bg-slate-100 text-slate-500 border border-slate-200 rounded-xl text-xs font-bold font-mono cursor-not-allowed">
      </div>
      <div class="space-y-1">
        <label class="block text-[9px] uppercase font-black text-slate-400 tracking-wider">Full Name</label>
        <input type="text" id="edit-profile-name" value="${profileData.name || ""}" placeholder="Enter full name" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-bold outline-none transition-all">
      </div>
      <div class="space-y-1">
        <label class="block text-[9px] uppercase font-black text-slate-400 tracking-wider">Mobile Number</label>
        <input type="tel" id="edit-profile-phone" value="${profileData.phone || ""}" placeholder="+91 XXXXX XXXXX" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-semibold outline-none transition-all font-mono">
      </div>
      
      <button id="btn-save-edited-profile" class="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 rounded-xl transition-all shadow-md text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer">
        <i class="fa-solid fa-cloud-arrow-up"></i> Save Profile Settings
      </button>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-user-gear text-blue-600 mr-1.5"></i> My Personal Profile`, html);

  document.getElementById("btn-save-edited-profile")?.addEventListener("click", async () => {
    const nameVal = (document.getElementById("edit-profile-name") as HTMLInputElement).value.trim();
    const phoneVal = (document.getElementById("edit-profile-phone") as HTMLInputElement).value.trim();

    if (!nameVal) {
      showToast("Full name is required", "error");
      return;
    }

    try {
      await update(ref(db, `users/${loggedInUser.uid}`), {
        name: nameVal,
        phone: phoneVal
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
      addressListHtml = Object.entries(addrs).map(([key, val]: [string, any]) => `
        <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold animate-fade-in group hover:bg-blue-50/10">
          <div class="flex items-start gap-2.5 min-w-0 pr-2">
            <span class="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-[10px] shrink-0 mt-0.5"><i class="fa-solid fa-house-chimney"></i></span>
            <div class="min-w-0 leading-tight">
              <strong class="text-[10px] text-slate-800 uppercase tracking-tight block font-extrabold">${key}</strong>
              <span class="text-[9px] text-slate-400 font-semibold block truncate" title="${val}">${val}</span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button onclick="useStoredAddress('${key}')" class="text-[8px] bg-blue-100 hover:bg-blue-600 hover:text-white text-blue-600 font-black px-2 py-1 rounded transition-all cursor-pointer">SELECT</button>
            <button onclick="deleteStoredAddress('${key}')" class="w-6 h-6 rounded-lg bg-rose-50 hover:bg-rose-500 hover:text-white text-rose-500 flex items-center justify-center text-[10px] transition-all cursor-pointer"><i class="fa-regular fa-trash-can"></i></button>
          </div>
        </div>
      `).join("");
    } else {
      addressListHtml = `
        <div class="text-center py-6 text-slate-400">
          <i class="fa-solid fa-location-crosshairs text-2xl mb-1 text-slate-350"></i>
          <p class="text-[10px] font-semibold">No saved addresses configured.</p>
        </div>
      `;
    }
  } catch (err) {
    console.error(err);
  }

  const html = `
    <div class="space-y-4 animate-fade-in p-1">
      <div class="space-y-2.5 max-h-52 overflow-y-auto custom-scrollbar pr-1 divide-y divide-slate-50">
        ${addressListHtml}
      </div>

      <div class="border-t border-slate-100 pt-3.5 space-y-3">
        <h4 class="text-[10px] font-black text-slate-800 uppercase tracking-widest"><i class="fa-solid fa-circle-plus text-blue-500 mr-1 text-[11px]"></i>Add Address Destination</h4>
        <div class="grid grid-cols-2 gap-2">
          <input type="text" id="add-addr-label" placeholder="Label (Home, Work, etc.)" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-bold outline-none transition-all">
          <button id="btn-gps-addr" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-black text-[9.5px] rounded-xl flex items-center justify-center gap-1 cursor-pointer border border-indigo-100 transition-all">
            <i class="fa-solid fa-location-crosshairs animate-pulse"></i> Current GPS
          </button>
        </div>
        <textarea id="add-addr-val" rows="2" placeholder="Complete address path with building, lane, landmark etc." class="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white text-slate-800 rounded-xl text-xs font-semibold outline-none transition-all resize-none"></textarea>
        
        <button id="btn-save-new-addr" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 rounded-xl transition-all shadow-md text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer">
          <i class="fa-solid fa-map-pin"></i> Save Address Node
        </button>
      </div>
    </div>
  `;
  openProfileDrawer(`<i class="fa-solid fa-location-shield text-blue-600 mr-1.5"></i> Saved Addresses`, html);

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

  document.getElementById("btn-gps-addr")?.addEventListener("click", async () => {
    const gpsBtn = document.getElementById("btn-gps-addr") as HTMLButtonElement;
    gpsBtn.disabled = true;
    gpsBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Loading GPS`;
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
          <h4 class="text-2xl font-black font-display font-mono mt-0.5">${profileData.coins || 250} <span class="text-xs font-bold text-yellow-100 uppercase font-sans">Meds Coins</span></h4>
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
                <p>Thank you for choosing RS Meds Hub!</p>
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
        <p class="text-[10px] uppercase font-black text-slate-400 tracking-wider">How was your RS Meds Hub experience?</p>
        
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
      await set(ref(db, `users/${loggedInUser.uid}/reviews/${Date.now()}`), {
        rating: activeStarsSelected,
        comment: feedbackText,
        timestamp: Date.now()
      });
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
        <p class="text-[9.5px] text-slate-500 leading-relaxed font-semibold max-w-xs mx-auto">Get <strong class="text-emerald-600 font-extrabold">₹100 value</strong> credited inside Meds Hub wallet as soon as your referee confirms high-prio first orders.</p>
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
        <span>Disclaimer: RS Meds Hub AI Pharmacist assistant is programmed for general health insights only. Please consult certified practitioner for actual prescriptions.</span>
      </div>

      <div id="ai-chat-thread-box" class="flex-1 overflow-y-auto space-y-2.5 max-h-60 min-h-36 border border-slate-100 rounded-2xl p-3 bg-slate-50 font-sans custom-scrollbar">
        <div class="flex items-start gap-2 max-w-xs text-xs animate-fade-in">
          <div class="w-6.5 h-6.5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-black shrink-0"><i class="fa-solid fa-robot animate-bounce"></i></div>
          <div class="bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-100 shadow-xs text-slate-800 font-bold leading-normal">
            Hello! I am your AI Health Assistant. Ask me anything about medications, symptoms, or dosage guides.
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

  const pushMessage = (sender: "user" | "ai", text: string) => {
    const avatar = sender === "user" 
      ? `<div class="w-6.5 h-6.5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-black shrink-0 uppercase">${profileData.name?.charAt(0) || 'U'}</div>`
      : `<div class="w-6.5 h-6.5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-black shrink-0"><i class="fa-solid fa-robot"></i></div>`;
    
    const alignment = sender === "user" ? "flex-row-reverse animate-slide-in-right" : "";
    const bubbleColor = sender === "user" ? "bg-blue-600 text-white" : "bg-white text-slate-800 border border-slate-100";
    const roundedStyle = sender === "user" ? "rounded-tr-none" : "rounded-tl-none";

    const bubbleHtml = `
      <div class="flex items-start gap-2 ${alignment} max-w-xs text-xs animate-fade-in pt-1">
        ${avatar}
        <div class="${bubbleColor} p-2.5 rounded-2xl ${roundedStyle} shadow-xs font-semibold leading-normal">
          ${text}
        </div>
      </div>
    `;
    threadBox.insertAdjacentHTML("beforeend", bubbleHtml);
    threadBox.scrollTop = threadBox.scrollHeight;
  };

  const processResponse = (rawMsg: string) => {
    const lower = rawMsg.toLowerCase().trim();
    if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
      return "Hello! How can I assist you with your health query today?";
    }
    if (lower.includes("paracetamol") || lower.includes("fever") || lower.includes("crocin")) {
      return "Paracetamol/Crocin: Standard adult dosage is 500-650mg every 4-6 hours, up to a maximum of 4000mg/day. Ideal for pain relief and fever reducing. Do not pair with alcoholic beverages to protect hepatic functions.";
    }
    if (lower.includes("cough") || lower.includes("cold")) {
      return "For respiratory congestion & dry cough: dextromethorphan hydrobromide syrups are highly effective. If chest contains thick mucus combinations, look for guaifenesin expectorants. Ensure adequate hydration!";
    }
    if (lower.includes("allergy") || lower.includes("rash") || lower.includes("cetirizine")) {
      return "Cetirizine / Levocetirizine: standard antihistamines for allergic triggers (rhinitis, dry sneezing rashes). A standard 10mg dose before bedtime is ideal as it might trigger slight sedation effects.";
    }
    return "Based on my clinical database: Please manage symptoms by choosing dedicated organic medicines and staying fully hydrated. I strongly advise checking in with a certified doctor or pharmacist near you if discomfort persists for more than 48 hours.";
  };

  sendBtn?.addEventListener("click", () => {
    const query = queryInp.value.trim();
    if (!query) return;

    pushMessage("user", query);
    queryInp.value = "";

    sendBtn.disabled = true;
    const typingHtml = `<div id="ai-typing-temp" class="text-[9px] font-bold text-violet-500 animate-pulse pl-8 py-1">AI Pharmacist is compounding response...</div>`;
    threadBox.insertAdjacentHTML("beforeend", typingHtml);
    threadBox.scrollTop = threadBox.scrollHeight;

    setTimeout(() => {
      document.getElementById("ai-typing-temp")?.remove();
      const answer = processResponse(query);
      pushMessage("ai", answer);
      sendBtn.disabled = false;
    }, 1200);
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

