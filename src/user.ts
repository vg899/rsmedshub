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
const checkoutDrawer = document.getElementById("checkout-drawer") as HTMLDivElement;

const navHome = document.getElementById("navitem-home") as HTMLButtonElement;
const navCart = document.getElementById("navitem-cart") as HTMLButtonElement;
const navOrders = document.getElementById("navitem-orders") as HTMLButtonElement;

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
    if (snapshot.exists() && snapshot.val().role !== "user") {
      signOut(auth).then(() => {
        window.location.href = "/index.html";
      });
    } else if (snapshot.exists()) {
      showToast(`Logged in safely!`, "success");
      bootstrapGeoLocation();
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
navCart.addEventListener("click", () => {
  checkoutDrawer.classList.remove("hidden");
  renderCartDrawer();
});
navOrders.addEventListener("click", () => {
  toggleSections("orders");
  syncOrdersHistory();
});

function toggleSections(view: "home" | "orders") {
  if (view === "home") {
    userScrollSection.classList.remove("hidden");
    userOrdersSection.classList.add("hidden");
    navHome.className = "flex flex-col items-center gap-1 text-teal-500 text-xs font-black flex-1 focus:outline-none transition-all cursor-pointer";
    navOrders.className = "flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 text-xs font-bold flex-1 focus:outline-none transition-all cursor-pointer";
  } else {
    userOrdersSection.classList.remove("hidden");
    userScrollSection.classList.add("hidden");
    navOrders.className = "flex flex-col items-center gap-1 text-teal-500 text-xs font-black flex-1 focus:outline-none transition-all cursor-pointer";
    navHome.className = "flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 text-xs font-bold flex-1 focus:outline-none transition-all cursor-pointer";
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
    
    document.querySelectorAll(".cat-badge-btn").forEach((b) => b.className = "cat-badge-btn px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap bg-white text-slate-600 border border-slate-100 hover:bg-teal-50 hover:text-teal-600 transition-all shadow-xs");
    target.className = "cat-badge-btn px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap bg-teal-500 text-white transition-all shadow-xs";

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
    <button onclick="selectActiveStore('')" class="flex flex-col items-center justify-center p-3 w-28 bg-white border ${activeStoreId === "" ? "border-teal-500 bg-teal-50/10 text-teal-600" : "border-slate-100 text-slate-600"} rounded-2xl shadow-xs shrink-0 cursor-pointer text-center relative hover:scale-95 transition-all">
      <i class="fa-solid fa-hospital-user text-xl mb-1 text-teal-500"></i>
      <span class="text-[10px] font-black uppercase">All Bundled</span>
    </button>
  ` + allStores.map((s) => {
    const isSelected = s.storeId === activeStoreId;
    return `
      <button onclick="selectActiveStore('${s.storeId}')" class="flex flex-col items-center justify-center p-3 w-28 bg-white border ${isSelected ? "border-teal-500 bg-teal-50/10 text-teal-600" : "border-slate-100 text-slate-600"} rounded-2xl shadow-xs shrink-0 cursor-pointer text-center relative hover:scale-95 transition-all">
        <i class="fa-solid fa-mortar-pestle text-xl text-teal-500 mb-1"></i>
        <span class="text-[10px] font-black truncate w-full uppercase">${s.name}</span>
        <span class="text-[8px] text-slate-400 font-bold tracking-wide">${s.city || "Bengaluru"}</span>
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
      <div class="col-span-2 text-center py-12 text-slate-400 font-semibold text-xs">
        <i class="fa-solid fa-box-open text-2xl mb-2 text-slate-300"></i>
        <p>No medicines match your segment filters.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((m) => {
    const qtyInCart = cartItems[m.medicineId]?.qty || 0;
    return `
      <div class="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-xs flex flex-col justify-between">
        <img class="w-full h-28 object-cover" src="${m.image || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300"}" alt="${m.name}">
        <div class="p-3 space-y-2 flex-1 flex flex-col justify-between">
          <div>
            <span class="text-[8px] uppercase font-black text-teal-500 bg-teal-50 px-1.5 py-0.5 rounded">${m.category || "General"}</span>
            <h4 class="font-bold text-slate-900 text-xs mt-1.5 truncate leading-tight">${m.name}</h4>
            <p class="text-[9px] text-slate-400 truncate mt-0.5 leading-normal" title="${m.description}">${m.description || "Certified secure pharmaceutical product"}</p>
          </div>
          
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
            <span class="font-extrabold text-slate-900 text-xs">₹${m.price}</span>
            
            ${qtyInCart > 0 ? `
              <!-- Quantities controller active border -->
              <div class="flex items-center gap-1.5 bg-teal-500 text-white rounded-lg px-2 py-1 text-[10px] font-black">
                <button onclick="updateCartItemQty('${m.medicineId}', -1)" class="cursor-pointer hover:opacity-80 px-1"><i class="fa-solid fa-minus"></i></button>
                <span>${qtyInCart}</span>
                <button onclick="updateCartItemQty('${m.medicineId}', 1)" class="cursor-pointer hover:opacity-80 px-1"><i class="fa-solid fa-plus"></i></button>
              </div>
            ` : `
              <!-- Action add selection -->
              <button onclick="addMedicineToCart('${m.medicineId}')" class="bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold py-1 px-3 rounded-lg hover:-translate-y-0.5 transition-all cursor-pointer">
                ADD
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
