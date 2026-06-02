import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, update, remove, get } from "firebase/database";
import { showToast, uploadToCloudinary, getRouteMapUrl, getStaticMapUrl, loadMapplsScript, updateLeafletMap, calculateDistance, getMapplsRoute } from "./utils";

// Core Variables
let activeSection = "panel-overview";
let systemTimeInterval: any = null;
let ridersCache: any[] = [];
let adminStoresCache: any[] = [];

// Advanced Dashboard Cache Variables
let globalCustomers: any[] = [];
let userSearchQuery = "";
let notificationsCache: any[] = [];
let complaintsCache: any[] = [];
let globalReviewsCache: any[] = [];
let mediaAssetsCache: any[] = [];
let inactivityLimitSeconds = 300;
let inactivityEnabled = false;
let lastUserActivityTime = Date.now();
let activeReviewsStarFilter = "all";
let reviewsSearchQuery = "";

// Auth Check & Block Unauthorized Access
onAuthStateChanged(auth, (user) => {
  if (!user) {
    showToast("Unauthorized. Please log in first.", "error");
    window.location.href = "/index.html";
    return;
  }

  // Double check admin role
  get(ref(db, `users/${user.uid}`)).then((snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (data.role !== "admin") {
        showToast("Access Denied: Redirecting to your panel...", "info");
        if (data.role === "user") {
          window.location.href = "/user.html";
        } else if (data.role === "store") {
          window.location.href = "/store.html";
        } else if (data.role === "delivery") {
          window.location.href = "/delivery.html";
        } else {
          signOut(auth).then(() => {
            window.location.href = "/index.html";
          });
        }
      } else {
        document.getElementById("admin-name-txt")!.innerText = data.name || "Administrator";
        initDashboard();
        if (typeof (window as any).initRiderVerificationListeners === "function") {
          (window as any).initRiderVerificationListeners();
        }
      }
    } else {
      showToast("User details not found.", "error");
      signOut(auth).then(() => {
        window.location.href = "/index.html";
      });
    }
  });
});

// Navigation Toggle logic
document.querySelectorAll(".admin-nav-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const targetButton = e.currentTarget as HTMLButtonElement;
    const targetPanel = targetButton.getAttribute("data-target")!;
    
    document.querySelectorAll(".admin-nav-btn").forEach((b) => b.classList.remove("active", "bg-teal-500", "text-white"));
    document.querySelectorAll(".admin-panel").forEach((p) => p.classList.add("hidden"));

    targetButton.classList.add("active", "bg-teal-500", "text-white");
    const panelEl = document.getElementById(targetPanel);
    if (panelEl) {
      panelEl.classList.remove("hidden");
    }
    activeSection = targetPanel;
  });
});

// Set clock timer
function startSystemClock() {
  const clockEl = document.getElementById("system-time-txt");
  if (!clockEl) return;
  
  if (systemTimeInterval) clearInterval(systemTimeInterval);

  systemTimeInterval = setInterval(() => {
    const now = new Date();
    clockEl.innerText = now.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "UTC"
    }) + " UTC";
  }, 1000);
}
startSystemClock();

// Sign out trigger
document.getElementById("btn-signout")?.addEventListener("click", async () => {
  if (confirm("Are you sure you want to sign out from Admin Control?")) {
    await signOut(auth);
    window.location.href = "/index.html";
  }
});

// Main Real-time Bindings
function initDashboard() {
  // Bind Stats & Subscriptions
  subscribeToStats();
  subscribeToOrders();
  subscribeToFinanceArea();
  subscribeToBannersCoupons();
  subscribeToWarehouses();
  checkAndPreloadCategories();
  subscribeToCategories();
  setupCategoryFormListeners();
  initStoreManagementCenter();

  // Initialize Advanced Hubs
  initRiderFinanceCenter();
  initNotificationsCenter();
  initReviewsComplaintsHub();
  initCloudinaryMediaHub();
  initPlatformSettings();
  initSupportCenterManagement();

  // Connect customer search input field
  document.getElementById("user-search-input")?.addEventListener("input", (e) => {
    userSearchQuery = (e.target as HTMLInputElement).value;
    renderFilteredCustomers();
  });

  // Start real-time dispatch command tracker
  initLiveLogisticsTracker();
}

// 1. STATS ENGINE
interface OrderDetails {
  orderId: string;
  subtotal: number;
  total: number;
  gst: number;
  platformFee: number;
  deliveryCharge: number;
  discount: number;
  status: string;
  storeId?: string;
  storeName?: string;
  deliveryId?: string;
  deliveryName?: string;
  items?: any[];
  paymentMethod?: string;
  createdAt?: number;
  userName?: string;
  userMobile?: string;
  userAddress?: string;
  storeLocation?: { lat: number; lng: number } | any;
  userLocation?: { lat: number; lng: number } | any;
  settlementPaid?: boolean;
}

function subscribeToStats() {
  // Real-time counter subscriptions
  onValue(ref(db, "users"), (snapshot) => {
    try {
      let clients = 0;
      let total = 0;
      const items: any[] = [];
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          total++;
          const u = child.val();
          if (u) {
            u.uid = child.key;
            if (u.role === "user") {
              clients++;
              items.push(u);
            }
          }
        });
      }

      const statUsers = document.getElementById("stat-users");
      if (statUsers) {
        statUsers.innerText = clients.toString();
      }
      globalCustomers = items;
      renderFilteredCustomers();
    } catch (err) {
      console.error("Error in onValue(users):", err);
    }
  });

  onValue(ref(db, "stores"), (snapshot) => {
    try {
      let active = 0;
      let total = 0;
      const items: any[] = [];

      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const s = child.val();
          if (s) {
            total++;
            if (s.active) active++;
            items.push(s);
          }
        });
      }

      const statStores = document.getElementById("stat-stores");
      if (statStores) statStores.innerText = total.toString();

      const statStoresActive = document.getElementById("stat-stores-active");
      if (statStoresActive) statStoresActive.innerText = `${active} Active Nodes`;

      const cntStores = document.getElementById("cnt-stores");
      if (cntStores) cntStores.innerText = `${total} Stores`;

      adminStoresCache = items;
      renderStoresTable(items);
      updateGeoapifyAdminMap(items);
    } catch (err) {
      console.error("Error in onValue(stores):", err);
    }
  });

  onValue(ref(db, "deliveryboy1"), (snapshot) => {
    try {
      let active = 0;
      let total = 0;
      const items: any[] = [];

      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const d = child.val();
          if (d) {
            total++;
            if (!d.deliveryId) {
              d.deliveryId = child.key || "";
            }
            if (!d.uid) {
              d.uid = child.key || "";
            }
            if (d.active) active++;
            items.push(d);
          }
        });
      }

      const statDelivery = document.getElementById("stat-delivery");
      if (statDelivery) statDelivery.innerText = total.toString();

      const statActive = document.getElementById("stat-delivery-active");
      if (statActive) statActive.innerText = `${active} Active Riders`;

      const cntRiders = document.getElementById("cnt-riders");
      if (cntRiders) cntRiders.innerText = `${total} Riders`;

      ridersCache = items;
      renderRidersTable(items);
      if (typeof (window as any).renderVerificationCenter === "function") {
        (window as any).renderVerificationCenter(items);
      }
      if (typeof (window as any).recalculateAndRenderFinanceDashboard === "function") {
        (window as any).recalculateAndRenderFinanceDashboard();
      }
    } catch (err) {
      console.error("Error in onValue(delivery):", err);
    }
  });
}

// 2. PARTNERS TABLES RENDERING
function renderStoresTable(stores: any[]) {
  const tbody = document.getElementById("tbody-stores");
  if (!tbody) return;

  if (stores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400 font-medium">No pharmacy nodes registered yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = stores.map((s) => {
    const storeId = s.storeId || "";
    const shortId = storeId ? `${storeId.substring(0, 6)}...` : "N/A";
    const name = s.name || "Unnamed Store";
    const ownerName = s.ownerName || "No Owner";
    const email = s.email || "N/A";
    const mobile = s.mobile || "N/A";
    const city = s.city || "Bengaluru";
    const approved = s.approved !== undefined ? s.approved : false;
    const active = s.active !== undefined ? s.active : true;

    return `
    <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-all font-medium">
      <td class="px-5 py-3">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded bg-sky-50 text-sky-600 flex items-center justify-center text-xs font-bold border border-sky-100">
            <i class="fa-solid fa-mortar-pestle"></i>
          </div>
          <div>
            <h4 class="font-bold text-slate-900">${name}</h4>
            <span class="text-[10px] text-slate-400 font-mono">${shortId}</span>
          </div>
        </div>
      </td>
      <td class="px-5 py-3">
        <div class="text-xs font-semibold">${ownerName}</div>
        <div class="text-[11px] text-slate-400 font-mono">${email} | ${mobile}</div>
      </td>
      <td class="px-5 py-3">
        <span class="bg-indigo-50 text-indigo-700 text-[10px] px-2 py-0.5 rounded font-black uppercase">${city}</span>
      </td>
      <td class="px-5 py-3">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${approved ? "bg-emerald-50 text-emerald-700" : "bg-yellow-50 text-yellow-700"}">
            ${approved ? "Approved" : "Pending Approval"}
          </span>
          <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}">
            ${active ? "Active" : "Deactivated"}
          </span>
        </div>
      </td>
      <td class="px-5 py-3 text-right space-x-1.5">
        ${!approved ? `
          <button onclick="approveStore('${storeId}')" class="bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all">Approve</button>
          <button onclick="rejectStore('${storeId}')" class="bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all">Reject</button>
        `: `
          <button onclick="toggleStoreActive('${storeId}', ${active})" class="text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all border ${active ? "border-slate-200 text-slate-600 bg-white hover:bg-slate-50" : "bg-emerald-500 text-white border-transparent hover:bg-emerald-600"}">
            ${active ? "Deactivate" : "Activate"}
          </button>
        `}
      </td>
    </tr>
    `;
  }).join("");
}

function renderRidersTable(riders: any[]) {
  const tbody = document.getElementById("tbody-riders");
  if (!tbody) return;

  if (riders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400 font-medium">No riders registered yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = riders.map((r) => {
    const rid = r.deliveryId || "";
    const shortId = rid ? rid.substring(0, 6) : "N/A";
    const name = r.name || "Anonymous Rider";
    const mobile = r.mobile || "N/A";
    const email = r.email || "N/A";
    const status = r.status || "free";
    const approved = r.approved !== undefined ? r.approved : false;
    const active = r.active !== undefined ? r.active : true;

    return `
    <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-all font-medium">
      <td class="px-5 py-3 flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center text-xs border border-amber-100">
          <i class="fa-solid fa-user-ninja"></i>
        </div>
        <div>
          <h4 class="font-bold text-slate-900">${name}</h4>
          <span class="text-[10px] text-slate-400 font-mono">Rider ID: ${shortId}</span>
        </div>
      </td>
      <td class="px-5 py-3">
        <div class="text-xs font-semibold">${mobile}</div>
        <div class="text-[10px] text-slate-400 font-mono">${email}</div>
      </td>
      <td class="px-5 py-3">
        <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${status === "busy" ? "bg-rose-50 text-rose-700 animate-pulse" : "bg-emerald-50 text-emerald-700"}">
          ${status === "busy" ? "On Duty" : "Standby/Free"}
        </span>
      </td>
      <td class="px-5 py-3">
        <div class="flex gap-1.5 flex-wrap">
          <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${approved ? "bg-emerald-100 text-emerald-800" : "bg-yellow-50 text-yellow-700"}">
            ${approved ? "Approved" : "Pending"}
          </span>
          <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-50 text-slate-500"}">
            ${active ? "Active" : "Suspended"}
          </span>
        </div>
      </td>
      <td class="px-5 py-3 text-right space-x-1.5 whitespace-nowrap">
        <button onclick="viewRiderKyc('${rid}')" class="bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-150 text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all inline-flex items-center gap-1">
          <i class="fa-solid fa-file-shield text-[11px]"></i> Verify KYC
        </button>
        ${!approved ? `
          <button onclick="approveRider('${rid}')" class="bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all inline-block">Approve</button>
          <button onclick="rejectRider('${rid}')" class="bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all inline-block">Reject</button>
        `: `
          <button onclick="toggleRiderActive('${rid}', ${active})" class="text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all border inline-block ${active ? "border-slate-200 text-slate-600 bg-white hover:bg-slate-50" : "bg-emerald-500 text-white border-transparent hover:bg-emerald-600"}">
            ${active ? "Disable" : "Enable"}
          </button>
        `}
      </td>
    </tr>
    `;
  }).join("");
}

function renderCustomersTable(customers: any[]) {
  const tbody = document.getElementById("tbody-customers");
  if (!tbody) return;
  if (customers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400 font-medium">No general customer profiles synced.</td></tr>`;
    return;
  }

  tbody.innerHTML = customers.map((c) => `
    <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-all font-medium text-xs">
      <td class="px-5 py-3 font-bold text-slate-900">${c.name}</td>
      <td class="px-5 py-3 font-mono text-slate-500">${c.email}</td>
      <td class="px-5 py-3 font-semibold text-slate-600">${c.mobile || "N/A"}</td>
      <td class="px-5 py-3">
        <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded ${c.isBlocked ? "bg-rose-100 text-rose-800" : "bg-emerald-50 text-emerald-700"}">
          ${c.isBlocked ? "Blocked" : "Healthy Info"}
        </span>
      </td>
      <td class="px-5 py-3 text-right space-x-1.5 whitespace-nowrap">
        <button onclick="inspectPatientDossier('${c.uid}')" class="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50 transition-all cursor-pointer">
          <i class="fa-solid fa-address-card"></i> Dossier
        </button>
        <button onclick="toggleBlockCustomer('${c.uid}', ${c.isBlocked || false})" class="text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${c.isBlocked ? "bg-emerald-500 text-white border-transparent hover:bg-emerald-600" : "border-rose-200 text-rose-600 bg-white hover:bg-rose-50"}">
          ${c.isBlocked ? "Unblock Client" : "Block Client"}
        </button>
      </td>
    </tr>
  `).join("");
}

// Global functions registered on window for HTML onclick triggers
Object.assign(window, {
  approveStore(id: string) {
    update(ref(db, `users/${id}`), { approved: true });
    update(ref(db, `stores/${id}`), { approved: true });
    showToast("Store approved!", "success");
  },
  rejectStore(id: string) {
    if (confirm("Are you sure you want to reject and delete this registration?")) {
      remove(ref(db, `users/${id}`));
      remove(ref(db, `stores/${id}`));
      showToast("Store application deleted.", "info");
    }
  },
  toggleStoreActive(id: string, current: boolean) {
    update(ref(db, `stores/${id}`), { active: !current });
    showToast(`Store ${!current ? "activated" : "deactivated"}!`, "success");
  },
  approveRider(id: string) {
    update(ref(db, `users/${id}`), { approved: true });
    update(ref(db, `deliveryboy1/${id}`), { approved: true, verificationStatus: "Approved" });
    showToast("Rider approved!", "success");
  },
  rejectRider(id: string) {
    if (confirm("Reject and remove this rider profile?")) {
      remove(ref(db, `users/${id}`));
      remove(ref(db, `deliveryboy1/${id}`));
      showToast("Rider application deleted.", "info");
    }
  },
  toggleRiderActive(id: string, current: boolean) {
    update(ref(db, `deliveryboy1/${id}`), { active: !current, verificationStatus: !current ? "Approved" : "Suspended" });
    showToast(`Rider ${!current ? "enabled" : "disabled"}!`, "success");
  },
  toggleBlockCustomer(id: string, current: boolean) {
    update(ref(db, `users/${id}`), { isBlocked: !current });
    showToast(`User ${!current ? "blocked" : "unblocked"} successfully!`, "success");
  },
  viewRiderKyc(id: string) {
    const r = ridersCache.find((item) => item.deliveryId === id);
    if (!r) {
      showToast("Rider profile details not found in cache.", "error");
      return;
    }
    
    const kycModal = document.getElementById("rider-kyc-modal");
    const kycContent = document.getElementById("rider-kyc-modal-content");
    if (!kycModal || !kycContent) return;

    const name = r.name || "Anonymous Rider";
    const email = r.email || "N/A";
    const mobile = r.mobile || "N/A";
    const aadhaar = r.aadhaarNumber || "Not filled";
    const dlNumber = r.licenseNumber || "Not filled";
    const vehicleType = r.vehicleType || "Not filled";
    const vehicleNumber = r.vehicleNumber || "Not filled";
    const state = r.state || "Not filled";
    const district = r.district || "Not filled";
    const status = r.status || "free";
    const approved = r.approved !== undefined ? r.approved : false;
    const active = r.active !== undefined ? r.active : true;
    const submitted = r.onboardSubmitted !== undefined ? r.onboardSubmitted : false;

    const aadFront = r.aadhaarFrontUrl || "";
    const aadBack = r.aadhaarBackUrl || "";
    const dlImage = r.licenseImageUrl || "";

    kycContent.innerHTML = `
      <div class="border-b border-slate-100 pb-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-lg border border-indigo-100">
            <i class="fa-solid fa-file-invoice"></i>
          </div>
          <div>
            <h3 class="text-base font-extrabold text-slate-900 text-left">Rider Partner KYC Inspection</h3>
            <span class="text-xs text-slate-400 font-semibold block text-left">Verify identity documents and credentials</span>
          </div>
        </div>
        <div class="text-right">
          <span class="text-[10px] text-slate-400 block font-mono">ID: ${id.substring(0, 10)}</span>
          <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${status === "busy" ? "bg-rose-50 text-rose-700 font-bold" : "bg-emerald-50 text-emerald-700 font-bold"}">
            ${status === "busy" ? "On Duty" : "Standby/Free"}
          </span>
        </div>
      </div>

      <!-- Quick Summary Badges -->
      <div class="flex gap-2 flex-wrap text-xs">
        <span class="px-2 py-0.5 rounded font-black uppercase ${submitted ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-700"}">
          ${submitted ? "Onboard Details Submitted" : "Incomplete Onboard Draft"}
        </span>
        <span class="px-2 py-0.5 rounded font-black uppercase ${approved ? "bg-emerald-50 text-emerald-700" : "bg-yellow-50 text-yellow-700"}">
          Status: ${approved ? "Approved" : "Pending Approval"}
        </span>
        <span class="px-2 py-0.5 rounded font-black uppercase ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-50 text-slate-500"}">
          Duty: ${active ? "Active" : "Suspended"}
        </span>
      </div>

      <!-- 2 Column Layout with Details & Documents -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs text-slate-600 text-left">
        
        <!-- Left Side: Fields -->
        <div class="space-y-3.5 bg-slate-50 p-4 rounded-2xl border border-slate-100">
          <h4 class="font-bold text-slate-900 border-b border-slate-200 pb-1.5 flex items-center gap-1.5 leading-none">
            <i class="fa-solid fa-user-gear text-slate-400"></i>
            <span>Rider Information</span>
          </h4>
          
          <div class="grid grid-cols-3 gap-y-2.5">
            <span class="font-bold text-slate-400">Full Name:</span>
            <span class="col-span-2 font-black text-slate-800">${name}</span>

            <span class="font-bold text-slate-400">Mobile:</span>
            <span class="col-span-2 font-mono font-bold text-slate-800">${mobile}</span>

            <span class="font-bold text-slate-400">Email:</span>
            <span class="col-span-2 font-mono text-slate-800">${email}</span>

            <span class="font-bold text-slate-400">Aadhaar No:</span>
            <span class="col-span-2 font-mono text-slate-800">${aadhaar}</span>

            <span class="font-bold text-slate-400">DL Number:</span>
            <span class="col-span-2 font-mono uppercase text-slate-800">${dlNumber}</span>

            <span class="font-bold text-slate-400">Vehicle:</span>
            <span class="col-span-2 font-semibold capitalize text-slate-800">${vehicleType}</span>

            <span class="font-bold text-slate-400">Plate No:</span>
            <span class="col-span-2 font-mono uppercase text-slate-800">${vehicleNumber}</span>

            <span class="font-bold text-slate-400">State:</span>
            <span class="col-span-2 font-semibold text-slate-800">${state}</span>

            <span class="font-bold text-slate-400">District:</span>
            <span class="col-span-2 font-semibold text-slate-800">${district}</span>
          </div>
        </div>

        <!-- Right Side: Document Photos -->
        <div class="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
          <h4 class="font-bold text-slate-900 border-b border-slate-200 pb-1.5 flex items-center gap-1.5 leading-none">
            <i class="fa-solid fa-passport text-slate-400"></i>
            <span>Uploaded KYC Files</span>
          </h4>
          
          <!-- Aadhaar front/back -->
          <div class="space-y-1.5">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-left">Aadhaar Identity Card</div>
            <div class="grid grid-cols-2 gap-2">
              <div class="relative bg-white rounded-xl border border-slate-200 overflow-hidden group aspect-video">
                ${aadFront ? `
                  <img src="${aadFront}" class="w-full h-full object-cover cursor-pointer hover:scale-105 transition-all" onclick="window.open('${aadFront}', '_blank')" alt="Aadhaar Front" referrerPolicy="no-referrer" />
                  <div class="absolute bottom-0 inset-x-0 bg-slate-950/60 text-white text-[9px] py-0.5 text-center font-bold">Front Copy</div>
                ` : `
                  <div class="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1 bg-white">
                    <i class="fa-solid fa-image text-lg"></i>
                    <span class="text-[9px]">Not Uploaded</span>
                  </div>
                `}
              </div>
              <div class="relative bg-white rounded-xl border border-slate-200 overflow-hidden group aspect-video">
                ${aadBack ? `
                  <img src="${aadBack}" class="w-full h-full object-cover cursor-pointer hover:scale-105 transition-all" onclick="window.open('${aadBack}', '_blank')" alt="Aadhaar Back" referrerPolicy="no-referrer" />
                  <div class="absolute bottom-0 inset-x-0 bg-slate-950/60 text-white text-[9px] py-0.5 text-center font-bold">Back Copy</div>
                ` : `
                  <div class="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1 bg-white">
                    <i class="fa-solid fa-image text-lg"></i>
                    <span class="text-[9px]">Not Uploaded</span>
                  </div>
                `}
              </div>
            </div>
          </div>

          <!-- License copy -->
          <div class="space-y-1.5">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-left">Driving License</div>
            <div class="relative bg-white rounded-xl border border-slate-200 overflow-hidden group aspect-video h-20">
              ${dlImage ? `
                <img src="${dlImage}" class="w-full h-full object-cover cursor-pointer hover:scale-105 transition-all" onclick="window.open('${dlImage}', '_blank')" alt="Driving License" referrerPolicy="no-referrer" />
                <div class="absolute bottom-0 inset-x-0 bg-slate-950/60 text-white text-[9px] py-0.5 text-center font-bold">DL Image</div>
              ` : `
                <div class="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1 bg-white">
                  <i class="fa-solid fa-image text-lg"></i>
                  <span class="text-[9px]">Not Uploaded</span>
                </div>
              `}
            </div>
          </div>
        </div>
      </div>

      <!-- Actions Footer inside modal -->
      <div class="border-t border-slate-100 pt-4 flex flex-wrap justify-between items-center gap-3">
        <div>
          ${r.createdAt ? `
            <span class="text-[10px] text-slate-400 font-mono">Date Registered: ${new Date(r.createdAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC</span>
          ` : ""}
        </div>
        <div class="flex gap-2">
          ${!approved ? `
            <button onclick="approveRiderFromKyc('${id}')" class="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 shadow-sm">
              <i class="fa-solid fa-user-check"></i> Approve Rider
            </button>
            <button onclick="rejectRiderFromKyc('${id}')" class="bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold px-4 py-2 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 shadow-sm">
              <i class="fa-solid fa-user-times"></i> Reject Application
            </button>
          ` : `
            <button onclick="toggleRiderActiveFromKyc('${id}', ${active})" class="bg-slate-950 text-white hover:bg-slate-800 text-xs font-bold px-4 py-2 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 shadow-sm">
              <i class="fa-solid ${active ? "fa-user-slash" : "fa-user-shield"}"></i> ${active ? "Suspend Duty" : "Activate Duty"}
            </button>
            <span class="text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-xl font-extrabold text-xs flex items-center gap-1">
              <i class="fa-solid fa-circle-check text-[14px]"></i> Approved Rider
            </span>
          `}
        </div>
      </div>
    `;

    kycModal.classList.remove("hidden");
  },
  approveRiderFromKyc(id: string) {
    update(ref(db, `users/${id}`), { approved: true });
    update(ref(db, `deliveryboy1/${id}`), { approved: true, verificationStatus: "Approved" }).then(() => {
      showToast("Rider approved successfully!", "success");
      setTimeout(() => {
        // Find updated details from ridersCache to re-render in modal
        const r = ridersCache.find((item) => item.deliveryId === id);
        if (r) {
          r.approved = true;
          r.verificationStatus = "Approved";
          (window as any).viewRiderKyc(id);
        }
      }, 200);
    });
  },
  rejectRiderFromKyc(id: string) {
    if (confirm("Reject and remove this rider profile?")) {
      remove(ref(db, `users/${id}`));
      remove(ref(db, `deliveryboy1/${id}`)).then(() => {
        showToast("Rider application deleted.", "info");
        document.getElementById("rider-kyc-modal")?.classList.add("hidden");
      });
    }
  },
  toggleRiderActiveFromKyc(id: string, current: boolean) {
    update(ref(db, `deliveryboy1/${id}`), { active: !current, verificationStatus: !current ? "Approved" : "Suspended" }).then(() => {
      showToast(`Rider state changed!`, "success");
      setTimeout(() => {
        // Find and update item in cache locally for seamless responsive state
        const r = ridersCache.find((item) => item.deliveryId === id);
        if (r) {
          r.active = !current;
          r.verificationStatus = !current ? "Approved" : "Suspended";
          (window as any).viewRiderKyc(id);
        }
      }, 200);
    });
  }
});

// 3. ORDERS REAL-TIME MONITORING
let ordersCache: OrderDetails[] = [];
let ordersFilter = "all";

function subscribeToOrders() {
  onValue(ref(db, "orders"), (snapshot) => {
    try {
      ordersCache = [];
      let completedEarnings = 0;
      let pendingCount = 0;
      
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const order = child.val() as OrderDetails;
          if (order) {
            ordersCache.push(order);

            if (order.status === "delivered") {
              // Earnings = platformFee (₹) + (subtotal * commissionRate / 100)
              completedEarnings += (order.platformFee || 5) + ((order.subtotal || 0) * 0.10); // 10% standard admin fee
            } else {
              pendingCount++;
            }
          }
        });
      }

      const statOrders = document.getElementById("stat-orders");
      if (statOrders) statOrders.innerText = ordersCache.length.toString();

      const statOrdersPending = document.getElementById("stat-orders-pending");
      if (statOrdersPending) statOrdersPending.innerText = `${pendingCount} Processing Deliveries`;

      const statEarnings = document.getElementById("stat-earnings");
      if (statEarnings) statEarnings.innerText = `₹${Math.ceil(completedEarnings)}`;

      applyOrdersFilter();
      renderSettlementFinance();
      if (typeof (window as any).recalculateAndRenderFinanceDashboard === "function") {
        (window as any).recalculateAndRenderFinanceDashboard();
      }
      buildAnalyticsChart(ordersCache, completedEarnings);
    } catch (err) {
      console.error("Error inside subscribeToOrders:", err);
    }
  });
}

const filterButtons = document.querySelectorAll(".order-filter-btn");
filterButtons.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const target = e.currentTarget as HTMLButtonElement;
    ordersFilter = target.getAttribute("data-filter")!;

    filterButtons.forEach((b) => b.className = "order-filter-btn px-3.5 py-1.5 rounded-full text-xs font-bold bg-white text-slate-600 border border-slate-200 cursor-pointer hover:bg-slate-100 transition-all");
    target.className = "order-filter-btn px-3.5 py-1.5 rounded-full text-xs font-bold bg-slate-900 text-white cursor-pointer transition-all";

    applyOrdersFilter();
  });
});

function applyOrdersFilter() {
  const container = document.getElementById("admin-orders-list");
  if (!container) return;
  const filtered = ordersCache.filter((o) => ordersFilter === "all" || o.status === ordersFilter);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="p-12 text-center text-slate-400 font-semibold text-xs">No orders in this segment.</div>`;
    return;
  }

  // Sort orders descending
  filtered.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));

  container.innerHTML = filtered.map((o) => {
    let statusBg = "bg-yellow-50 text-yellow-700 border-yellow-100";
    if (o.status === "accepted") statusBg = "bg-teal-50 text-teal-700 border-teal-100";
    if (o.status === "packed") statusBg = "bg-indigo-50 text-indigo-700 border-indigo-100";
    if (o.status === "out") statusBg = "bg-sky-50 text-sky-700 border-sky-100 bg-teal-50/50";
    if (o.status === "delivered") statusBg = "bg-emerald-50 text-emerald-700 border-emerald-100";

    return `
      <div class="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 transition-all text-xs font-medium border-b border-slate-50">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="font-extrabold text-slate-900">Order #${o.orderId.substring(0,8).toUpperCase()}</span>
            <span class="border px-2 py-0.5 rounded-full font-black text-[9px] uppercase ${statusBg}">${o.status}</span>
          </div>
          <p class="text-[11px] text-slate-500 font-bold">Store: <span class="text-slate-700">${o.storeName || "Not assigned"}</span> | Rider: <span class="text-slate-700">${o.deliveryName || "Unassigned"}</span></p>
          <p class="text-[11px] text-slate-400 font-mono">Date: ${o.createdAt ? new Date(o.createdAt).toLocaleString() : "N/A"}</p>
        </div>
        <div class="flex items-center gap-4 text-right">
          <div>
            <div class="font-black text-slate-900 text-sm">₹${Math.round(o.total)}</div>
            <div class="text-[9px] text-slate-400 uppercase font-black">C.O.D. ONLY</div>
          </div>
          <button onclick="viewInvoiceDetail('${o.orderId}')" class="bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 px-3 rounded-xl hover:-translate-y-0.5 transition-all cursor-pointer">
            <i class="fa-solid fa-receipt mr-1"></i>Invoice
          </button>
        </div>
      </div>
    `;
  }).join("");
}

// 4. INVOICE OVERLAY MANAGEMENTS
Object.assign(window, {
  viewInvoiceDetail(orderId: string) {
    const o = ordersCache.find((order) => order.orderId === orderId);
    if (!o) return;

    const modal = document.getElementById("invoice-modal");
    const content = document.getElementById("invoice-modal-content");
    if (!modal || !content) return;
    
    // Delivery partner payout & Store payout calculation
    const commRate = 10; // 10% standard admin fee
    const commission = Math.round(o.subtotal * (commRate / 100));
    const storePayout = Math.round(o.subtotal + o.gst - commission);
    const riderPayout = o.deliveryCharge || 40;

    content.innerHTML = `
      <div class="border-b border-dashed border-slate-200 pb-4 text-center">
        <div class="inline-flex items-center justify-center w-12 h-12 bg-teal-50 text-teal-500 rounded-full mb-2">
          <i class="fa-solid fa-laptop-medical text-xl animate-spin-slow"></i>
        </div>
        <h2 class="text-lg font-black tracking-tight text-slate-900">MedsHub Receipt Invoice</h2>
        <p class="text-[11px] text-slate-400 font-mono mt-1">Transaction Ref: #${o.orderId.toUpperCase()}</p>
      </div>

      <div class="grid grid-cols-2 gap-4 text-[11px] border-b border-slate-100 pb-4">
        <div>
          <span class="text-slate-400 block font-bold uppercase">Customer Profile</span>
          <span class="font-bold text-slate-800">${o.userName || "Guest User"}</span>
          <span class="text-slate-500 block font-semibold mt-0.5">${o.userMobile || ""}</span>
          <span class="text-slate-400 leading-relaxed block truncate mt-0.5" title="${o.userAddress}">${o.userAddress || ""}</span>
        </div>
        <div class="text-right">
          <span class="text-slate-400 block font-bold uppercase">Connected Partner</span>
          <span class="font-bold text-slate-850 text-yellow-700 block">${o.storeName || "Pharmacy"}</span>
          <span class="text-slate-400 block font-mono text-[9px] mt-1">Status: <strong class="uppercase">${o.status}</strong></span>
        </div>
      </div>

      <div class="space-y-2 border-b border-slate-100 pb-4">
        <span class="text-slate-400 block text-[10px] font-black uppercase">Medicines Transferred</span>
        <div class="space-y-1.5">
          ${o.items?.map((item: any) => `
            <div class="flex justify-between text-xs font-semibold">
              <span class="text-slate-700">${item.name} <strong class="text-teal-600">x${item.qty}</strong></span>
              <span class="text-slate-900 font-mono">₹${item.price * item.qty}</span>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="space-y-1.5 border-b border-slate-100 pb-4 text-xs">
        <div class="flex justify-between font-semibold text-slate-500">
          <span>Subtotal:</span>
          <span class="font-mono">₹${Math.round(o.subtotal)}</span>
        </div>
        <div class="flex justify-between font-semibold text-slate-500">
          <span>Tax (GST 12%):</span>
          <span class="font-mono">₹${Math.round(o.gst)}</span>
        </div>
        <div class="flex justify-between font-semibold text-slate-500">
          <span>Delivery Rider Charge:</span>
          <span class="font-mono">₹${Math.round(o.deliveryCharge)}</span>
        </div>
        <div class="flex justify-between font-semibold text-slate-500">
          <span>MedsHub Platform Fee:</span>
          <span class="font-mono">₹${Math.round(o.platformFee)}</span>
        </div>
        ${o.discount ? `
          <div class="flex justify-between font-semibold text-emerald-600">
            <span>Coupon Discount Applied:</span>
            <span class="font-mono">-₹${Math.round(o.discount)}</span>
          </div>
        ` : ""}
        <div class="flex justify-between text-sm font-extrabold text-slate-900 pt-2">
          <span>Bill total collected (COD):</span>
          <span class="font-mono text-teal-600">₹${Math.round(o.total)}</span>
        </div>
      </div>

      <!-- Financial Settlements Breakdowns -->
      <div class="p-3 bg-slate-50 rounded-xl space-y-1.5 border border-slate-100">
        <h4 class="text-[10px] font-black text-slate-400 uppercase tracking-wider">Settlement Distributions</h4>
        <div class="flex justify-between text-[11px] font-bold text-slate-700">
          <span>Store payout quota (₹Subtotal + ₹GST - 10% Comms):</span>
          <span class="font-mono">₹${storePayout}</span>
        </div>
        <div class="flex justify-between text-[11px] font-bold text-slate-700">
          <span>Rider deliver payout weight:</span>
          <span class="font-mono">₹${riderPayout}</span>
        </div>
        <div class="flex justify-between text-[11px] font-bold text-teal-700 border-t border-slate-200 mt-1.5 pt-1">
          <span>Admin Platform Profit:</span>
          <span class="font-mono">₹${(o.platformFee || 5) + commission}</span>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");
  }
});

document.getElementById("btn-close-invoice")?.addEventListener("click", () => {
  document.getElementById("invoice-modal")?.classList.add("hidden");
});

document.getElementById("btn-close-rider-kyc")?.addEventListener("click", () => {
  document.getElementById("rider-kyc-modal")?.classList.add("hidden");
});

// 5. CHARGES & REGIONAL AREA SERVICE BINDINGS
function subscribeToFinanceArea() {
  // Charges config fetching
  get(ref(db, "charges")).then((snap) => {
    if (snap.exists()) {
      const c = snap.val();
      (document.getElementById("charge-delivery") as HTMLInputElement).value = c.deliveryCharge || 40;
      (document.getElementById("charge-platform") as HTMLInputElement).value = c.platformFee || 5;
      (document.getElementById("charge-gst") as HTMLInputElement).value = c.gst || 12;
      (document.getElementById("charge-commission") as HTMLInputElement).value = c.storeCommission || 10;
    }
  });

  // Services areas listening
  onValue(ref(db, "service_areas"), (snapshot) => {
    const listContainer = document.getElementById("service-areas-list")!;
    if (!snapshot.exists()) {
      listContainer.innerHTML = `<p class="text-[11px] text-slate-400 text-center font-semibold">No operational cities created yet.</p>`;
      return;
    }

    let html = "";
    snapshot.forEach((stateChild) => {
      const stateName = stateChild.key;
      html += `
        <div class="border-b border-slate-100 pb-2 mb-2 last:border-0 last:pb-0">
          <h4 class="text-xs font-black text-indigo-700 block mb-1 uppercase tracking-wider">${stateName}</h4>
          <div class="flex flex-wrap gap-1.5">
      `;

      stateChild.forEach((cityChild) => {
        const cityName = cityChild.key;
        const info = cityChild.val();
        
        html += `
          <div class="flex items-center gap-1.5 bg-white border border-slate-200 px-2 py-1 rounded-lg shadow-xs text-[10px] font-bold">
            <span class="text-slate-800">${cityName}</span>
            <button onclick="toggleServiceCity('${stateName}', '${cityName}', ${info.active})" class="cursor-pointer ${info.active ? "text-emerald-500" : "text-slate-400"}" title="Toggle Service">
              <i class="fa-solid fa-circle-check"></i>
            </button>
            <button onclick="deleteServiceCity('${stateName}', '${cityName}')" class="text-rose-400 hover:text-rose-600 cursor-pointer">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        `;
      });

      html += `</div></div>`;
    });

    listContainer.innerHTML = html;
  });
}

// Charges update submit
document.getElementById("form-charges")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const deliveryCharge = parseFloat((document.getElementById("charge-delivery") as HTMLInputElement).value);
  const platformFee = parseFloat((document.getElementById("charge-platform") as HTMLInputElement).value);
  const gst = parseFloat((document.getElementById("charge-gst") as HTMLInputElement).value);
  const storeCommission = parseFloat((document.getElementById("charge-commission") as HTMLInputElement).value);

  set(ref(db, "charges"), { deliveryCharge, platformFee, gst, storeCommission })
    .then(() => showToast("Finance charges updated!", "success"))
    .catch(() => showToast("Fail saving parameters", "error"));
});

// Manual City Addition
document.getElementById("form-add-area")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const state = (document.getElementById("area-state") as HTMLInputElement).value.trim();
  const city = (document.getElementById("area-city") as HTMLInputElement).value.trim();

  // Create state nodes
  set(ref(db, `service_areas/${state}/${city}`), { active: true })
    .then(() => {
      showToast("Service expansion hub added!", "success");
      (document.getElementById("area-state") as HTMLInputElement).value = "";
      (document.getElementById("area-city") as HTMLInputElement).value = "";
    });
});

Object.assign(window, {
  toggleServiceCity(state: string, city: string, current: boolean) {
    update(ref(db, `service_areas/${state}/${city}`), { active: !current });
    showToast(`${city} status toggled!`, "success");
  },
  deleteServiceCity(state: string, city: string) {
    if (confirm(`Remove city ${city} from operational service areas?`)) {
      remove(ref(db, `service_areas/${state}/${city}`));
      showToast(`${city} removed.`, "info");
    }
  }
});

// 6. COD FINANCE SETTLEMENT MANAGER
function renderSettlementFinance() {
  const tbody = document.getElementById("tbody-settlement-cod");
  if (!tbody) return;

  const delivered = ordersCache.filter((o) => o.status === "delivered");

  if (delivered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400 font-semibold selection:bg-slate-200">No settled COD handovers.</td></tr>`;
    return;
  }

  tbody.innerHTML = delivered.map((o) => {
    // Settle Store payout (90% of subtotal + gst)
    const storeComms = o.subtotal * 0.10;
    const storePayout = Math.round(o.subtotal + o.gst - storeComms);
    // Settle Rider payout (delivery charge)
    const riderPayout = o.deliveryCharge || 40;

    const isPaid = o.settlementPaid || false;

    return `
      <tr class="border-b border-slate-100 text-xs font-semibold hover:bg-slate-50/50">
        <td class="p-3">
          <div class="font-bold text-slate-900">${o.storeName || "Store"}</div>
          <p class="text-[10px] text-slate-400">Rider: ${o.deliveryName || "Agent"}</p>
        </td>
        <td class="p-3 font-mono">
          <div class="text-teal-700">Store Payout: ₹${storePayout}</div>
          <div class="text-slate-500">Rider Quota: ₹${riderPayout}</div>
        </td>
        <td class="p-3 font-bold text-[10px] text-slate-400 uppercase">C.O.D Cash</td>
        <td class="p-3">
          <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${isPaid ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}">
            ${isPaid ? "Setted Paid" : "Awaiting settlement"}
          </span>
        </td>
        <td class="p-3 text-right">
          ${!isPaid ? `
            <button onclick="settlePayoutNode('${o.orderId}')" class="bg-teal-500 hover:bg-teal-600 text-white font-bold text-[9px] px-2 py-1 rounded shadow-xs cursor-pointer">Mark Paid</button>
          ` : `
            <i class="fa-solid fa-circle-check text-emerald-500"></i>
          `}
        </td>
      </tr>
    `;
  }).join("");
}

Object.assign(window, {
  settlePayoutNode(orderId: string) {
    update(ref(db, `orders/${orderId}`), { settlementPaid: true })
      .then(() => showToast("Financial payouts settled completely!", "success"));
  }
});

// 7. BANNER ADS & PROMOS MANAGER
let currentAdFile: File | null = null;
let adminBannersCache: any[] = [];

// Local Date/Time formatter helpers
function formatLocalDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatLocalTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function parseLocalToEpoch(dateStr: string, timeStr: string): number {
  if (!dateStr || !timeStr) return Date.now();
  const parts = dateStr.split("-");
  const timeParts = timeStr.split(":");
  const d = new Date(
    parseInt(parts[0]),
    parseInt(parts[1]) - 1,
    parseInt(parts[2]),
    parseInt(timeParts[0]),
    parseInt(timeParts[1] || "0"),
    0,
    0
  );
  return d.getTime();
}

function formatEpochToDateTime(epoch: number): string {
  if (!epoch) return "Immediate";
  const d = new Date(epoch);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear().toString().slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date} ${month} '${year} at ${hh}:${mm}`;
}

function getBannerCampaignStatus(b: any) {
  const now = Date.now();
  if (b.active === false) {
    return {
      text: "Deactivated",
      colorClass: "bg-slate-100 text-slate-700 border border-slate-200",
      remainingText: "Active State Suspended"
    };
  }

  const start = b.startEpoch;
  const end = b.endEpoch;

  if (start && now < start) {
    const diff = start - now;
    return {
      text: "Scheduled",
      colorClass: "bg-amber-100 text-amber-800 border border-amber-200",
      remainingText: `Starts in ${formatAdminDuration(diff)}`
    };
  }

  if (end && now > end) {
    return {
      text: "Expired",
      colorClass: "bg-rose-100 text-rose-800 border border-rose-200",
      remainingText: "Ended Automatically (Expired)"
    };
  }

  // Active
  const diff = end ? (end - now) : null;
  return {
    text: "Active",
    colorClass: "bg-emerald-100 text-emerald-850 border border-emerald-200",
    remainingText: diff ? `Expires in ${formatAdminDuration(diff)}` : "Always Active"
  };
}

function formatAdminDuration(ms: number): string {
  const totSec = Math.floor(ms / 1000);
  if (totSec < 60) return `${totSec}s`;
  const totMin = Math.floor(totSec / 60);
  if (totMin < 60) return `${totMin}m`;
  const totHr = Math.floor(totMin / 60);
  const remMin = totMin % 60;
  if (totHr < 24) return `${totHr}h ${remMin}m`;
  const totDay = Math.floor(totHr / 24);
  const remHr = totHr % 24;
  return `${totDay}d ${remHr}h`;
}

function initBannerDateTimeDefaults() {
  const startDateInp = document.getElementById("banner-start-date") as HTMLInputElement;
  const startTimeInp = document.getElementById("banner-start-time") as HTMLInputElement;
  const endDateInp = document.getElementById("banner-end-date") as HTMLInputElement;
  const endTimeInp = document.getElementById("banner-end-time") as HTMLInputElement;
  const presetSelect = document.getElementById("banner-duration-preset") as HTMLSelectElement;

  if (!startDateInp) return;

  const now = new Date();
  startDateInp.value = formatLocalDate(now);
  startTimeInp.value = formatLocalTime(now);

  // Default is 24 Hours preset
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  endDateInp.value = formatLocalDate(tomorrow);
  endTimeInp.value = formatLocalTime(tomorrow);

  presetSelect?.addEventListener("change", () => {
    const val = presetSelect.value;
    if (val === "custom") return;

    const hours = parseInt(val);
    if (!isNaN(hours)) {
      const activeStart = new Date();
      startDateInp.value = formatLocalDate(activeStart);
      startTimeInp.value = formatLocalTime(activeStart);

      const activeEnd = new Date(activeStart.getTime() + hours * 60 * 60 * 1000);
      endDateInp.value = formatLocalDate(activeEnd);
      endTimeInp.value = formatLocalTime(activeEnd);
    }
  });

  [startDateInp, startTimeInp, endDateInp, endTimeInp].forEach(inp => {
    inp?.addEventListener("change", () => {
      if (presetSelect) presetSelect.value = "custom";
    });
  });
}

function renderAdminBannersList() {
  const container = document.getElementById("banner-list-container");
  if (!container) return;

  if (adminBannersCache.length === 0) {
    container.innerHTML = `<p class="text-[11px] text-slate-400 py-3 text-center">No slider banners. Default banners will render.</p>`;
    return;
  }

  let html = "";
  adminBannersCache.forEach((b) => {
    const stat = getBannerCampaignStatus(b);
    const views = b.views || 0;
    const clicks = b.clicks || 0;
    const ctr = views > 0 ? ((clicks / views) * 100).toFixed(1) : "0.0";

    const formattedStart = b.startEpoch ? formatEpochToDateTime(b.startEpoch) : "Immediate";
    const formattedEnd = b.endEpoch ? formatEpochToDateTime(b.endEpoch) : "Never Expires";

    const isCampaignOverlays = b.title || b.badge || b.description || b.cta;
    const isActiveToggle = b.active !== false;

    html += `
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex flex-col gap-2.5 transition-all">
        <div class="flex items-start gap-3">
          <div class="relative shrink-0 select-none">
            <img src="${b.imageUrl}" class="w-20 h-11 object-cover rounded shadow-xs border border-slate-200">
            <span class="absolute top-1 left-1.5 z-10 text-[7px] font-black ${stat.colorClass} px-1.5 py-0.5 rounded shadow-xs uppercase tracking-wider">
              ${stat.text}
            </span>
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-1">
              <span class="text-[8.5px] text-indigo-600 font-extrabold truncate max-w-[65%] font-mono uppercase tracking-wider">
                Ref: ${b.bannerId}
              </span>
              <div class="flex items-center gap-1.5 shrink-0">
                <button onclick="toggleBannerCampaignActive('${b.bannerId}', ${isActiveToggle})" class="text-[10px] select-none text-slate-400 hover:text-slate-600 outline-none p-0.5 cursor-pointer transition-all" title="Toggle Campaign Lock">
                  <i class="fa-solid ${isActiveToggle ? 'fa-toggle-on text-emerald-500 text-lg' : 'fa-toggle-off text-slate-300 text-lg'}"></i>
                </button>
                <button onclick="removeBanner('${b.bannerId}')" class="text-rose-500 hover:text-rose-700 cursor-pointer p-0.5" title="Scrub Campaign Permanently"><i class="fa-regular fa-trash-can"></i></button>
              </div>
            </div>

            <p class="text-[10px] text-slate-700 font-bold mt-1 truncate">
              Redirect: <span class="text-indigo-600 font-mono select-all">${b.redirectUrl || "None"}</span>
            </p>
          </div>
        </div>

        ${isCampaignOverlays ? `
          <div class="px-2.5 py-1.5 bg-indigo-50/30 rounded-lg text-[9px] border border-indigo-100/30 space-y-0.5">
            <span class="text-[7.5px] font-black uppercase text-indigo-500 tracking-wider block">Content Overlay details</span>
            ${b.title ? `<p class="font-extrabold text-slate-700 uppercase">Title: ${b.title}</p>` : ''}
            ${b.description ? `<p class="font-semibold text-slate-500 italic">Desc: "${b.description}"</p>` : ''}
            <div class="flex items-center gap-2 mt-1">
              ${b.badge ? `<span class="bg-indigo-600 text-white text-[7px] px-1.5 py-0.5 rounded font-black tracking-wider uppercase">${b.badge}</span>` : ''}
              ${b.cta ? `<span class="bg-white border border-indigo-150 text-slate-600 text-[7px] px-1.5 py-0.5 rounded font-bold uppercase">CTA: ${b.cta}</span>` : ''}
            </div>
          </div>
        ` : ''}

        <div class="bg-white p-2 rounded-lg border border-slate-150/40 grid grid-cols-2 gap-2 text-[9px] font-bold text-slate-500">
          <div>
            <span class="text-[7.5px] font-black uppercase text-slate-400 tracking-wider block">Campaign Starts</span>
            <span class="text-slate-700">${formattedStart}</span>
          </div>
          <div>
            <span class="text-[7.5px] font-black uppercase text-slate-400 tracking-wider block">Campaign Ends</span>
            <span class="text-slate-700">${formattedEnd}</span>
          </div>
          <div class="col-span-2 border-t border-slate-50 pt-1.5 flex items-center justify-between">
            <span class="text-[8px] font-black text-amber-600 uppercase tracking-wider flex items-center gap-1.5">
              <i class="fa-solid fa-hourglass-half"></i> ${stat.remainingText}
            </span>
          </div>
        </div>

        <div class="bg-slate-100/40 p-2 rounded-lg grid grid-cols-3 text-center text-[10px] font-black text-slate-700">
          <div class="border-r border-slate-200/50">
            <span class="text-[7.5px] font-black uppercase text-slate-400 tracking-widest block">VIEWS</span>
            <span class="text-slate-800 text-xs">${views}</span>
          </div>
          <div class="border-r border-slate-200/50">
            <span class="text-[7.5px] font-black uppercase text-slate-400 tracking-widest block">CLICKS</span>
            <span class="text-slate-800 text-xs">${clicks}</span>
          </div>
          <div>
            <span class="text-[7.5px] font-black uppercase text-slate-400 tracking-widest block">CTR</span>
            <span class="text-cyan-600 text-xs">${ctr}%</span>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Reactively tick remaining time calculation live in the admin panel every 5s
setInterval(renderAdminBannersList, 5000);

const bannerFileInput = document.getElementById("banner-file") as HTMLInputElement;
bannerFileInput?.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    currentAdFile = target.files[0];
    document.getElementById("banner-upload-txt")!.innerText = `${currentAdFile.name} Selected`;
    document.getElementById("banner-upload-icon")!.className = "fa-solid fa-file-circle-check text-teal-400 text-2xl mb-2";
  }
});

document.getElementById("form-banners")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const redirectUrl = (document.getElementById("banner-redirect") as HTMLInputElement).value || "";
  const priority = parseInt((document.getElementById("banner-priority") as HTMLInputElement).value) || 1;

  // Custom Content Overlays
  const title = (document.getElementById("banner-title") as HTMLInputElement).value.trim() || "";
  const badge = (document.getElementById("banner-badge") as HTMLInputElement).value.trim() || "";
  const cta = (document.getElementById("banner-cta") as HTMLInputElement).value.trim() || "";
  const description = (document.getElementById("banner-description") as HTMLInputElement).value.trim() || "";

  // Scheduler Dates
  const startDateVal = (document.getElementById("banner-start-date") as HTMLInputElement).value;
  const startTimeVal = (document.getElementById("banner-start-time") as HTMLInputElement).value || "00:00";
  const endDateVal = (document.getElementById("banner-end-date") as HTMLInputElement).value;
  const endTimeVal = (document.getElementById("banner-end-time") as HTMLInputElement).value || "00:00";

  const startEpoch = parseLocalToEpoch(startDateVal, startTimeVal);
  const endEpoch = parseLocalToEpoch(endDateVal, endTimeVal);

  const autoActivate = (document.getElementById("banner-auto-activate") as HTMLInputElement).checked;
  const autoExpire = (document.getElementById("banner-auto-expire") as HTMLInputElement).checked;

  if (startEpoch >= endEpoch) {
    showToast("Invalid Schedule: Start timeline must be before End timeline!", "error");
    return;
  }

  if (!currentAdFile) {
    showToast("Please upload an image campaign banner", "error");
    return;
  }

  showToast("Uploading banner to Cloudinary...", "info");
  try {
    const imageUrl = await uploadToCloudinary(currentAdFile);
    const key = `b_${Date.now()}`;
    
    set(ref(db, `banners/${key}`), {
      bannerId: key,
      imageUrl,
      redirectUrl,
      priority,
      active: true,
      title,
      badge,
      cta,
      description,
      startEpoch,
      endEpoch,
      autoActivate,
      autoExpire,
      views: 0,
      clicks: 0
    }).then(() => {
      showToast("App promotional campaign banner scheduled successfully!", "success");
      // Reset
      currentAdFile = null;
      (document.getElementById("form-banners") as HTMLFormElement).reset();
      document.getElementById("banner-upload-txt")!.innerText = "Select Banner from Device";
      document.getElementById("banner-upload-icon")!.className = "fa-solid fa-cloud-arrow-up text-2xl text-slate-400 mb-2";
      initBannerDateTimeDefaults();
    });
  } catch (error) {
    showToast("Banner upload failed", "error");
  }
});

function subscribeToBannersCoupons() {
  // Banner ads list
  onValue(ref(db, "banners"), (snapshot) => {
    adminBannersCache = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        adminBannersCache.push(child.val());
      });
    }
    renderAdminBannersList();
  });

  // Initialize DateTime selectors for scheduled campaign admin options
  setTimeout(initBannerDateTimeDefaults, 400);

  // Coupons listing
  onValue(ref(db, "coupons"), (snapshot) => {
    const container = document.getElementById("coupon-list-container")!;
    if (!snapshot.exists()) {
      container.innerHTML = `<p class="text-[11px] text-slate-400 text-center py-6">No premium coupons created.</p>`;
      return;
    }

    let html = "";
    snapshot.forEach((child) => {
      const cp = child.val();
      html += `
        <div class="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl shadow-xs text-xs">
          <div>
            <div class="flex items-center gap-1.5 font-sans">
              <span class="bg-teal-50 text-teal-600 text-[10px] font-black tracking-wide px-2 py-0.5 rounded uppercase tracking-wider uppercase border border-teal-100">${cp.code}</span>
              <strong class="text-slate-800">${cp.discountPercent}% Off</strong>
            </div>
            <p class="text-[10px] text-slate-400 mt-1 font-semibold">Min Cart: ₹${cp.minOrder} | Cap: ₹${cp.maxDiscount}</p>
          </div>
          <button onclick="deleteCouponCode('${cp.code}')" class="text-rose-500 hover:text-rose-700 cursor-pointer p-1.5"><i class="fa-solid fa-rectangle-xmark text-lg"></i></button>
        </div>
      `;
    });

    container.innerHTML = html;
  });
}

// Add Promo Coupon
document.getElementById("form-coupon")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = (document.getElementById("coupon-code") as HTMLInputElement).value.trim().toUpperCase();
  const discountPercent = parseInt((document.getElementById("coupon-percent") as HTMLInputElement).value);
  const maxDiscount = parseFloat((document.getElementById("coupon-max-discount") as HTMLInputElement).value);
  const minOrder = parseFloat((document.getElementById("coupon-min-order") as HTMLInputElement).value);

  set(ref(db, `coupons/${code}`), { code, discountPercent, maxDiscount, minOrder, active: true })
    .then(() => {
      showToast("Premium promo coupon activated!", "success");
      (document.getElementById("form-coupon") as HTMLFormElement).reset();
    });
});

Object.assign(window, {
  toggleBannerCampaignActive(bannerId: string, currentVal: boolean) {
    update(ref(db, `banners/${bannerId}`), { active: !currentVal })
      .then(() => {
        showToast("Campaign activation changed successfully!", "success");
        renderAdminBannersList();
      });
  },
  removeBanner(key: string) {
    if (confirm("Delete this Cloudinary promo ad campaign?")) {
      remove(ref(db, `banners/${key}`))
        .then(() => {
          showToast("Banner deleted", "info");
        });
    }
  },
  deleteCouponCode(code: string) {
    if (confirm(`Deactivate and delete promo code ${code}?`)) {
      remove(ref(db, `coupons/${code}`))
        .then(() => showToast("Coupon scrubbed.", "info"));
    }
  }
});

// 8. BROADCAST NOTIFICATIONS & PUSH Broadcaster
document.getElementById("form-broadcast")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = (document.getElementById("broadcast-message") as HTMLInputElement).value.trim();

  // Push notifications live under `/notifications/global` or individual users
  const notifyKey = `sh_push_${Date.now()}`;
  set(ref(db, `notifications/global/${notifyKey}`), {
    id: notifyKey,
    title: "Global Broadcaster Message",
    body: message,
    timestamp: Date.now()
  }).then(() => {
    showToast("Global announcements broadcast successfully!", "success");
    (document.getElementById("broadcast-message") as HTMLInputElement).value = "";
  });
});

// 9. CHARGING DYNAMIC SVG ANALYTICS
function buildAnalyticsChart(orders: OrderDetails[], profit: number) {
  const container = document.getElementById("analytics-svg-wrapper")!;
  if (orders.length === 0) {
    container.innerHTML = `<div class="text-[10px] text-slate-400 py-6 text-center font-semibold">Await sales statistics.</div>`;
    return;
  }

  // Count medicines by category
  const categories: { [name: string]: number } = {};
  orders.forEach((o) => {
    o.items?.forEach((it) => {
      const cat = it.category || "General";
      categories[cat] = (categories[cat] || 0) + it.qty;
    });
  });

  const keys = Object.keys(categories);
  if (keys.length === 0) {
    keys.push("Wellness", "Fever & Cold");
    categories["Wellness"] = 3;
    categories["Fever & Cold"] = 5;
  }

  // Dynamic Horizontal Bars
  container.innerHTML = keys.map((key) => {
    const qty = categories[key];
    const maxQty = Math.max(...Object.values(categories));
    const widthPercentage = Math.ceil((qty / maxQty) * 100);

    return `
      <div>
        <div class="flex justify-between text-[11px] font-bold text-slate-700 mb-1">
          <span>${key} Demand Shift</span>
          <span>${qty} Sold</span>
        </div>
        <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
          <div class="bg-teal-500 h-full rounded-full transition-all" style="width: ${widthPercentage}%"></div>
        </div>
      </div>
    `;
  }).join("") + `
    <div class="mt-2 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-800">
      <span>Consolidated Sales Profits:</span>
      <span class="font-mono text-emerald-600">₹${Math.ceil(profit)}</span>
    </div>
  `;
}

// AI trigger campaign button
document.getElementById("btn-trigger-ai-promo")?.addEventListener("click", () => {
  const msgInput = document.getElementById("broadcast-message") as HTMLInputElement;
  msgInput.value = "AI Insight Offer: Use code MEDS20 to get instant 20% discount on search demands!";
  showToast("Retargeting recommendation copied to broadcast dispatcher. Press Send button to broadcast!", "success");
});

// 10. WAREHOUSE MANAGEMENT SYSTEM
function subscribeToWarehouses() {
  onValue(ref(db, "warehouses"), (snapshot) => {
    const listEl = document.getElementById("warehouse-list-container");
    if (!listEl) return;
    if (!snapshot.exists()) {
      listEl.innerHTML = `
        <div class="text-[11px] text-slate-400 text-center font-bold py-6">
          <i class="fa-solid fa-box-open text-lg block mb-1"></i>
          No Hub Warehouses. Configure first east base above.
        </div>
      `;
      return;
    }

    let html = "";
    snapshot.forEach((child) => {
      const wh = child.val();
      html += `
        <div class="p-3 bg-white rounded-xl border border-slate-150 shadow-xs flex items-center justify-between text-xs">
          <div>
            <h5 class="font-black text-slate-800 flex items-center gap-1">
              <i class="fa-solid fa-warehouse text-slate-400"></i> ${wh.name}
            </h5>
            <p class="text-[10px] text-slate-500 leading-relaxed font-semibold mt-1">
              Primary Items Transfer Ready | Status: Online
            </p>
          </div>
          <button onclick="removeWarehouseNode('${wh.warehouseId}')" class="text-rose-500 hover:text-rose-700 p-1 cursor-pointer">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      `;
    });

    listEl.innerHTML = html;
  });
}

document.getElementById("form-warehouse")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = (document.getElementById("warehouse-name") as HTMLInputElement).value.trim();
  const key = `wh_${Date.now()}`;

  set(ref(db, `warehouses/${key}`), {
    warehouseId: key,
    name,
    status: "active",
    inventory: {}
  }).then(() => {
    showToast("Operational Hub structured successfully!", "success");
    (document.getElementById("warehouse-name") as HTMLInputElement).value = "";
  });
});

let allCategoriesList: any[] = [];
let categorySearchQuery = "";
let categoryEditModeCode: string | null = null;

function getCategoryPlaceholderImage(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("fever") || n.includes("paracetamol")) return "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300";
  if (n.includes("diabetes") || n.includes("sugar")) return "https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=300";
  if (n.includes("heart") || n.includes("cardio")) return "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=300";
  if (n.includes("blood") || n.includes("bp") || n.includes("hypertension")) return "https://images.unsplash.com/photo-1603398938378-e54eab446dde?w=300";
  if (n.includes("vitamin") || n.includes("supplement") || n.includes("nutrition")) return "https://images.unsplash.com/photo-1616671285410-b98687720760?w=300";
  if (n.includes("skin") || n.includes("hair") || n.includes("beauty")) return "https://images.unsplash.com/photo-1556228515-3198555418b6?w=300";
  if (n.includes("baby") || n.includes("child")) return "https://images.unsplash.com/photo-1515488042361-404e9250afef?w=300";
  if (n.includes("ayurveda") || n.includes("herbal")) return "https://images.unsplash.com/photo-1611082231993-f3741d740c0b?w=300";
  if (n.includes("device") || n.includes("oximeter") || n.includes("thermometer")) return "https://images.unsplash.com/photo-1542736667-069246bdbc6d?w=300";
  return "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=300";
}

function getCategoryPlaceholderBanner(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("fever")) return "https://images.unsplash.com/photo-1628771065518-0d82f111818d?w=800";
  if (n.includes("diabetes")) return "https://images.unsplash.com/photo-1530026405186-ed1ea0ac7a63?w=800";
  if (n.includes("heart") || n.includes("blood") || n.includes("bp")) return "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800";
  if (n.includes("vitamin") || n.includes("supplement") || n.includes("nutrition") || n.includes("immunity")) return "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=800";
  if (n.includes("baby") || n.includes("child")) return "https://images.unsplash.com/photo-1515488042361-404e9250afef?w=800";
  if (n.includes("ayurveda") || n.includes("herbal")) return "https://images.unsplash.com/photo-1611082231993-f3741d740c0b?w=800";
  if (n.includes("device") || n.includes("oximeter")) return "https://images.unsplash.com/photo-1542736667-069246bdbc6d?w=800";
  return "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800";
}

function autoProvisionCategoryIfNeeded(categoryName: string) {
  if (!categoryName) return;
  const name = categoryName.trim();
  if (name === "" || name.toUpperCase() === "ALL") return;
  
  const code = name.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  
  const exists = allCategoriesList.some(c => c.code === code);
  if (!exists) {
    get(ref(db, `categories/${code}`)).then((snap) => {
      if (!snap.exists()) {
        const payload = {
          code,
          name,
          active: true,
          imageUrl: getCategoryPlaceholderImage(name),
          bannerUrl: getCategoryPlaceholderBanner(name),
          featured: true,
          trending: false
        };
        set(ref(db, `categories/${code}`), payload).then(() => {
          console.log(`Auto created category ${name} (code: ${code})`);
        });
      }
    });
  }
}

function checkAndPreloadCategories() {
  get(ref(db, "categories")).then((snapshot) => {
    if (!snapshot.exists()) {
      const defaultCategories = {
        "ALL": { code: "ALL", name: "All Medicines", active: true, imageUrl: "https://images.unsplash.com/photo-1584017911756-d451b3d0e843?w=300", bannerUrl: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800", featured: true, trending: false },
        "DIABETES": { code: "DIABETES", name: "Diabetes Care", active: true, imageUrl: "https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=300", bannerUrl: "https://images.unsplash.com/photo-1530026405186-ed1ea0ac7a63?w=800", featured: true, trending: true },
        "HEART": { code: "HEART", name: "Heart Care", active: true, imageUrl: "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=300", bannerUrl: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800", featured: true, trending: false },
        "BP": { code: "BP", name: "Blood Pressure", active: true, imageUrl: "https://images.unsplash.com/photo-1603398938378-e54eab446dde?w=300", bannerUrl: "https://images.unsplash.com/photo-1530026405186-ed1ea0ac7a63?w=800", featured: false, trending: true },
        "ALLERGY": { code: "ALLERGY", name: "Allergy Relief", active: true, imageUrl: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300", bannerUrl: "https://images.unsplash.com/photo-1628771065518-0d82f111818d?w=800", featured: false, trending: false },
        "COLD_FLU": { code: "COLD_FLU", name: "Cold & Flu", active: true, imageUrl: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=300", bannerUrl: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=800", featured: true, trending: true },
        "FEVER": { code: "FEVER", name: "Fever Medicines", active: true, imageUrl: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300", bannerUrl: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800", featured: true, trending: true },
        "PAIN": { code: "PAIN", name: "Pain Relief", active: true, imageUrl: "https://images.unsplash.com/photo-1603398938378-e54eab446dde?w=300", bannerUrl: "https://images.unsplash.com/photo-1628771065518-0d82f111818d?w=800", featured: true, trending: false },
        "STOMACH": { code: "STOMACH", name: "Stomach Care", active: true, imageUrl: "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=300", bannerUrl: "https://images.unsplash.com/photo-1530026405186-ed1ea0ac7a63?w=800", featured: false, trending: false },
        "DIGESTION": { code: "DIGESTION", name: "Digestion", active: true, imageUrl: "https://images.unsplash.com/photo-1616671285410-b98687720760?w=300", bannerUrl: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=800", featured: false, trending: false },
        "VITAMINS": { code: "VITAMINS", name: "Vitamins & Supplements", active: true, imageUrl: "https://images.unsplash.com/photo-1616671285410-b98687720760?w=300", bannerUrl: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=800", featured: true, trending: true },
        "IMMUNITY": { code: "IMMUNITY", name: "Immunity Boosters", active: true, imageUrl: "https://images.unsplash.com/photo-1616671285410-b98687720760?w=300", bannerUrl: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800", featured: false, trending: true },
        "BABY_CARE": { code: "BABY_CARE", name: "Baby Care", active: true, imageUrl: "https://images.unsplash.com/photo-1515488042361-404e9250afef?w=300", bannerUrl: "https://images.unsplash.com/photo-1515488042361-404e9250afef?w=800", featured: true, trending: false },
        "MEDICAL_DEVICES": { code: "MEDICAL_DEVICES", name: "Medical Devices", active: true, imageUrl: "https://images.unsplash.com/photo-1542736667-069246bdbc6d?w=300", bannerUrl: "https://images.unsplash.com/photo-1542736667-069246bdbc6d?w=800", featured: true, trending: false },
        "AYURVEDA": { code: "AYURVEDA", name: "Ayurveda", active: true, imageUrl: "https://images.unsplash.com/photo-1611082231993-f3741d740c0b?w=300", bannerUrl: "https://images.unsplash.com/photo-1611082231993-f3741d740c0b?w=800", featured: true, trending: true }
      };
      set(ref(db, "categories"), defaultCategories).then(() => {
        showToast("Premium visual category catalogue seeded!", "success");
      });
    }
  });
}

function subscribeToCategories() {
  onValue(ref(db, "categories"), (snapshot) => {
    allCategoriesList = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        allCategoriesList.push(child.val());
      });
    }
    renderCategoriesTable();
  });
}

function renderCategoriesTable() {
  const tableBody = document.getElementById("category-table-body");
  if (!tableBody) return;

  const query = categorySearchQuery.toLowerCase().trim();
  const filtered = allCategoriesList.filter(it => 
    (it.code && it.code.toLowerCase().includes(query)) || 
    (it.name && it.name.toLowerCase().includes(query))
  );

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" class="p-4 text-center text-slate-400 font-medium">No operational segments found.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = filtered.map(it => {
    const statusColor = it.active 
      ? "bg-emerald-55 bg-emerald-50 text-emerald-600 border border-emerald-100" 
      : "bg-rose-50 text-rose-600 border border-rose-100";
    const statusText = it.active ? "Active" : "Inactive";
    const toggleIcon = it.active ? "fa-toggle-on text-emerald-500" : "fa-toggle-off text-slate-400";
    const toggleTitle = it.active ? "Deactivate Category" : "Activate Category";

    // Build highlights string
    let highlightsHtml = "";
    if (it.featured === true || it.featured === "yes") {
      highlightsHtml += `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase text-amber-700 bg-amber-100 border border-amber-200 mr-1">FEATURED</span>`;
    }
    if (it.trending === true || it.trending === "yes") {
      highlightsHtml += `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase text-rose-700 bg-rose-100 border border-rose-200 mr-1">TRENDING</span>`;
    }
    if (!highlightsHtml) {
      highlightsHtml = `<span class="text-slate-400 text-xs">-</span>`;
    }

    const itemImg = it.imageUrl || getCategoryPlaceholderImage(it.name);

    return `
      <tr class="hover:bg-slate-50/40 transition-colors border-b border-slate-100 font-sans">
        <td class="p-3">
          <img src="${itemImg}" class="w-8 h-8 rounded-lg object-contain bg-slate-50 border border-slate-100 placeholder-no-referrer shrink-0" referrerpolicy="no-referrer">
        </td>
        <td class="p-3 font-mono font-black text-slate-700 text-xs">${it.code}</td>
        <td class="p-3 font-bold text-slate-800 text-xs">${it.name}</td>
        <td class="p-3 whitespace-nowrap">${highlightsHtml}</td>
        <td class="p-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ${statusColor}">
            ${statusText}
          </span>
        </td>
        <td class="p-3 text-right space-x-1 whitespace-nowrap">
          <button onclick="toggleCategoryStatus('${it.code}', ${it.active})" class="p-1 px-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-650 transition-all cursor-pointer" title="${toggleTitle}">
            <i class="fa-solid ${toggleIcon} text-sm"></i>
          </button>
          <button onclick="startEditCategory('${it.code}', '${it.name.replace(/'/g, "\\'")}', ${it.active})" class="p-1 px-1.5 hover:bg-teal-50 hover:text-teal-600 text-slate-400 rounded transition-all cursor-pointer" title="Edit Segment">
            <i class="fa-solid fa-pencil text-xs"></i>
          </button>
          <button onclick="deleteCategoryNode('${it.code}')" class="p-1 px-1.5 hover:bg-rose-50 hover:text-rose-600 text-slate-400 rounded transition-all cursor-pointer" title="Delete Segment">
            <i class="fa-solid fa-trash-can text-xs"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function setupCategoryFormListeners() {
  const searchInput = document.getElementById("category-search") as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      categorySearchQuery = (e.target as HTMLInputElement).value;
      renderCategoriesTable();
    });
  }

  // Choose file upload handlers
  const imgFile = document.getElementById("category-image-file") as HTMLInputElement;
  const imgUrl = document.getElementById("category-image-url") as HTMLInputElement;
  const imgPreview = document.getElementById("category-image-preview");

  imgFile?.addEventListener("change", async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;
    if (imgPreview) imgPreview.innerHTML = `<i class="fa-solid fa-spinner animate-spin text-teal-500"></i>`;
    try {
      const url = await uploadToCloudinary(file);
      if (imgUrl) imgUrl.value = url;
      if (imgPreview) imgPreview.innerHTML = `<img src="${url}" class="w-full h-full object-contain">`;
      showToast("Category image icon uploaded successfully!", "success");
    } catch (err) {
      if (imgPreview) imgPreview.innerHTML = `<i class="fa-solid fa-circle-exclamation text-rose-500"></i>`;
      showToast("Failed to upload category image", "error");
    }
  });

  const bannerFile = document.getElementById("category-banner-file") as HTMLInputElement;
  const bannerUrl = document.getElementById("category-banner-url") as HTMLInputElement;
  const bannerPreview = document.getElementById("category-banner-preview");

  bannerFile?.addEventListener("change", async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;
    if (bannerPreview) bannerPreview.innerHTML = `<i class="fa-solid fa-spinner animate-spin text-teal-500 text-xs"></i>`;
    try {
      const url = await uploadToCloudinary(file);
      if (bannerUrl) bannerUrl.value = url;
      if (bannerPreview) bannerPreview.innerHTML = `<img src="${url}" class="w-full h-full object-cover">`;
      showToast("Category banner uploaded successfully!", "success");
    } catch (err) {
      if (bannerPreview) bannerPreview.innerHTML = `<i class="fa-solid fa-circle-exclamation text-rose-500"></i>`;
      showToast("Failed to upload category banner", "error");
    }
  });

  imgUrl?.addEventListener("input", (e: any) => {
    const url = e.target.value.trim();
    if (url && imgPreview) {
      imgPreview.innerHTML = `<img src="${url}" class="w-full h-full object-contain">`;
    } else if (imgPreview) {
      imgPreview.innerHTML = `<i class="fa-solid fa-image text-slate-350"></i>`;
    }
  });

  bannerUrl?.addEventListener("input", (e: any) => {
    const url = e.target.value.trim();
    if (url && bannerPreview) {
      bannerPreview.innerHTML = `<img src="${url}" class="w-full h-full object-cover">`;
    } else if (bannerPreview) {
      bannerPreview.innerHTML = `<i class="fa-solid fa-rectangle-ad text-slate-350"></i>`;
    }
  });

  const formCategory = document.getElementById("form-category") as HTMLFormElement;
  if (formCategory) {
    formCategory.addEventListener("submit", (e) => {
      e.preventDefault();
      
      const codeInput = document.getElementById("category-code") as HTMLInputElement;
      const nameInput = document.getElementById("category-name") as HTMLInputElement;
      const statusSelect = document.getElementById("category-status") as HTMLSelectElement;
      const featuredSelect = document.getElementById("category-featured") as HTMLSelectElement;
      const trendingSelect = document.getElementById("category-trending") as HTMLSelectElement;
      const imageUrlInput = document.getElementById("category-image-url") as HTMLInputElement;
      const bannerUrlInput = document.getElementById("category-banner-url") as HTMLInputElement;

      const codeRaw = codeInput.value.trim().toUpperCase();
      const code = codeRaw.replace(/[^A-Z0-9_]/g, "_");
      const name = nameInput.value.trim();
      const active = statusSelect.value === "active";
      const featured = featuredSelect ? featuredSelect.value === "yes" : false;
      const trending = trendingSelect ? trendingSelect.value === "yes" : false;
      const imageUrl = imageUrlInput ? imageUrlInput.value.trim() : "";
      const bannerUrl = bannerUrlInput ? bannerUrlInput.value.trim() : "";

      if (!code || !name) {
        showToast("Operational segment Code and Name are both mandatory.", "error");
        return;
      }

      set(ref(db, `categories/${code}`), { 
        code, 
        name, 
        active, 
        featured, 
        trending, 
        imageUrl: imageUrl || getCategoryPlaceholderImage(name), 
        bannerUrl: bannerUrl || getCategoryPlaceholderBanner(name) 
      })
        .then(() => {
          showToast(categoryEditModeCode ? "Category configuration saved!" : "Category established successfully!", "success");
          resetCategoryForm();
        })
        .catch((err) => {
          showToast(`Save failure: ${err.message}`, "error");
        });
    });
  }

  const btnCancel = document.getElementById("btn-cancel-category-edit") as HTMLButtonElement;
  if (btnCancel) {
    btnCancel.addEventListener("click", () => {
      resetCategoryForm();
    });
  }
}

function resetCategoryForm() {
  const codeInput = document.getElementById("category-code") as HTMLInputElement;
  const nameInput = document.getElementById("category-name") as HTMLInputElement;
  const statusSelect = document.getElementById("category-status") as HTMLSelectElement;
  const featuredSelect = document.getElementById("category-featured") as HTMLSelectElement;
  const trendingSelect = document.getElementById("category-trending") as HTMLSelectElement;
  const imageUrlInput = document.getElementById("category-image-url") as HTMLInputElement;
  const bannerUrlInput = document.getElementById("category-banner-url") as HTMLInputElement;
  const imgPreview = document.getElementById("category-image-preview");
  const bannerPreview = document.getElementById("category-banner-preview");

  const formTitle = document.getElementById("category-form-title")!;
  const btnCancel = document.getElementById("btn-cancel-category-edit")!;
  const codeLabel = codeInput?.parentElement?.querySelector("p")!;

  categoryEditModeCode = null;
  if (codeInput) {
    codeInput.value = "";
    codeInput.disabled = false;
  }
  if (nameInput) nameInput.value = "";
  if (statusSelect) statusSelect.value = "active";
  if (featuredSelect) featuredSelect.value = "no";
  if (trendingSelect) trendingSelect.value = "no";
  if (imageUrlInput) imageUrlInput.value = "";
  if (bannerUrlInput) bannerUrlInput.value = "";
  
  if (imgPreview) imgPreview.innerHTML = `<i class="fa-solid fa-image text-slate-350"></i>`;
  if (bannerPreview) bannerPreview.innerHTML = `<i class="fa-solid fa-rectangle-ad text-slate-350"></i>`;

  if (formTitle) formTitle.innerHTML = `<i class="fa-solid fa-plus text-teal-500"></i> Add New Category`;
  if (btnCancel) btnCancel.classList.add("hidden");
  if (codeLabel) codeLabel.innerText = "Unique identifier (letters/underscores only).";
}

Object.assign(window, {
  removeWarehouseNode(id: string) {
    if (confirm("Remove this warehouse profile?")) {
      remove(ref(db, `warehouses/${id}`))
        .then(() => showToast("Warehouse hub scrubbed.", "info"));
    }
  },
  toggleCategoryStatus(code: string, currentStatus: boolean) {
    update(ref(db, `categories/${code}`), { active: !currentStatus })
      .then(() => {
        showToast(`Category status modified successfully.`, "success");
      });
  },
  startEditCategory(code: string, name: string, active: boolean) {
    categoryEditModeCode = code;
    
    const codeInput = document.getElementById("category-code") as HTMLInputElement;
    const nameInput = document.getElementById("category-name") as HTMLInputElement;
    const statusSelect = document.getElementById("category-status") as HTMLSelectElement;
    const featuredSelect = document.getElementById("category-featured") as HTMLSelectElement;
    const trendingSelect = document.getElementById("category-trending") as HTMLSelectElement;
    const imageUrlInput = document.getElementById("category-image-url") as HTMLInputElement;
    const bannerUrlInput = document.getElementById("category-banner-url") as HTMLInputElement;
    const imgPreview = document.getElementById("category-image-preview");
    const bannerPreview = document.getElementById("category-banner-preview");

    const formTitle = document.getElementById("category-form-title")!;
    const btnCancel = document.getElementById("btn-cancel-category-edit")!;
    const codeLabel = codeInput?.parentElement?.querySelector("p")!;

    if (codeInput) {
      codeInput.value = code;
      codeInput.disabled = true; 
    }
    
    // Look up category in cache
    const cat = allCategoriesList.find(c => c.code === code);
    if (cat) {
      if (nameInput) nameInput.value = cat.name || name;
      if (statusSelect) statusSelect.value = cat.active ? "active" : "inactive";
      if (featuredSelect) featuredSelect.value = (cat.featured === true || cat.featured === "yes") ? "yes" : "no";
      if (trendingSelect) trendingSelect.value = (cat.trending === true || cat.trending === "yes") ? "yes" : "no";
      if (imageUrlInput) imageUrlInput.value = cat.imageUrl || "";
      if (bannerUrlInput) bannerUrlInput.value = cat.bannerUrl || "";
      
      if (imgPreview) {
        if (cat.imageUrl) {
          imgPreview.innerHTML = `<img src="${cat.imageUrl}" class="w-full h-full object-contain">`;
        } else {
          imgPreview.innerHTML = `<i class="fa-solid fa-image text-slate-350"></i>`;
        }
      }
      
      if (bannerPreview) {
        if (cat.bannerUrl) {
          bannerPreview.innerHTML = `<img src="${cat.bannerUrl}" class="w-full h-full object-cover">`;
        } else {
          bannerPreview.innerHTML = `<i class="fa-solid fa-rectangle-ad text-slate-350"></i>`;
        }
      }
    } else {
      if (nameInput) nameInput.value = name;
      if (statusSelect) statusSelect.value = active ? "active" : "inactive";
    }
    
    if (formTitle) formTitle.innerHTML = `<i class="fa-solid fa-pencil text-teal-500"></i> Edit Category: ${code}`;
    if (btnCancel) btnCancel.classList.remove("hidden");
    if (codeLabel) codeLabel.innerText = "Category code is locked during active edits.";
  },
  deleteCategoryNode(code: string) {
    if (confirm(`Are you sure you want to permanently delete category ${code}?`)) {
      remove(ref(db, `categories/${code}`))
        .then(() => {
          showToast(`Category scrubbed.`, "info");
          if (categoryEditModeCode === code) {
            resetCategoryForm();
          }
        });
    }
  }
});

// 11. MAPS SYSTEM (Mappls dynamic tracker representation)
function updateGeoapifyAdminMap(stores: any[]) {
  const mappls = (window as any).mappls;
  if (!mappls) {
    loadMapplsScript(() => {
      updateGeoapifyAdminMap(stores);
    });
    return;
  }

  const mapDiv = document.getElementById("mappls-admin-map");
  if (!mapDiv) return;

  if (stores.length === 0) {
    return;
  }

  const centerStore = stores[0];
  const cLat = centerStore.location?.lat || 12.9716;
  const cLng = centerStore.location?.lng || 77.5946;

  const mapCoords = document.getElementById("map-coordinates");
  if (mapCoords) {
    mapCoords.innerText = `${centerStore.name || "Main Hub Area"} Center (${cLat.toFixed(4)}, ${cLng.toFixed(4)})`;
  }

  let mapInstance = (window as any)["map_mappls_admin_map"];
  if (!mapInstance) {
    mapDiv.innerHTML = "";
    try {
      mapInstance = new mappls.Map("mappls-admin-map", {
        center: { lat: cLat, lng: cLng },
        zoom: 11,
        zoomControl: true,
        attributionControl: false
      });
      (window as any)["map_mappls_admin_map"] = mapInstance;
    } catch (e) {
      console.error("Failed to init Mappls Map in Admin Portal:", e);
      return;
    }
  }

  // Clear existing overlays
  let activeOverlays = (window as any)["overlays_mappls_admin_map"] || [];
  activeOverlays.forEach((ol: any) => {
    try {
      if (ol && typeof ol.remove === "function") {
        ol.remove();
      }
    } catch (e) {}
  });
  activeOverlays = [];

  // Add a marker for each store
  stores.forEach((s, idx) => {
    const lat = s.location?.lat || 12.9716;
    const lng = s.location?.lng || 77.5946;
    try {
      const marker = new mappls.Marker({
        map: mapInstance,
        position: { lat, lng },
        html: `<div class="w-7 h-7 rounded-full shadow border-2 border-white flex items-center justify-center bg-teal-500 text-white font-bold text-[10px]">${idx + 1}</div>`
      });
      activeOverlays.push(marker);
    } catch (e) {
      console.error("Error drawing admin map marker:", e);
    }
  });

  // Center on the first active store
  try {
    mapInstance.setCenter({ lat: cLat, lng: cLng });
  } catch(e) {}

  (window as any)["overlays_mappls_admin_map"] = activeOverlays;
}

// =================================== 12. DELIVERY BOY VERIFICATION CENTER ===================================
let verificationFilter = "All";
let verificationSearch = "";

let zoomFactor = 1;
let rotateAngle = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOffset = { x: 0, y: 0 };

function getRiderVerificationStatus(r: any): "Pending" | "Under Review" | "Approved" | "Rejected" | "Suspended" {
  if (r.verificationStatus) {
    return r.verificationStatus;
  }
  if (r.active === false || r.suspended === true) {
    return "Suspended";
  }
  if (r.approved === true) {
    return "Approved";
  }
  if (r.rejectionReason || r.status === "rejected") {
    return "Rejected";
  }
  if (r.onboardSubmitted === true) {
    return "Pending";
  }
  return "Pending";
}

function renderVerificationCenter(riders: any[]) {
  const tbody = document.getElementById("tbody-verification-center");
  if (!tbody) return;

  // Compute counters
  let totalCount = riders.length;
  let pendingCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let suspendedCount = 0;

  riders.forEach((r) => {
    const status = getRiderVerificationStatus(r);
    if (status === "Pending" || status === "Under Review") pendingCount++;
    else if (status === "Approved") approvedCount++;
    else if (status === "Rejected") rejectedCount++;
    else if (status === "Suspended") suspendedCount++;
  });

  // Update counter UI
  const elTotal = document.getElementById("stat-verify-total");
  const elPending = document.getElementById("stat-verify-pending");
  const elApproved = document.getElementById("stat-verify-approved");
  const elRejected = document.getElementById("stat-verify-rejected");
  const elSuspended = document.getElementById("stat-verify-suspended");

  if (elTotal) elTotal.innerText = totalCount.toString();
  if (elPending) elPending.innerText = pendingCount.toString();
  if (elApproved) elApproved.innerText = approvedCount.toString();
  if (elRejected) elRejected.innerText = rejectedCount.toString();
  if (elSuspended) elSuspended.innerText = suspendedCount.toString();

  // Filter riders list
  let filtered = riders.filter((r) => {
    const status = getRiderVerificationStatus(r);
    
    // Status Filter
    if (verificationFilter !== "All" && status !== verificationFilter) {
      if (!(verificationFilter === "Pending" && status === "Under Review")) {
        return false;
      }
    }

    // Search Query
    if (verificationSearch) {
      const q = verificationSearch.toLowerCase();
      const name = (r.name || "").toLowerCase();
      const email = (r.email || "").toLowerCase();
      const mobile = (r.mobile || "").toLowerCase();
      const district = (r.district || "").toLowerCase();
      const state = (r.state || "").toLowerCase();
      const dl = (r.licenseNumber || "").toLowerCase();
      const aadhaar = (r.aadhaarNumber || "").toLowerCase();

      return name.includes(q) || email.includes(q) || mobile.includes(q) || district.includes(q) || state.includes(q) || dl.includes(q) || aadhaar.includes(q);
    }

    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-16 text-center text-slate-400 font-semibold">
          No delivery partner profiles matched your search or status query.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((r) => {
    const rid = r.deliveryId || r.uid || "";
    const name = r.name || "Anonymous Rider";
    const status = getRiderVerificationStatus(r);

    let statusPillClass = "";
    if (status === "Pending") statusPillClass = "bg-yellow-50 text-yellow-700 border-yellow-200";
    else if (status === "Under Review") statusPillClass = "bg-indigo-50 text-indigo-700 border-indigo-200";
    else if (status === "Approved") statusPillClass = "bg-emerald-50 text-emerald-700 border-emerald-250";
    else if (status === "Rejected") statusPillClass = "bg-rose-50 text-rose-700 border-rose-250";
    else if (status === "Suspended") statusPillClass = "bg-slate-100 text-slate-700 border-slate-350";

    const hasAadhaar = r.aadhaarFrontUrl && r.aadhaarBackUrl;
    const hasDl = !!r.licenseImageUrl;

    const profilePic = r.profilePhotoUrl || r.photoUrl || "https://img.icons8.com/color/96/delivery-man.png";

    return `
    <tr class="hover:bg-slate-50/50 transition-all">
      <td class="px-5 py-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full border border-slate-200 overflow-hidden shrink-0 bg-slate-100 flex items-center justify-center">
            <img src="${profilePic}" class="w-full h-full object-cover" alt="Rider Profile" referrerPolicy="no-referrer" onerror="this.src='https://img.icons8.com/color/96/delivery-man.png'" />
          </div>
          <div>
            <h4 class="font-extrabold text-slate-900 leading-snug text-left">${name}</h4>
            <span class="text-[10px] text-slate-400 font-mono block text-left">ID: ${rid.substring(0, 8)}...</span>
          </div>
        </div>
      </td>
      <td class="px-5 py-4 text-left">
        <div class="text-xs font-bold text-slate-800">${r.mobile || "N/A"}</div>
        <div class="text-[10px] text-slate-400 font-medium font-mono">${r.email || "N/A"}</div>
        <div class="text-[10px] text-slate-500 font-semibold mt-1">
          <i class="fa-solid fa-location-dot text-slate-400 mr-1"></i>${r.district || "N/A"}, ${r.state || "N/A"}
        </div>
      </td>
      <td class="px-5 py-4 text-left">
        <div class="text-xs font-bold text-slate-700 capitalize flex items-center gap-1.5 leading-none">
          <i class="fa-solid ${r.vehicleType === "bicycle" ? "fa-bicycle text-teal-500" : "fa-motorcycle text-amber-500"} text-sm"></i>
          <span>${r.vehicleType || "Not filled"}</span>
        </div>
        <div class="text-[10px] font-mono text-slate-400 uppercase mt-1">Plate: ${r.vehicleNumber || "Not filled"}</div>
      </td>
      <td class="px-5 py-4 text-left whitespace-nowrap">
        <div class="flex flex-col gap-1 text-[10px]">
          <span class="flex items-center gap-1 font-bold ${r.aadhaarNumber ? "text-emerald-600" : "text-slate-400"}">
            <i class="fa-solid ${hasAadhaar ? "fa-square-check text-emerald-500" : "fa-square text-slate-300"}"></i> Aadhaar Card: ${r.aadhaarNumber ? r.aadhaarNumber.substring(0, 4) + "****" : "N/A"}
          </span>
          <span class="flex items-center gap-1 font-bold ${r.licenseNumber ? "text-emerald-600" : "text-slate-400"}">
            <i class="fa-solid ${hasDl ? "fa-square-check text-emerald-500" : "fa-square text-slate-300"}"></i> Driver License: ${r.licenseNumber || "N/A"}
          </span>
        </div>
      </td>
      <td class="px-5 py-4 text-left">
        <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${statusPillClass}">
          ${status}
        </span>
      </td>
      <td class="px-5 py-4 text-right">
        <button onclick="viewRiderDetailedInspection('${rid}')" class="bg-indigo-600 hover:bg-indigo-700 hover:shadow-md text-white text-[11px] font-extrabold px-3 py-1.5 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 ml-auto shadow-sm">
          <i class="fa-solid fa-file-shield"></i> View Full Profile
        </button>
      </td>
    </tr>
    `;
  }).join("");
}

function initRiderVerificationListeners() {
  // Search filter
  const searchInp = document.getElementById("verification-search-input");
  searchInp?.addEventListener("input", (e) => {
    verificationSearch = (e.target as HTMLInputElement).value;
    renderVerificationCenter(ridersCache);
  });

  // Filter buttons
  const filterBtns = document.querySelectorAll(".status-verify-filter-btn");
  filterBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      filterBtns.forEach((b) => b.classList.remove("active", "bg-slate-900", "text-white"));
      filterBtns.forEach((b) => b.classList.add("bg-white", "text-slate-600", "border", "border-slate-200"));
      
      const target = e.currentTarget as HTMLButtonElement;
      target.classList.add("active", "bg-slate-900", "text-white");
      target.classList.remove("bg-white", "text-slate-600", "border", "border-slate-200");
      
      verificationFilter = target.getAttribute("data-status") || "All";
      renderVerificationCenter(ridersCache);
    });
  });

  // Lightbox zoom constraints and event binds
  const lbImg = document.getElementById("lightbox-image-element") as HTMLImageElement;

  document.getElementById("lightbox-zoom-in")?.addEventListener("click", () => {
    zoomFactor += 0.2;
    updateLightboxImgTransform();
  });

  document.getElementById("lightbox-zoom-out")?.addEventListener("click", () => {
    if (zoomFactor > 0.4) {
      zoomFactor -= 0.2;
      updateLightboxImgTransform();
    }
  });

  document.getElementById("lightbox-zoom-reset")?.addEventListener("click", () => {
    zoomFactor = 1;
    rotateAngle = 0;
    panOffset = { x: 0, y: 0 };
    updateLightboxImgTransform();
  });

  document.getElementById("lightbox-rotate-btn")?.addEventListener("click", () => {
    rotateAngle += 90;
    updateLightboxImgTransform();
  });

  document.getElementById("lightbox-close-btn")?.addEventListener("click", () => {
    document.getElementById("verification-lightbox")?.classList.add("hidden");
  });

  document.getElementById("btn-close-id-inspector")?.addEventListener("click", () => {
    document.getElementById("inspector-profile-modal")?.classList.add("hidden");
  });

  if (lbImg) {
    lbImg.addEventListener("mousedown", (e) => {
      e.preventDefault();
      isPanning = true;
      panStart.x = e.clientX - panOffset.x;
      panStart.y = e.clientY - panOffset.y;
      lbImg.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
      if (!isPanning) return;
      panOffset.x = e.clientX - panStart.x;
      panOffset.y = e.clientY - panStart.y;
      updateLightboxImgTransform();
    });

    window.addEventListener("mouseup", () => {
      if (isPanning) {
        isPanning = false;
        lbImg.style.cursor = "grab";
      }
    });
  }
}

function updateLightboxImgTransform() {
  const lbImg = document.getElementById("lightbox-image-element");
  if (lbImg) {
    lbImg.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomFactor}) rotate(${rotateAngle}deg)`;
  }
}

function openLightboxImage(url: string, title: string, subtitle: string) {
  const lightbox = document.getElementById("verification-lightbox");
  const lbImg = document.getElementById("lightbox-image-element") as HTMLImageElement;
  const lbTitle = document.getElementById("lightbox-doc-title");
  const lbSubtitle = document.getElementById("lightbox-doc-subtitle");
  const lbDownload = document.getElementById("lightbox-download-link") as HTMLAnchorElement;

  if (!lightbox || !lbImg) return;

  // Reset transforms
  zoomFactor = 1;
  rotateAngle = 0;
  panOffset = { x: 0, y: 0 };
  updateLightboxImgTransform();

  lbImg.src = url;
  if (lbTitle) lbTitle.innerText = title;
  if (lbSubtitle) lbSubtitle.innerText = subtitle;
  if (lbDownload) {
    lbDownload.href = url;
    lbDownload.setAttribute("download", title.replace(/\s+/g, "_") + ".jpg");
  }

  lightbox.classList.remove("hidden");
}

function viewRiderDetailedInspection(id: string) {
  const r = ridersCache.find((item) => item.deliveryId === id);
  if (!r) {
    showToast("Profile details not found.", "error");
    return;
  }

  // Auto transition to "Under Review" if currently "Pending"
  if (getRiderVerificationStatus(r) === "Pending") {
    r.verificationStatus = "Under Review";
    update(ref(db, `deliveryboy1/${id}`), { verificationStatus: "Under Review" });
  }

  const inspectorModal = document.getElementById("inspector-profile-modal");
  const inspectorContent = document.getElementById("inspector-modal-content");
  if (!inspectorModal || !inspectorContent) return;

  const name = r.fullName || r.name || "Anonymous Partner";
  const email = r.email || "N/A";
  const mobile = r.mobile || "N/A";
  const aadhaar = r.aadhaarNumber || "Not entered";
  const dlNumber = r.drivingLicenseNumber || r.licenseNumber || "Not entered";
  const vehicleType = r.vehicleType || "Not specified";
  const vehicleNumber = r.vehicleNumber || "Not specified";
  const state = r.state || "Not specified";
  const district = r.district || "Not specified";
  const emergencyContact = r.emergencyContact || "N/A";
  const address = r.address || "N/A";
  const status = getRiderVerificationStatus(r);
  const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleString() : "N/A";
  const profilePic = r.profilePhoto || r.profilePhotoUrl || r.photoUrl || "https://img.icons8.com/color/96/delivery-man.png";

  const aadFront = r.aadhaarFront || r.aadhaarFrontUrl || "";
  const aadBack = r.aadhaarBack || r.aadhaarBackUrl || "";
  const dlImage = r.drivingLicenseImage || r.licenseImageUrl || "";
  const dlBackImage = r.drivingLicenseBackImage || r.licenseBackImageUrl || "";
  const selfieIdImage = r.selfieVerification || r.selfieVerificationUrl || "";

  let badgeColor = "";
  if (status === "Pending") badgeColor = "bg-yellow-50 text-yellow-700 border-yellow-250";
  else if (status === "Under Review") badgeColor = "bg-indigo-50 text-indigo-700 border-indigo-250";
  else if (status === "Approved") badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-250";
  else if (status === "Rejected") badgeColor = "bg-rose-50 text-rose-700 border-rose-250";
  else if (status === "Suspended") badgeColor = "bg-slate-100 text-slate-700 border-slate-350";

  inspectorContent.innerHTML = `
    <!-- Top Identity Card Header -->
    <div class="border-b border-slate-150 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-left">
      <div class="flex items-center gap-4">
        <div class="relative w-16 h-16 rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-slate-50 shrink-0 group">
          <img src="${profilePic}" class="w-full h-full object-cover group-hover:scale-110 transition-all cursor-pointer" onclick="openLightboxImage('${profilePic}', '${name.replace(/'/g, "\\'")} - Profile', 'Face Photo')" alt="Rider profile thumbnail" referrerPolicy="no-referrer" />
          <div class="absolute inset-0 bg-black/40 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none font-bold">
            <i class="fa-solid fa-expand mr-1"></i>Zoom
          </div>
        </div>
        <div>
          <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Delivery Candidate Dossier</span>
          <h2 class="text-lg font-black text-slate-900 flex items-center gap-2 leading-tight mt-0.5">
            ${name}
          </h2>
          <span class="text-xs text-indigo-600 font-mono font-bold block">ID: ${id}</span>
        </div>
      </div>
      <div>
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-bold text-slate-400">Current Status:</span>
          <span class="px-3 py-1 rounded-full text-xs font-black uppercase border ${badgeColor}">
            ${status}
          </span>
        </div>
      </div>
    </div>

    <!-- Rejection warning / message if any -->
    ${r.rejectionReason ? `
      <div class="p-3 bg-rose-50 border border-rose-150 rounded-xl text-xs text-rose-850 text-left flex items-start gap-2">
        <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
        <div>
          <span class="font-bold">Last Rejection/Re-upload Reason:</span>
          <span class="font-semibold">${r.rejectionReason}</span>
        </div>
      </div>
    ` : ""}

    <!-- Complete 14 parameters Info Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5 text-left text-xs bg-slate-50 p-5 rounded-2xl border border-slate-200 animate-fade-in">
      
      <!-- Box 1: Personal Information -->
      <div class="space-y-3">
        <h3 class="font-black text-slate-800 border-b border-slate-200 pb-1.5 flex items-center gap-1.5 leading-none">
          <i class="fa-solid fa-address-card text-indigo-500 text-sm"></i>
          <span>Personal Information</span>
        </h3>
        <div class="space-y-2">
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Candidate Name</span>
            <span class="font-extrabold text-slate-800 text-sm block">${name}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Email Address</span>
            <span class="font-mono text-slate-700 block">${email}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Mobile Line</span>
            <span class="font-mono font-bold text-slate-800 block">${mobile}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Emergency Contact</span>
            <span class="font-mono font-bold text-rose-600 block"><i class="fa-solid fa-phone-flip text-[9px] mr-1"></i>${emergencyContact}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Permanent Address</span>
            <span class="font-semibold text-slate-600 block bg-slate-100 p-1.5 rounded border border-slate-150 leading-relaxed text-[10px] mt-0.5">${address}</span>
          </div>
        </div>
      </div>

      <!-- Box 2: Vehicle Logistics -->
      <div class="space-y-3">
        <h3 class="font-black text-slate-800 border-b border-slate-200 pb-1.5 flex items-center gap-1.5 leading-none">
          <i class="fa-solid fa-truck-fast text-amber-500 text-sm"></i>
          <span>Vehicle Logistics</span>
        </h3>
        <div class="space-y-2">
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Vehicle Type</span>
            <span class="font-extrabold text-slate-800 capitalize text-sm block">${vehicleType}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">License Plate Number</span>
            <span class="font-mono uppercase text-slate-850 font-extrabold block bg-white px-2 py-1 rounded inline-block border border-slate-200 mt-0.5">${vehicleNumber}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Operational State</span>
            <span class="font-bold text-slate-700 block">${state}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Service District</span>
            <span class="font-bold text-slate-700 block">${district}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Joining Date</span>
            <span class="font-mono text-slate-700 block">${dateStr}</span>
          </div>
        </div>
      </div>

      <!-- Box 3: Document Numbers -->
      <div class="space-y-3">
        <h3 class="font-black text-slate-800 border-b border-slate-200 pb-1.5 flex items-center gap-1.5 leading-none">
          <i class="fa-solid fa-shield text-emerald-500 text-sm"></i>
          <span>Document Numbers</span>
        </h3>
        <div class="space-y-2">
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Aadhaar Number</span>
            <span class="font-mono text-slate-800 font-extrabold text-sm block tracking-widest mt-0.5">${aadhaar}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Driving License Number</span>
            <span class="font-mono text-slate-800 font-extrabold text-sm uppercase block tracking-widest mt-0.5">${dlNumber}</span>
          </div>
        </div>
      </div>

    </div>

    <!-- Uploaded Documents Live Inspection View (CLOUD STORAGE LINKS) -->
    <div class="space-y-3.5 text-left">
      <h3 class="text-xs font-black text-slate-800 flex items-center justify-between border-b border-slate-100 pb-2">
        <span class="flex items-center gap-1.5"><i class="fa-solid fa-passport text-slate-400"></i> Cloud Storage Assets (Manual Document Verification)</span>
        <span class="text-[10px] text-slate-400 font-bold">Hosted on Cloudinary Secure Storage</span>
      </h3>
      
      <div class="grid grid-cols-1 sm:grid-cols-5 gap-4">
        
        <!-- Aadhaar Card Front -->
        <div class="bg-white border border-slate-200 rounded-xl p-3 space-y-3 shadow-xs">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Aadhaar Front</span>
            <span class="text-[9px] text-blue-650 font-bold uppercase flex items-center gap-1">
              <i class="fa-solid fa-cloud-arrow-up"></i> Verified
            </span>
          </div>
          <div class="relative rounded-lg overflow-hidden border border-slate-150 aspect-video max-h-32 bg-slate-50 flex items-center justify-center group">
            ${aadFront ? `
              <img src="${aadFront}" class="w-full h-full object-cover transition-all group-hover:scale-105" alt="Aadhaar Front" referrerPolicy="no-referrer" />
              <button onclick="openLightboxImage('${aadFront}', '${name.replace(/'/g, "\\'")} - Aadhaar Front', 'Aadhaar Card Front Copy')" class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 text-white text-[10px] font-bold flex items-center justify-center gap-1 transition-opacity cursor-pointer">
                <i class="fa-solid fa-magnifying-glass-plus"></i> View Front Image
              </button>
            ` : `
              <div class="flex flex-col items-center justify-center text-slate-350 gap-1 bg-white">
                <i class="fa-solid fa-circle-exclamation text-2xl"></i>
                <span class="text-[10px] font-semibold">Not Uploaded</span>
              </div>
            `}
          </div>
          <div class="flex gap-1.5 pt-1">
            <button onclick="openLightboxImage('${aadFront}', '${name.replace(/'/g, "\\'")} - Aadhaar Front', 'Aadhaar Card Front Copy')" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-black py-1.5 rounded-lg border border-indigo-100 transition-all text-center cursor-pointer" ${!aadFront ? "disabled" : ""}>
              <i class="fa-solid fa-expand mr-1"></i> View Aadhaar Front
            </button>
            <a href="${aadFront}" target="_blank" download class="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 p-1.5 rounded-lg transition-all flex items-center justify-center cursor-pointer" title="Download Aadhaar Front Copy" ${!aadFront ? "style='pointer-events:none; opacity:0.5;'" : ""}>
              <i class="fa-solid fa-download"></i>
            </a>
          </div>
        </div>

        <!-- Aadhaar Card Back -->
        <div class="bg-white border border-slate-200 rounded-xl p-3 space-y-3 shadow-xs">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Aadhaar Back</span>
            <span class="text-[9px] text-blue-650 font-bold uppercase flex items-center gap-1">
              <i class="fa-solid fa-cloud-arrow-up"></i> Verified
            </span>
          </div>
          <div class="relative rounded-lg overflow-hidden border border-slate-150 aspect-video max-h-32 bg-slate-50 flex items-center justify-center group flex-col">
            ${aadBack ? `
              <img src="${aadBack}" class="w-full h-full object-cover transition-all group-hover:scale-105" alt="Aadhaar Back" referrerPolicy="no-referrer" />
              <button onclick="openLightboxImage('${aadBack}', '${name.replace(/'/g, "\\'")} - Aadhaar Back', 'Aadhaar Card Back Copy')" class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 text-white text-[10px] font-bold flex items-center justify-center gap-1 transition-opacity cursor-pointer">
                <i class="fa-solid fa-magnifying-glass-plus"></i> View Back Image
              </button>
            ` : `
              <div class="flex flex-col items-center justify-center text-slate-350 gap-1 bg-white">
                <i class="fa-solid fa-circle-exclamation text-2xl"></i>
                <span class="text-[10px] font-semibold">Not Uploaded</span>
              </div>
            `}
          </div>
          <div class="flex gap-1.5 pt-1">
            <button onclick="openLightboxImage('${aadBack}', '${name.replace(/'/g, "\\'")} - Aadhaar Back', 'Aadhaar Card Back Copy')" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-black py-1.5 rounded-lg border border-indigo-100 transition-all text-center cursor-pointer" ${!aadBack ? "disabled" : ""}>
              <i class="fa-solid fa-expand mr-1"></i> View Aadhaar Back
            </button>
            <a href="${aadBack}" target="_blank" download class="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 p-1.5 rounded-lg transition-all flex items-center justify-center cursor-pointer" title="Download Aadhaar Back Copy" ${!aadBack ? "style='pointer-events:none; opacity:0.5;'" : ""}>
              <i class="fa-solid fa-download"></i>
            </a>
          </div>
        </div>

        <!-- Driving License Front -->
        <div class="bg-white border border-slate-200 rounded-xl p-3 space-y-3 shadow-xs">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">DL Front</span>
            <span class="text-[9px] text-blue-650 font-bold uppercase flex items-center gap-1">
              <i class="fa-solid fa-cloud-arrow-up"></i> Verified
            </span>
          </div>
          <div class="relative rounded-lg overflow-hidden border border-slate-150 aspect-video max-h-32 bg-slate-50 flex items-center justify-center group font-black">
            ${dlImage ? `
              <img src="${dlImage}" class="w-full h-full object-cover transition-all group-hover:scale-105" alt="Driving License" referrerPolicy="no-referrer" />
              <button onclick="openLightboxImage('${dlImage}', '${name.replace(/'/g, "\\'")} - License', 'Driving License Copy')" class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 text-white text-[10px] font-bold flex items-center justify-center gap-1 transition-opacity cursor-pointer">
                <i class="fa-solid fa-magnifying-glass-plus"></i> View DL Image
              </button>
            ` : `
              <div class="flex flex-col items-center justify-center text-slate-350 gap-1 bg-white">
                <i class="fa-solid fa-circle-exclamation text-2xl"></i>
                <span class="text-[10px] font-semibold">Not Uploaded</span>
              </div>
            `}
          </div>
          <div class="flex gap-1.5 pt-1">
            <button onclick="openLightboxImage('${dlImage}', '${name.replace(/'/g, "\\'")} - Driving License', 'Driving License Copy')" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-black py-1.5 rounded-lg border border-indigo-100 transition-all text-center cursor-pointer" ${!dlImage ? "disabled" : ""}>
              <i class="fa-solid fa-expand mr-1"></i> View DL Front
            </button>
            <a href="${dlImage}" target="_blank" download class="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 p-1.5 rounded-lg transition-all flex items-center justify-center cursor-pointer" title="Download License Document Copy" ${!dlImage ? "style='pointer-events:none; opacity:0.5;'" : ""}>
              <i class="fa-solid fa-download"></i>
            </a>
          </div>
        </div>

        <!-- Driving License Back -->
        <div class="bg-white border border-slate-200 rounded-xl p-3 space-y-3 shadow-xs">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">DL Back</span>
            <span class="text-[9px] text-blue-650 font-bold uppercase flex items-center gap-1">
              <i class="fa-solid fa-cloud-arrow-up"></i> Verified
            </span>
          </div>
          <div class="relative rounded-lg overflow-hidden border border-slate-150 aspect-video max-h-32 bg-slate-50 flex items-center justify-center group font-black">
            ${dlBackImage ? `
              <img src="${dlBackImage}" class="w-full h-full object-cover transition-all group-hover:scale-105" alt="Driving License Back" referrerPolicy="no-referrer" />
              <button onclick="openLightboxImage('${dlBackImage}', '${name.replace(/'/g, "\\'")} - DL Back', 'Driving License Back Copy')" class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 text-white text-[10px] font-bold flex items-center justify-center gap-1 transition-opacity cursor-pointer">
                <i class="fa-solid fa-magnifying-glass-plus"></i> View DL Back Image
              </button>
            ` : `
              <div class="flex flex-col items-center justify-center text-slate-350 gap-1 bg-white">
                <i class="fa-solid fa-circle-exclamation text-2xl"></i>
                <span class="text-[10px] font-semibold">Not Uploaded</span>
              </div>
            `}
          </div>
          <div class="flex gap-1.5 pt-1">
            <button onclick="openLightboxImage('${dlBackImage}', '${name.replace(/'/g, "\\'")} - DL Back', 'Driving License Back Copy')" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-black py-1.5 rounded-lg border border-indigo-100 transition-all text-center cursor-pointer" ${!dlBackImage ? "disabled" : ""}>
              <i class="fa-solid fa-expand mr-1"></i> View DL Back
            </button>
            <a href="${dlBackImage}" target="_blank" download class="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 p-1.5 rounded-lg transition-all flex items-center justify-center cursor-pointer" title="Download License Back Copy" ${!dlBackImage ? "style='pointer-events:none; opacity:0.5;'" : ""}>
              <i class="fa-solid fa-download"></i>
            </a>
          </div>
        </div>

        <!-- Selfie Verification -->
        <div class="bg-white border border-slate-200 rounded-xl p-3 space-y-3 shadow-xs">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Selfie Verification</span>
            <span class="text-[9px] text-blue-650 font-bold uppercase flex items-center gap-1">
              <i class="fa-solid fa-cloud-arrow-up"></i> Verified
            </span>
          </div>
          <div class="relative rounded-lg overflow-hidden border border-slate-150 aspect-video max-h-32 bg-slate-50 flex items-center justify-center group font-black">
            ${selfieIdImage ? `
              <img src="${selfieIdImage}" class="w-full h-full object-cover transition-all group-hover:scale-105" alt="Selfie Verification" referrerPolicy="no-referrer" />
              <button onclick="openLightboxImage('${selfieIdImage}', '${name.replace(/'/g, "\\'")} - Selfie ID', 'Identity Verification Selfie copy')" class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 text-white text-[10px] font-bold flex items-center justify-center gap-1 transition-opacity cursor-pointer">
                <i class="fa-solid fa-magnifying-glass-plus"></i> View Selfie ID
              </button>
            ` : `
              <div class="flex flex-col items-center justify-center text-slate-350 gap-1 bg-white">
                <i class="fa-solid fa-circle-exclamation text-2xl"></i>
                <span class="text-[10px] font-semibold">Not Uploaded</span>
              </div>
            `}
          </div>
          <div class="flex gap-1.5 pt-1">
            <button onclick="openLightboxImage('${selfieIdImage}', '${name.replace(/'/g, "\\'")} - Selfie Verification', 'Identity Verification Selfie Copy')" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-black py-1.5 rounded-lg border border-indigo-100 transition-all text-center cursor-pointer" ${!selfieIdImage ? "disabled" : ""}>
              <i class="fa-solid fa-expand mr-1"></i> View Selfie Verification
            </button>
            <a href="${selfieIdImage}" target="_blank" download class="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 p-1.5 rounded-lg transition-all flex items-center justify-center cursor-pointer" title="Download Selfie Document Copy" ${!selfieIdImage ? "style='pointer-events:none; opacity:0.5;'" : ""}>
              <i class="fa-solid fa-download"></i>
            </a>
          </div>
        </div>

      </div>
    </div>

    <!-- Active Verification Control Center (Verification actions) -->
    <div class="border-t border-slate-150 pt-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-left">
      <div>
        <h4 class="text-xs font-black text-slate-800">Operational Verification Override</h4>
        <p class="text-[10px] text-slate-400 font-semibold">Commit manual KYC audit decisions instantly to database endpoints.</p>
      </div>
      <div class="flex flex-wrap gap-2 shrink-0">
        
        ${status !== "Approved" ? `
          <!-- Option: Approve Rider -->
          <button onclick="approveRiderMaster('${id}')" class="bg-emerald-600 hover:bg-emerald-700 hover:shadow-md text-white text-xs font-black px-4 py-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 shadow-sm">
            <i class="fa-solid fa-user-check"></i> Approve Delivery Boy
          </button>
          
          <!-- Option: Reject Application -->
          <button onclick="rejectRiderMaster('${id}')" class="bg-rose-600 hover:bg-rose-700 hover:shadow-md text-white text-xs font-black px-4 py-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 shadow-sm">
            <i class="fa-solid fa-user-xmark"></i> Reject Delivery Boy
          </button>

          <!-- Option: Require document re-upload -->
          <button onclick="requestRiderReupload('${id}')" class="bg-amber-500 hover:bg-amber-600 hover:shadow-md text-white text-xs font-black px-4 py-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 shadow-sm">
            <i class="fa-solid fa-rotate-left"></i> Request Re-Upload
          </button>
        ` : `
          <!-- Option: Suspend Activity -->
          <button onclick="suspendRiderMaster('${id}')" class="bg-slate-800 hover:bg-slate-900 text-white text-xs font-black px-4 py-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 shadow-sm">
            <i class="fa-solid fa-ban"></i> Suspend Delivery Boy
          </button>

          <span class="text-emerald-700 bg-emerald-50 border border-emerald-100 px-3.5 py-2.5 rounded-xl font-extrabold text-xs flex items-center gap-2 select-none">
            <i class="fa-solid fa-circle-check text-base"></i> Active Verified Delivery Boy Account
          </span>
        `}

        ${status === "Suspended" ? `
          <!-- Option: Reactivate Suspect -->
          <button onclick="reactivateRiderMaster('${id}')" class="bg-emerald-600 hover:bg-emerald-700 hover:shadow-md text-white text-xs font-black px-4 py-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 shadow-sm">
            <i class="fa-solid fa-user-shield"></i> Reactivate Agent
          </button>
        ` : ""}

      </div>
    </div>
  `;

  inspectorModal.classList.remove("hidden");
}

Object.assign(window, {
  renderVerificationCenter,
  initRiderVerificationListeners,
  openLightboxImage,
  viewRiderDetailedInspection,
  approveRiderMaster(id: string) {
    update(ref(db, `users/${id}`), { approved: true });
    update(ref(db, `deliveryboy1/${id}`), { approved: true, active: true, verificationStatus: "Approved" }).then(() => {
      showToast("Delivery Boy verified and approved!", "success");
      const r = ridersCache.find(x => x.deliveryId === id);
      if (r) {
        r.approved = true;
        r.active = true;
        r.verificationStatus = "Approved";
        viewRiderDetailedInspection(id);
      }
    });
  },
  rejectRiderMaster(id: string) {
    const reason = prompt("Enter Rejection Reason:")?.trim();
    if (reason === undefined) return;
    if (!reason) {
      showToast("Rejection reason is required.", "error");
      return;
    }
    update(ref(db, `users/${id}`), { approved: false, onboardSubmitted: false });
    update(ref(db, `deliveryboy1/${id}`), { approved: false, onboardSubmitted: false, verificationStatus: "Rejected", rejectionReason: reason }).then(() => {
      showToast("Delivery Boy application rejected.", "info");
      const r = ridersCache.find(x => x.deliveryId === id);
      if (r) {
        r.approved = false;
        r.onboardSubmitted = false;
        r.verificationStatus = "Rejected";
        r.rejectionReason = reason;
        viewRiderDetailedInspection(id);
      }
    });
  },
  requestRiderReupload(id: string) {
    const reason = prompt("Describe document re-upload requirement details:")?.trim();
    if (reason === undefined) return;
    if (!reason) {
      showToast("Requirement description is required.", "error");
      return;
    }
    update(ref(db, `users/${id}`), { approved: false, onboardSubmitted: false });
    update(ref(db, `deliveryboy1/${id}`), { approved: false, onboardSubmitted: false, verificationStatus: "Pending", rejectionReason: `Re-upload requested: ${reason}` }).then(() => {
      showToast("Re-upload request dispatched to delivery boy.", "success");
      const r = ridersCache.find(x => x.deliveryId === id);
      if (r) {
        r.approved = false;
        r.onboardSubmitted = false;
        r.verificationStatus = "Pending";
        r.rejectionReason = `Re-upload requested: ${reason}`;
        viewRiderDetailedInspection(id);
      }
    });
  },
  suspendRiderMaster(id: string) {
    if (confirm("Are you sure you want to suspend this delivery boy?")) {
      update(ref(db, `deliveryboy1/${id}`), { active: false, verificationStatus: "Suspended" }).then(() => {
        showToast("Delivery Boy has been suspended from duties.", "info");
        const r = ridersCache.find(x => x.deliveryId === id);
        if (r) {
          r.active = false;
          r.verificationStatus = "Suspended";
          viewRiderDetailedInspection(id);
        }
      });
    }
  },
  reactivateRiderMaster(id: string) {
    update(ref(db, `deliveryboy1/${id}`), { active: true, approved: true, verificationStatus: "Approved" }).then(() => {
      showToast("Delivery Boy reactivated back to service!", "success");
      const r = ridersCache.find(x => x.deliveryId === id);
      if (r) {
        r.active = true;
        r.approved = true;
        r.verificationStatus = "Approved";
        viewRiderDetailedInspection(id);
      }
    });
  }
});

// =================================== STORE MANAGEMENT CENTER ENGINE ===================================
// Core state cache for selected store branch details
let smcStores: any[] = [];
let smcMedicines: any[] = [];
let smcOrders: any[] = [];
let smcReviews: any = {};
let smcSelectedStoreId = "";
let smcSelectedTab = "docs";

function initStoreManagementCenter() {
  // 1. Listen in real-time to Stores
  onValue(ref(db, "stores"), (snapshot) => {
    smcStores = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const s = child.val();
        if (s) {
          if (!s.storeId) s.storeId = child.key;
          smcStores.push(s);
        }
      });
    }
    renderSmcStoresTree();
    
    // Auto refresh active selected store
    if (smcSelectedStoreId) {
      const activeStore = smcStores.find(s => s.storeId === smcSelectedStoreId);
      if (activeStore) {
        smcSelectStore(smcSelectedStoreId);
      } else {
        smcClearSelection();
      }
    }
  });

  // 2. Listen in real-time to Medicines
  onValue(ref(db, "medicines"), (snapshot) => {
    smcMedicines = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const m = child.val();
        if (m) {
          if (!m.medicineId) m.medicineId = child.key;
          smcMedicines.push(m);
          if (m.category) {
            autoProvisionCategoryIfNeeded(m.category);
          }
        }
      });
    }
    if (smcSelectedStoreId) {
      renderSmcStoreCatalog();
      calculateSelectedStoreMetrics();
    }
  });

  // 3. Listen in real-time to Orders
  onValue(ref(db, "orders"), (snapshot) => {
    smcOrders = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const o = child.val();
        if (o) {
          if (!o.orderId) o.orderId = child.key;
          smcOrders.push(o);
        }
      });
    }
    if (smcSelectedStoreId) {
      renderSmcStoreOrders();
      renderSmcStoreAnalytics();
      calculateSelectedStoreMetrics();
    }
  });

  // 4. Listen in real-time to global Reviews
  onValue(ref(db, "reviews"), (snapshot) => {
    smcReviews = {};
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        smcReviews[child.key] = child.val();
      });
    }
    if (smcSelectedStoreId) {
      renderSmcStoreReviews();
      calculateSelectedStoreMetrics();
    }
  });

  // Setup Sidebar Tree Input Filters
  document.getElementById("smc-store-search")?.addEventListener("input", renderSmcStoresTree);
  document.getElementById("smc-status-filter")?.addEventListener("change", renderSmcStoresTree);

  // Bind Cabinet tab switching click event listeners
  setupSmcCabinetTabListeners();

  // Bind Override form on-submit
  const overrideForm = document.getElementById("smc-form-override");
  if (overrideForm) {
    overrideForm.addEventListener("submit", smcHandleProfileOverrideSubmit);
  }

  // Bind Core Admin Actions to Selected Store Buttons
  document.getElementById("smc-btn-approve")?.addEventListener("click", () => smcAdminAction("approve"));
  document.getElementById("smc-btn-reject")?.addEventListener("click", () => smcAdminAction("reject"));
  document.getElementById("smc-btn-toggle-active")?.addEventListener("click", () => smcAdminAction("toggle-active"));
  document.getElementById("smc-btn-edit")?.addEventListener("click", () => smcOpenOverrideModal());
  document.getElementById("smc-btn-delete")?.addEventListener("click", () => smcAdminAction("delete"));
}

function renderSmcStoresTree() {
  const container = document.getElementById("smc-stores-list-tree");
  if (!container) return;

  const searchInp = document.getElementById("smc-store-search") as HTMLInputElement;
  const filterSelect = document.getElementById("smc-status-filter") as HTMLSelectElement;
  const searchVal = searchInp ? searchInp.value.trim().toLowerCase() : "";
  const filterVal = filterSelect ? filterSelect.value : "ALL";

  // Filter
  const filtered = smcStores.filter((s) => {
    const matchesSearch = s.name?.toLowerCase().includes(searchVal) ||
      s.ownerName?.toLowerCase().includes(searchVal) ||
      s.licenseNumber?.toLowerCase().includes(searchVal) ||
      s.district?.toLowerCase().includes(searchVal);

    let matchesStatus = true;
    if (filterVal === "APPROVED") {
      matchesStatus = s.approved === true;
    } else if (filterVal === "PENDING") {
      matchesStatus = s.approved !== true && s.approved !== false;
    } else if (filterVal === "SUSPENDED") {
      matchesStatus = s.active === false;
    }

    return matchesSearch && matchesStatus;
  });

  // Update total counts
  const totalLabel = document.getElementById("smc-registered-cnt");
  if (totalLabel) totalLabel.innerText = `${filtered.length} Nodes`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400 font-medium text-xs">
        No matching branches found.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((s) => {
    const isSelected = s.storeId === smcSelectedStoreId;
    
    // Compute Badge States
    const appBadge = s.approved === true 
      ? `<span class="bg-emerald-50 text-emerald-700 border border-emerald-200 py-0.5 px-1.5 rounded-md text-[8px] font-black uppercase">Approved</span>`
      : s.approved === false
      ? `<span class="bg-rose-50 text-rose-700 border border-rose-200 py-0.5 px-1.5 rounded-md text-[8px] font-black uppercase">Rejected</span>`
      : `<span class="bg-amber-50 text-amber-700 border border-amber-200 py-0.5 px-1.5 rounded-md text-[8px] font-black uppercase">On Hold</span>`;

    const actBadge = s.active === false 
      ? `<span class="bg-stone-100 text-stone-600 py-0.5 px-1.5 rounded-md text-[8px] font-black uppercase">Suspended</span>`
      : `<span class="bg-indigo-50 text-indigo-700 py-0.5 px-1.5 rounded-md text-[8px] font-black uppercase">Active</span>`;

    return `
      <div onclick="smcSelectStore('${s.storeId}')" class="p-3 bg-white rounded-xl border cursor-pointer hover:border-indigo-400 transition-all duration-150 space-y-1.5 ${
        isSelected ? "border-indigo-500 bg-indigo-50/10 shadow-sm" : "border-slate-100"
      }">
        <div class="flex items-center gap-2">
          <img src="${s.logo || 'https://images.unsplash.com/photo-1586015555751-63bb77f4322a?auto=format&fit=crop&q=80&w=200'}" class="w-8 h-8 rounded-lg object-cover bg-slate-50 border border-slate-100 shrink-0" referrerPolicy="no-referrer">
          <div class="min-w-0 flex-1">
            <h5 class="text-slate-800 font-extrabold truncate leading-tight">${s.name || "Apothecary Retail Branch"}</h5>
            <p class="text-[9px] text-slate-400 font-bold truncate leading-snug">Owner: ${s.ownerName || "Merchant Name"}</p>
          </div>
        </div>
        <div class="flex justify-between items-center gap-1 flex-wrap pt-1 border-t border-slate-50 select-none">
          <span class="text-[9px] text-slate-400 font-extrabold truncate w-[45%]">${s.district || "Bengaluru"}, ${s.state || "KA"}</span>
          <div class="flex gap-1 shrink-0">
            ${appBadge}
            ${actBadge}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function smcSelectStore(storeId: string) {
  smcSelectedStoreId = storeId;
  const store = smcStores.find(s => s.storeId === storeId);
  if (!store) return;

  // Switch View Container state
  const emptyState = document.getElementById("smc-cabinet-empty-state");
  const dataView = document.getElementById("smc-cabinet-data-viewport");
  if (emptyState) emptyState.classList.add("hidden");
  if (dataView) dataView.classList.remove("hidden");

  // Load Hero
  const bannerImg = document.getElementById("smc-disp-banner") as HTMLImageElement;
  const logoImg = document.getElementById("smc-disp-logo") as HTMLImageElement;
  if (bannerImg) bannerImg.src = store.banner || "https://images.unsplash.com/photo-1628771065518-0d82f1938462?auto=format&fit=crop&q=80&w=400";
  if (logoImg) logoImg.src = store.logo || "https://images.unsplash.com/photo-1586015555751-63bb77f4322a?auto=format&fit=crop&q=80&w=200";
  
  const dName = document.getElementById("smc-disp-name");
  const dOwner = document.getElementById("smc-disp-owner-city");
  if (dName) dName.innerText = store.name || "Retailing Pharmacy Outlet";
  if (dOwner) dOwner.innerText = `${store.ownerName || 'Unknown Merchant Owner'} • ${store.district || 'District area'}, ${store.state || 'Karnataka'}`;

  // Approval status indicators
  const appEl = document.getElementById("smc-disp-status-app")!;
  if (appEl) {
    if (store.approved === true) {
      appEl.className = "text-[8px] px-2 py-0.5 rounded font-black uppercase text-white bg-emerald-500";
      appEl.innerText = "Approved Node";
    } else if (store.approved === false) {
      appEl.className = "text-[8px] px-2 py-0.5 rounded font-black uppercase text-white bg-rose-500";
      appEl.innerText = "Rejected App";
    } else {
      appEl.className = "text-[8px] px-2 py-0.5 rounded font-black uppercase text-white bg-amber-500";
      appEl.innerText = "Review Pending";
    }
  }

  // Active status indicators
  const actEl = document.getElementById("smc-disp-status-act")!;
  if (actEl) {
    if (store.active === false) {
      actEl.className = "text-[8px] px-2 py-0.5 rounded font-black uppercase text-white bg-rose-500";
      actEl.innerText = "Suspended";
    } else {
      actEl.className = "text-[8px] px-2 py-0.5 rounded font-black uppercase text-white bg-emerald-500";
      actEl.innerText = "Active";
    }
  }

  // Configure Suspend Button Toggle
  const toggleBtn = document.getElementById("smc-btn-toggle-active")!;
  if (toggleBtn) {
    if (store.active === false) {
      toggleBtn.innerHTML = `<i class="fa-solid fa-play"></i> Activate Node`;
      toggleBtn.className = "bg-emerald-50 border border-emerald-250 text-emerald-700 hover:bg-emerald-100 text-[10px] font-black px-2.5 py-1.5 rounded-lg cursor-pointer flex items-center gap-1.5 transition-all";
    } else {
      toggleBtn.innerHTML = `<i class="fa-solid fa-hand text-rose-500"></i> Suspend Node`;
      toggleBtn.className = "bg-rose-50 border border-rose-150 text-rose-600 hover:bg-rose-100 text-[10px] font-black px-2.5 py-1.5 rounded-lg cursor-pointer flex items-center gap-1.5 transition-all";
    }
  }

  // Populate docs and licenses view details
  const licDocImg = document.getElementById("smc-license-doc-img") as HTMLImageElement;
  if (licDocImg) licDocImg.src = store.drugLicenseImage || store.licenseImage || "https://images.unsplash.com/photo-1586015555751-63bb77f4322a?auto=format&fit=crop&q=80&w=200";
  
  const pDl = document.getElementById("smc-p-dl");
  const pEmail = document.getElementById("smc-p-email");
  const pMobile = document.getElementById("smc-p-mobile");
  const pLocality = document.getElementById("smc-p-locality");
  const pAddress = document.getElementById("smc-p-address");
  const lblReg = document.getElementById("smc-lbl-reg-date");

  if (pDl) pDl.innerText = store.licenseNumber || store.drugLicenseNumber || "N/A Not Provided";
  if (pEmail) pEmail.innerText = store.email || "No credential email";
  if (pMobile) pMobile.innerText = store.mobile || "No phone line registered";
  if (pLocality) pLocality.innerText = `${store.state || 'Karnataka'} • ${store.district || 'District Urban'}`;
  if (pAddress) pAddress.innerText = store.address || "No address submitted";
  if (lblReg) {
    lblReg.innerText = store.createdAt 
      ? `Enrolled: ${new Date(store.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
      : "Verified Branch";
  }

  // Re-run dynamic rendering of other tab panes
  renderSmcStoreCatalog();
  renderSmcStoreOrders();
  renderSmcStoreAnalytics();
  renderSmcStoreReviews();
  calculateSelectedStoreMetrics();
}

function calculateSelectedStoreMetrics() {
  if (!smcSelectedStoreId) return;

  const medicines = smcMedicines.filter((m) => m.storeId === smcSelectedStoreId);
  const orders = smcOrders.filter((o) => o.storeId === smcSelectedStoreId);
  const storeReviews = smcReviews[smcSelectedStoreId] ? Object.values(smcReviews[smcSelectedStoreId]) : [];

  // 1. Catalog Count
  const medTotalVal = document.getElementById("smc-val-total-meds");
  if (medTotalVal) medTotalVal.innerText = medicines.length.toString();
  
  const lowStockCount = medicines.filter((m) => m.stock < 10).length;
  const outOfStockCount = medicines.filter((m) => m.stock === 0).length;
  
  const subLowStock = document.getElementById("smc-sub-low-stock");
  if (subLowStock) {
    subLowStock.innerText = `${lowStockCount} Low stock | ${outOfStockCount} Out of stock`;
    if (lowStockCount > 0 || outOfStockCount > 0) {
      subLowStock.className = "text-[9px] text-rose-500 font-extrabold animate-pulse block mt-1";
    } else {
      subLowStock.className = "text-[9px] text-slate-400 font-semibold block mt-1";
    }
  }

  // 2. Gross revenue Calculation
  const compOrders = orders.filter((o) => o.status === "delivered");
  const totalRevenue = compOrders.reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0);
  
  const valSales = document.getElementById("smc-val-sales");
  if (valSales) valSales.innerText = `₹${totalRevenue.toLocaleString()}`;

  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const dailyTotal = compOrders.filter((o) => (o.createdAt || now) > (now - oneDay)).reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0);
  const weeklyTotal = compOrders.filter((o) => (o.createdAt || now) > (now - (7 * oneDay))).reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0);
  const monthlyTotal = compOrders.filter((o) => (o.createdAt || now) > (now - (30 * oneDay))).reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0);

  const subSales = document.getElementById("smc-sub-sales");
  if (subSales) subSales.innerText = `₹${weeklyTotal.toLocaleString()} Weekly | ₹${monthlyTotal.toLocaleString()} Monthly`;
  
  const cDaily = document.getElementById("smc-calc-daily");
  const cWeekly = document.getElementById("smc-calc-weekly");
  const cMonthly = document.getElementById("smc-calc-monthly");
  const cWeeklyOrd = document.getElementById("smc-cnt-weekly-orders");

  if (cDaily) cDaily.innerText = `₹${dailyTotal.toLocaleString()}`;
  if (cWeekly) cWeekly.innerText = `₹${weeklyTotal.toLocaleString()}`;
  if (cMonthly) cMonthly.innerText = `₹${monthlyTotal.toLocaleString()}`;
  if (cWeeklyOrd) cWeeklyOrd.innerText = `${compOrders.filter((o) => (o.createdAt || now) > (now - (7 * oneDay))).length} Weeks completed`;

  // 3. Clinical performance Rating Average
  const valRate = document.getElementById("smc-val-rating");
  const subRev = document.getElementById("smc-sub-reviews");
  if (valRate && subRev) {
    if (storeReviews.length > 0) {
      let ratingSum = 0;
      storeReviews.forEach((r: any) => {
        ratingSum += parseFloat(r.rating || 5);
      });
      const avgScore = ratingSum / storeReviews.length;
      valRate.innerText = `${avgScore.toFixed(1)} / 5`;
      subRev.innerText = `${storeReviews.length} patient clinical reviews`;
    } else {
      valRate.innerText = `5.0 / 5`;
      subRev.innerText = `No rating scores yet`;
    }
  }

  // 4. Operations Load Card
  const valOrd = document.getElementById("smc-val-orders");
  const subOrd = document.getElementById("smc-sub-orders");
  if (valOrd && subOrd) {
    valOrd.innerText = `${orders.length} Bookings`;
    const newOrdersCount = orders.filter((o) => o.status === "placed" || o.status === "new").length;
    const procOrdersCount = orders.filter((o) => o.status === "accepted" || o.status === "processing").length;
    subOrd.innerText = `${newOrdersCount} New alerts | ${procOrdersCount} Processing`;
  }
}

function renderSmcStoreCatalog() {
  const container = document.getElementById("smc-med-grid");
  if (!container) return;

  const medicines = smcMedicines.filter((m) => m.storeId === smcSelectedStoreId);
  const lblCnt = document.getElementById("smc-lbl-med-cnt");
  if (lblCnt) lblCnt.innerText = `${medicines.length} Medicines cataloged`;

  if (medicines.length === 0) {
    container.innerHTML = `
      <div class="col-span-2 text-center py-12 text-slate-400 bg-white border border-slate-100 rounded-xl">
        This pharmacy catalog is completely empty.
      </div>
    `;
    return;
  }

  container.innerHTML = medicines.map((m) => {
    const isLow = m.stock < 10;
    return `
      <div id="smc_med_card_${m.medicineId}" class="bg-white p-3 border rounded-xl select-none flex gap-2.5 text-xs font-semibold relative ${
        isLow ? "border-rose-150 bg-rose-50/5" : "border-slate-100"
      }">
        <img class="w-12 h-12 rounded-lg object-cover shrink-0 border border-slate-100 bg-slate-50" src="${m.image || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&q=80&w=200'}" referrerPolicy="no-referrer">
        <div class="flex-1 min-w-0 space-y-1">
          <div class="flex items-start justify-between">
            <h5 class="font-extrabold text-slate-800 truncate pr-4 leading-tight">${m.name}</h5>
            <button onclick="smcDeleteMedicine('${m.medicineId}')" class="text-rose-500 absolute top-2 right-2 text-xs hover:scale-110 transition-all cursor-pointer">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
          <p class="text-[8px] text-indigo-600 uppercase font-bold tracking-wider leading-none">${m.category || "General General"}</p>
          
          <div class="flex items-center justify-between pt-1 gap-1 flex-wrap">
            <div class="flex items-center gap-0.5 flex-wrap">
              <span class="text-[8px] text-slate-400 font-bold">₹</span>
              <input type="number" onchange="smcUpdatePrice('${m.medicineId}', this.value)" value="${m.price}" min="1" class="w-10 text-center text-[10px] p-0.5 border border-slate-200 rounded font-black font-mono focus:border-indigo-500 outline-none bg-slate-50 text-slate-800">
            </div>
            <div class="flex items-center gap-0.5 flex-wrap">
              <span class="text-[8px] ${isLow ? "text-rose-600 animate-pulse font-extrabold" : "text-slate-400 font-extrabold"}">Stock:</span>
              <input type="number" onchange="smcUpdateStock('${m.medicineId}', this.value)" value="${m.stock}" min="0" class="w-10 text-center text-[10px] p-0.5 border border-slate-200 rounded font-black font-mono focus:border-indigo-500 outline-none bg-slate-50 text-slate-800">
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderSmcStoreOrders() {
  const container = document.getElementById("smc-orders-list");
  if (!container) return;

  const orders = smcOrders.filter((o) => o.storeId === smcSelectedStoreId);

  if (orders.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 bg-white border border-slate-100 rounded-xl text-slate-400 font-medium">
        No patient booking records found for this branch.
      </div>
    `;
    return;
  }

  const sorted = orders.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));

  container.innerHTML = sorted.map((o) => {
    let statusClass = "bg-slate-200 text-slate-800";
    if (o.status === "placed" || o.status === "new") statusClass = "bg-amber-100 text-amber-800 border-amber-305";
    else if (o.status === "accepted" || o.status === "accepted_by_store") statusClass = "bg-indigo-100 text-indigo-800 border-indigo-355";
    else if (o.status === "packed" || o.status === "in_transit") statusClass = "bg-teal-100 text-teal-800 border-teal-355";
    else if (o.status === "delivered") statusClass = "bg-emerald-100 text-emerald-800 border-emerald-355";
    else if (o.status === "rejected" || o.status === "cancelled") statusClass = "bg-rose-100 text-rose-800 border-rose-355";

    const labelStr = o.status ? o.status.toUpperCase() : "PLACED";

    return `
      <div class="bg-white p-3.5 border border-slate-100 rounded-xl shadow-xs text-xs font-semibold space-y-2.5">
        <div class="flex items-center justify-between border-b border-slate-50 pb-2">
          <div>
            <h5 class="text-slate-900 font-extrabold text-[11px]">Booking ID: #${o.orderId.substring(0, 8).toUpperCase()}</h5>
            <p class="text-[8px] text-slate-400 font-bold mt-0.5">${
              o.createdAt ? new Date(o.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "N/A"
            }</p>
          </div>
          <span class="px-2 py-0.5 rounded font-black text-[9px] uppercase border ${statusClass}">${labelStr}</span>
        </div>

        <div class="space-y-1">
          <p class="text-[8px] uppercase tracking-wider text-slate-400 font-black">Prescription Sets</p>
          <div class="text-[10px] text-slate-600 space-y-0.5">
            ${
              o.items ? o.items.map((it: any) => `
                <div class="flex justify-between font-medium">
                  <span>• ${it.name} <span class="font-bold text-slate-400">x${it.quantity}</span></span>
                  <span class="font-mono text-slate-500">₹${(it.price * it.quantity).toFixed(1)}</span>
                </div>
              `).join("") : "N/A"
            }
          </div>
        </div>

        <div class="flex justify-between items-center bg-slate-50 p-2 rounded-lg">
          <div class="text-[9px] font-bold text-slate-500 flex flex-col">
            <span>Patient: ${o.userName || "Subscriber Client"}</span>
            <span class="font-mono mt-0.5">Phone: ${o.userMobile || "N/A Line"}</span>
          </div>
          <div class="text-right">
            <p class="text-[8px] text-slate-400 uppercase font-black">Bill Sum</p>
            <p class="font-mono font-black text-indigo-705 text-indigo-700 text-xs">₹${o.total || o.subtotal || 0}</p>
          </div>
        </div>

        <button onclick="smcFocusDeliveryRoute('${o.orderId}')" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-705 text-[10px] uppercase font-black py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-slate-100">
          <i class="fa-solid fa-map-location-dot text-indigo-500 text-indigo-600"></i>
          <span>Locate & Track Delivery Route</span>
        </button>
      </div>
    `;
  }).join("");
}

function smcFocusDeliveryRoute(orderId: string) {
  const o = smcOrders.find((ord) => ord.orderId === orderId);
  if (!o) return;

  const store = smcStores.find((s) => s.storeId === smcSelectedStoreId);
  if (!store) return;

  showToast("Plotting operational route maps...", "info");

  const storeLat = store.location?.lat || 12.9716;
  const storeLng = store.location?.lng || 77.5946;

  const userLat = o.userLocation?.lat || o.location?.lat || 12.9716;
  const userLng = o.userLocation?.lng || o.location?.lng || 77.5946;

  if (o.deliveryId) {
    get(ref(db, `deliveryboy1/${o.deliveryId}`)).then((snapshot) => {
      let rLat = storeLat;
      let rLng = storeLng;
      if (snapshot.exists()) {
        const val = snapshot.val();
        rLat = val.location?.lat || storeLat;
        rLng = val.location?.lng || storeLng;
      }
      updateLeafletMap("smc-route-map", storeLat, storeLng, userLat, userLng, false, "marker-store", "fa-prescription-bottle-medical", "marker-user", "fa-house-chimney-medical", rLat, rLng, "marker-rider", "fa-motorcycle");
    });
  } else {
    updateLeafletMap("smc-route-map", storeLat, storeLng, userLat, userLng, false);
  }
}

function renderSmcStoreAnalytics() {
  const container = document.getElementById("smc-best-sellers-list");
  if (!container) return;

  const orders = smcOrders.filter((o) => o.storeId === smcSelectedStoreId);
  const compOrders = orders.filter((o) => o.status === "delivered");

  const records: any = {};
  compOrders.forEach((o) => {
    if (o.items) {
      o.items.forEach((it: any) => {
        if (!records[it.name]) {
          records[it.name] = { qty: 0, revenue: 0 };
        }
        records[it.name].qty += it.quantity;
        records[it.name].revenue += (it.price * it.quantity);
      });
    }
  });

  const bestSellers = Object.keys(records).map((k) => ({
    name: k,
    qty: records[k].qty,
    revenue: records[k].revenue
  })).sort((a,b) => b.qty - a.qty).slice(0, 5);

  if (bestSellers.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-center py-6 text-xs font-semibold">No completed orders yet.</div>`;
  } else {
    container.innerHTML = bestSellers.map((item, idx) => `
      <div class="flex items-center justify-between py-2.5 font-semibold text-xs text-slate-700">
        <div>
          <span class="text-indigo-600 font-extrabold mr-1.5 font-mono">#${idx+1}</span>
          <span>${item.name}</span>
        </div>
        <div class="text-right select-none">
          <p class="text-[9px] text-slate-500 font-bold">Sold: <span class="font-black text-slate-700">${item.qty} units</span></p>
          <p class="text-[10px] font-bold font-mono text-emerald-600">₹${item.revenue}</p>
        </div>
      </div>
    `).join("");
  }

  const perfContainer = document.getElementById("smc-rider-perf-list");
  if (perfContainer) {
    const ridersMap: any = {};
    orders.forEach((o) => {
      if (o.deliveryId && o.status === "delivered") {
        if (!ridersMap[o.deliveryId]) {
          ridersMap[o.deliveryId] = { name: o.deliveryName || "Express Courier Rider", count: 0 };
        }
        ridersMap[o.deliveryId].count++;
      }
    });

    const matchedRiders = Object.values(ridersMap).sort((a: any, b: any) => b.count - a.count);
    if (matchedRiders.length === 0) {
      perfContainer.innerHTML = `<div class="text-slate-400 text-center py-6 text-xs font-semibold">No delivery completed courier yet.</div>`;
    } else {
      perfContainer.innerHTML = matchedRiders.map((r: any) => `
        <div class="flex items-center justify-between p-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-semibold text-slate-700">
          <div class="flex items-center gap-1.5">
            <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span>${r.name}</span>
          </div>
          <span class="text-[9px] bg-slate-205 bg-slate-200 px-2 py-0.5 rounded font-black">${r.count} Dispatches</span>
        </div>
      `).join("");
    }
  }
}

function renderSmcStoreReviews() {
  const container = document.getElementById("smc-reviews-list");
  if (!container) return;

  const storeReviews = smcReviews[smcSelectedStoreId] ? Object.values(smcReviews[smcSelectedStoreId]) : [];
  const lblRev = document.getElementById("smc-lbl-review-cnt");
  if (lblRev) lblRev.innerText = `${storeReviews.length} Reviews synced`;

  if (storeReviews.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 bg-white border border-slate-100 rounded-xl text-slate-400 text-xs shadow-xs font-medium">
        No patient reviews logs recorded for this store branch.
      </div>
    `;
    return;
  }

  const sorted = storeReviews.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

  container.innerHTML = sorted.map((r: any) => {
    let starsHtml = "";
    for (let s = 1; s <= 5; s++) {
      starsHtml += `<i class="fa-solid fa-star ${s <= (r.rating || 5) ? "text-amber-400" : "text-slate-200"}"></i>`;
    }

    const reviewerName = r.reviewerName || "Patient Subscriber";
    const dateStr = r.timestamp 
      ? new Date(r.timestamp).toLocaleString("en-US", { month: "short", day: "numeric" })
      : "Clinical Feedback";

    return `
      <div class="bg-white p-3.5 border border-slate-100 rounded-xl shadow-xs space-y-2 text-xs font-semibold">
        <div class="flex justify-between items-center">
          <div class="flex flex-col gap-0.5">
            <span class="font-extrabold text-slate-800">${reviewerName}</span>
            <span class="text-[8px] text-slate-400 font-bold">${dateStr}</span>
          </div>
          <div class="flex gap-0.5 text-[9px]">
            ${starsHtml}
          </div>
        </div>
        <p class="text-[10px] text-slate-500 bg-slate-50 p-2.5 rounded-lg italic font-medium leading-relaxed">"${r.comment || 'No text review comments'}"</p>
      </div>
    `;
  }).join("");
}

function setupSmcCabinetTabListeners() {
  const tabs = {
    docs: { btn: "smc-tab-docs", view: "smc-view-docs" },
    inventory: { btn: "smc-tab-inventory", view: "smc-view-inventory" },
    orders: { btn: "smc-tab-orders", view: "smc-view-orders" },
    analytics: { btn: "smc-tab-analytics", view: "smc-view-analytics" },
    reviews: { btn: "smc-tab-reviews", view: "smc-view-reviews" }
  };

  Object.entries(tabs).forEach(([key, config]) => {
    const btnEl = document.getElementById(config.btn);
    btnEl?.addEventListener("click", () => {
      smcSelectedTab = key as any;
      
      Object.values(tabs).forEach((cfg) => {
        const b = document.getElementById(cfg.btn);
        if (b) {
          b.className = "flex-1 py-2.5 border-b-2 border-transparent text-slate-500 transition-all hover:text-indigo-600 cursor-pointer";
        }
        const v = document.getElementById(cfg.view);
        if (v) v.classList.add("hidden");
      });

      if (btnEl) {
        btnEl.className = "flex-1 py-2.5 border-b-2 border-indigo-600 text-indigo-600 transition-all cursor-pointer";
      }
      
      const targetView = document.getElementById(config.view);
      if (targetView) targetView.classList.remove("hidden");
    });
  });
}

function smcAdminAction(action: "approve" | "reject" | "toggle-active" | "delete") {
  if (!smcSelectedStoreId) return;
  const store = smcStores.find(s => s.storeId === smcSelectedStoreId);
  if (!store) return;

  if (action === "approve") {
    if (confirm(`Approve Drug License and authorize trading for ${store.name || "selected store"}?`)) {
      update(ref(db, `stores/${smcSelectedStoreId}`), { approved: true });
      update(ref(db, `users/${smcSelectedStoreId}`), { approved: true });
      showToast("Pharmacy node authorized & active globally!", "success");
    }
  } else if (action === "reject") {
    const reason = prompt("Enter drug regulatory non-compliance/rejection reasoning:")?.trim();
    if (reason === undefined) return;
    if (!reason) {
      showToast("Rejection reasoning is clinical mandate.", "error");
      return;
    }
    update(ref(db, `stores/${smcSelectedStoreId}`), { approved: false, rejectionReason: reason });
    update(ref(db, `users/${smcSelectedStoreId}`), { approved: false });
    showToast("Application rejected & feedback sent", "info");
  } else if (action === "toggle-active") {
    const isDeactivating = (store.active !== false);
    const nextStatus = !isDeactivating;
    const promptStr = isDeactivating
      ? "Deactivating this store suspends all user catalog bookings immediately. Confirm deactivation?"
      : "Reactivate this store branch for immediate patient listing?";

    if (confirm(promptStr)) {
      update(ref(db, `stores/${smcSelectedStoreId}`), { active: nextStatus });
      update(ref(db, `users/${smcSelectedStoreId}`), { active: nextStatus });
      showToast(isDeactivating ? "Pharmacy node suspended" : "Pharmacy node reactivated!", isDeactivating ? "info" : "success");
    }
  } else if (action === "delete") {
    if (confirm(`This is an IRREVERSIBLE operation! Delete ${store.name || "selected store"} permanently?`)) {
      remove(ref(db, `stores/${smcSelectedStoreId}`));
      remove(ref(db, `users/${smcSelectedStoreId}`));
      showToast("Pharmacy node purged from records", "error");
      smcClearSelection();
    }
  }
}

function smcClearSelection() {
  smcSelectedStoreId = "";
  const viewPort = document.getElementById("smc-cabinet-data-viewport");
  const emptyState = document.getElementById("smc-cabinet-empty-state");
  if (viewPort) viewPort.classList.add("hidden");
  if (emptyState) emptyState.classList.remove("hidden");
  renderSmcStoresTree();
}

function smcOpenOverrideModal() {
  if (!smcSelectedStoreId) return;
  const store = smcStores.find(s => s.storeId === smcSelectedStoreId);
  if (!store) return;

  (document.getElementById("smc-edt-name") as HTMLInputElement).value = store.name || "";
  (document.getElementById("smc-edt-owner") as HTMLInputElement).value = store.ownerName || "";
  (document.getElementById("smc-edt-mobile") as HTMLInputElement).value = store.mobile || "";
  (document.getElementById("smc-edt-license") as HTMLInputElement).value = store.licenseNumber || store.drugLicenseNumber || "";
  (document.getElementById("smc-edt-state") as HTMLSelectElement).value = store.state || "Karnataka";
  (document.getElementById("smc-edt-district") as HTMLInputElement).value = store.district || "";
  (document.getElementById("smc-edt-address") as HTMLTextAreaElement).value = store.address || "";

  const modalEl = document.getElementById("smc-edit-store-modal");
  if (modalEl) modalEl.classList.remove("hidden");
}

function closeSmcEditModal() {
  const modalEl = document.getElementById("smc-edit-store-modal");
  if (modalEl) modalEl.classList.add("hidden");
}

async function smcHandleProfileOverrideSubmit(e: any) {
  e.preventDefault();
  if (!smcSelectedStoreId) return;

  const name = (document.getElementById("smc-edt-name") as HTMLInputElement).value.trim();
  const ownerName = (document.getElementById("smc-edt-owner") as HTMLInputElement).value.trim();
  const mobile = (document.getElementById("smc-edt-mobile") as HTMLInputElement).value.trim();
  const licenseNumber = (document.getElementById("smc-edt-license") as HTMLInputElement).value.trim();
  const state = (document.getElementById("smc-edt-state") as HTMLSelectElement).value;
  const district = (document.getElementById("smc-edt-district") as HTMLInputElement).value.trim();
  const address = (document.getElementById("smc-edt-address") as HTMLTextAreaElement).value.trim();

  try {
    const store = smcStores.find(s => s.storeId === smcSelectedStoreId);
    const payload = {
      ...store,
      name,
      ownerName,
      mobile,
      licenseNumber,
      drugLicenseNumber: licenseNumber,
      state,
      district,
      address
    };

    await update(ref(db, `stores/${smcSelectedStoreId}`), payload);
    await update(ref(db, `users/${smcSelectedStoreId}`), {
      name,
      mobile,
      state,
      district,
      address
    });

    showToast("Pharmacy profile details successfully updated!", "success");
    closeSmcEditModal();
  } catch (err) {
    showToast("Failed overriding store parameters in DB", "error");
  }
}

// Window bindings helper
Object.assign(window, {
  smcSelectStore,
  closeSmcEditModal,
  smcFocusDeliveryRoute,
  smcDeleteMedicine(medId: string) {
    if (confirm("Clinical Mandate: Permanently remove this medicine on behalf of the store?")) {
      remove(ref(db, `medicines/${medId}`)).then(() => {
        showToast("Medicine cleared successfully", "info");
      });
    }
  },
  smcUpdatePrice(medId: string, valStr: string) {
    const nextP = parseFloat(valStr);
    if (isNaN(nextP) || nextP <= 0) {
      showToast("Invalid price format", "error");
      return;
    }
    update(ref(db, `medicines/${medId}`), { price: nextP }).then(() => {
      showToast("Store shelf price overrides synced in db!", "success");
    });
  },
  smcUpdateStock(medId: string, valStr: string) {
    const nextS = parseInt(valStr);
    if (isNaN(nextS) || nextS < 0) {
      showToast("Invalid stock volume", "error");
      return;
    }
    update(ref(db, `medicines/${medId}`), { stock: nextS }).then(() => {
      showToast("Store stock volume overrides synced in db!", "success");
    });
  }
});

// Advanced Administrative Systems & Hubs

function renderFilteredCustomers() {
  const query = userSearchQuery.trim().toLowerCase();
  const filtered = globalCustomers.filter((c) => {
    if (!query) return true;
    return (
      (c.name || "").toLowerCase().includes(query) ||
      (c.email || "").toLowerCase().includes(query) ||
      (c.mobile || "").toLowerCase().includes(query)
    );
  });
  renderCustomersTable(filtered);
}

function inspectPatientDossier(uid: string) {
  const customer = globalCustomers.find((c) => c.uid === uid);
  if (!customer) {
    showToast("Selected patient dossier could not be compiled.", "error");
    return;
  }

  // Populate basic text info
  const nameEl = document.getElementById("usr-inspect-name");
  if (nameEl) nameEl.innerText = customer.name || "N/A";
  const emailEl = document.getElementById("usr-inspect-email");
  if (emailEl) emailEl.innerText = customer.email || "N/A";
  const phoneEl = document.getElementById("usr-inspect-phone");
  if (phoneEl) phoneEl.innerText = customer.mobile || "No phone linked";

  const initialsEl = document.getElementById("usr-inspect-initials");
  if (initialsEl) {
    initialsEl.innerText = (customer.name || "PT").slice(0, 2).toUpperCase();
  }

  const statusBadge = document.getElementById("usr-inspect-status-badge");
  if (statusBadge) {
    statusBadge.innerText = customer.isBlocked ? "SUSPENDED ACCOUNT" : "ACTIVE ACCESS VALID";
    statusBadge.className = `px-2 py-0.5 rounded-md ${customer.isBlocked ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`;
  }

  // Bind footer buttons dynamically
  const blockBtn = document.getElementById("usr-inspect-btn-block");
  if (blockBtn) {
    blockBtn.innerText = customer.isBlocked ? "Unblock Patient" : "Block Patient";
    blockBtn.onclick = () => {
      (window as any).toggleBlockCustomer(customer.uid, customer.isBlocked || false);
      closeUserDetailsInspectModal();
    };
  }

  const deleteBtn = document.getElementById("usr-inspect-btn-delete");
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      if (confirm(`Clinical and Administrative Mandate: Purge patient folder and account registration of ${customer.name}? This is permanent.`)) {
        remove(ref(db, `users/${customer.uid}`)).then(() => {
          showToast("Patient record completely purged from records", "info");
          closeUserDetailsInspectModal();
        });
      }
    };
  }

  // Load and display addresses
  const addrGrid = document.getElementById("usr-inspect-addresses-grid");
  if (addrGrid) {
    addrGrid.innerHTML = `<p class="text-slate-400 text-xs italic py-2">Loading addresses...</p>`;
    get(ref(db, `users/${uid}/addresses`)).then((snapshot) => {
      if (snapshot.exists()) {
        const addresses = Object.values(snapshot.val());
        if (addresses.length > 0) {
          addrGrid.innerHTML = addresses.map((a: any) => `
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
              <span class="px-1.5 py-0.5 bg-violet-50 text-violet-750 font-black text-[9px] rounded uppercase">${a.label || "Home/Other"}</span>
              <p class="font-semibold text-slate-800 leading-tight">${a.address || "No address detail"}</p>
              <p class="text-[9px] text-slate-400 font-mono">${a.city || "Bengaluru"}, ${a.state || "Karnataka"}</p>
            </div>
          `).join("");
        } else {
          addrGrid.innerHTML = `<p class="text-slate-400 text-xs italic py-2">No saved locations linked.</p>`;
        }
      } else {
        addrGrid.innerHTML = `<p class="text-slate-400 text-xs italic py-2">No saved locations linked.</p>`;
      }
    }).catch(() => {
      addrGrid.innerHTML = `<p class="text-rose-500 text-xs py-2">Failed gathering coordinate logs.</p>`;
    });
  }

  // Load and display patient orders from ordersCache
  const ordersTbody = document.getElementById("usr-inspect-orders-tbody");
  if (ordersTbody) {
    const userOrders = (ordersCache || []).filter((o: any) => o.userId === uid);
    if (userOrders.length > 0) {
      ordersTbody.innerHTML = userOrders.map((o: any) => {
        const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "Internal Node";
        const itemCount = o.items ? o.items.length : 0;
        return `
          <tr class="hover:bg-slate-50 transition-all font-semibold select-none">
            <td class="p-2.5 font-mono text-slate-500 max-w-[80px] truncate">${o.orderId}</td>
            <td class="p-2.5 text-slate-605">${dateStr}</td>
            <td class="p-2.5 text-slate-700">${itemCount} drugs</td>
            <td class="p-2.5 text-right font-mono font-bold text-slate-900">₹${o.total || 0}</td>
            <td class="p-2.5 text-right">
              <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded ${o.status === "delivered" ? "bg-emerald-100 text-emerald-800" : o.status === "cancelled" ? "bg-rose-100 text-rose-800" : "bg-blue-100 text-blue-800"}">
                ${o.status || "Pending"}
              </span>
            </td>
          </tr>
        `;
      }).join("");
    } else {
      ordersTbody.innerHTML = `
        <tr>
          <td colspan="5" class="p-4 text-center text-slate-400 font-medium">No medical order records synced.</td>
        </tr>
      `;
    }
  }

  // 1. Load active Family health profiles
  const familyGrid = document.getElementById("usr-inspect-family-grid");
  if (familyGrid) {
    familyGrid.innerHTML = `<p class="text-slate-400 text-xs italic py-1 col-span-2">Loading family roster...</p>`;
    get(ref(db, `users/${uid}/familyProfiles`)).then((snap) => {
      if (snap.exists()) {
        const roster = Object.values(snap.val() || {});
        if (roster.length > 0) {
          familyGrid.innerHTML = roster.map((mem: any) => `
            <div class="bg-indigo-50/50 p-3 rounded-xl border border-indigo-150 relative space-y-1">
              <span class="absolute top-2 right-2 px-1.5 py-0.2 bg-indigo-100 text-indigo-800 text-[8px] font-black rounded uppercase">${mem.relation || "Family"}</span>
              <h5 class="text-xs font-black text-indigo-950">${mem.name || "Unnamed"}</h5>
              <p class="text-[9.5px] text-slate-500 font-medium">Age: <span class="font-bold text-slate-700">${mem.age || "N/A"}</span> | Gen: <span class="font-bold text-slate-700">${mem.gender || "N/A"}</span> | Blood: <span class="font-bold font-mono text-indigo-700">${mem.bloodGroup || "O+"}</span></p>
              ${mem.allergies ? `<p class="text-[9px] text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded">Allergies: ${mem.allergies}</p>` : ""}
              ${mem.chronic ? `<p class="text-[9px] text-slate-600 font-medium bg-slate-100 px-1.5 py-0.5 rounded">Chronic: ${mem.chronic}</p>` : ""}
            </div>
          `).join("");
        } else {
          familyGrid.innerHTML = `<p class="text-slate-400 text-xs italic py-1 col-span-2">No linked family profiles synced with this dossier.</p>`;
        }
      } else {
        familyGrid.innerHTML = `<p class="text-slate-400 text-xs italic py-1 col-span-2">No linked family profiles synced with this dossier.</p>`;
      }
    }).catch(() => {
      familyGrid.innerHTML = `<p class="text-rose-500 text-xs italic py-1 col-span-2">Roster retrieval failed.</p>`;
    });
  }

  // 2. Load active recurring medicine subscriptions
  const subList = document.getElementById("usr-inspect-subscriptions-list");
  if (subList) {
    subList.innerHTML = `<p class="text-slate-400 text-xs italic py-1">Loading subscription records...</p>`;
    get(ref(db, `users/${uid}/subscriptions`)).then((snap) => {
      if (snap.exists()) {
        const subs = Object.values(snap.val() || {});
        if (subs.length > 0) {
          subList.innerHTML = subs.map((sub: any) => {
            const nextDelivery = sub.nextDeliveryDate ? new Date(sub.nextDeliveryDate).toLocaleDateString() : "Pending Scheduling";
            return `
              <div class="bg-emerald-50/40 p-3 rounded-xl border border-emerald-150 flex items-center justify-between font-semibold flex-wrap gap-2">
                <div class="space-y-1">
                  <h5 class="text-xs font-black text-emerald-900">${sub.medicineName || "Prescription Refill Cycle"}</h5>
                  <p class="text-[9.5px] text-slate-500">Frequency: <span class="text-emerald-700 font-bold uppercase">${sub.frequency || "Monthly"}</span> | Quantity: <span class="font-bold text-slate-700">${sub.quantity || 1} packs</span></p>
                  <p class="text-[9px] text-slate-400 font-mono">Next Automatic Dispatch: ${nextDelivery}</p>
                </div>
                <div class="text-right">
                  <span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[8px] font-black rounded uppercase">Active Refill Plan</span>
                </div>
              </div>
            `;
          }).join("");
        } else {
          subList.innerHTML = `<p class="text-slate-400 text-xs italic py-1">No chronic or periodic medicine refill subscriptions active.</p>`;
        }
      } else {
        subList.innerHTML = `<p class="text-slate-400 text-xs italic py-1">No chronic or periodic medicine refill subscriptions active.</p>`;
      }
    }).catch(() => {
      subList.innerHTML = `<p class="text-rose-500 text-xs italic py-1">Subscription retrieval failed.</p>`;
    });
  }

  // 3. Load Prescription Vault files & health documents
  const recordsGrid = document.getElementById("usr-inspect-records-grid");
  if (recordsGrid) {
    recordsGrid.innerHTML = `<p class="text-slate-400 text-xs italic py-1">Retrieving health records storage...</p>`;
    // Fetch from both nodes and combine
    Promise.all([
      get(ref(db, `users/${uid}/prescriptionVault`)),
      get(ref(db, `users/${uid}/healthRecords`))
    ]).then(([vaultSnap, healthSnap]) => {
      let combined: any[] = [];
      if (vaultSnap.exists()) {
        const arr = Object.values(vaultSnap.val() || {});
        arr.forEach((item: any) => {
          combined.push({ ...item, recordType: "Prescription Sync" });
        });
      }
      if (healthSnap.exists()) {
        const arr = Object.values(healthSnap.val() || {});
        arr.forEach((item: any) => {
          combined.push({ ...item, recordType: item.category || "Clinical Record" });
        });
      }

      if (combined.length > 0) {
        recordsGrid.innerHTML = combined.map((file: any) => {
          const uploadeDate = file.createdAt || file.uploadedAt ? new Date(file.createdAt || file.uploadedAt).toLocaleDateString() : "N/A";
          const fileLocUrl = file.url || file.cloudinaryUrl || file.fileUrl || "";
          return `
            <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center justify-between gap-3 text-xs">
              <div class="flex items-center gap-2 min-w-0">
                <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <i class="fa-solid fa-file-pdf text-sm"></i>
                </div>
                <div class="min-w-0">
                  <h5 class="font-bold text-slate-800 truncate">${file.title || file.fileName || "Medical File Block"}</h5>
                  <div class="text-[9px] text-slate-400 font-semibold font-mono uppercase mt-0.5">Type: ${file.recordType} | Date: ${uploadeDate}</div>
                </div>
              </div>
              <div class="shrink-0 flex items-center gap-1.5 font-bold">
                ${fileLocUrl ? `
                  <a href="${fileLocUrl}" target="_blank" referrerPolicy="no-referrer" class="px-2.5 py-1 text-[8px] tracking-wide uppercase font-black bg-indigo-600 text-white hover:bg-indigo-700 rounded-md transition-all flex items-center gap-1">
                    <i class="fa-solid fa-eye"></i> View File
                  </a>
                ` : `<span class="text-[8px] text-slate-400 uppercase font-bold bg-slate-100 px-1.5 py-0.5 rounded">Offline Doc</span>`}
              </div>
            </div>
          `;
        }).join("");
      } else {
        recordsGrid.innerHTML = `<p class="text-slate-400 text-xs italic py-1">No uploaded files in vault (Prescriptions / Reports / Vaccine logs).</p>`;
      }
    }).catch((e) => {
      console.error(e);
      recordsGrid.innerHTML = `<p class="text-rose-500 text-xs py-1">Clinics archives fetch failed.</p>`;
    });
  }

  // 4. Load Loyalty and Referral milestones
  const loyaltyContainer = document.getElementById("usr-inspect-loyalty-container");
  if (loyaltyContainer) {
    loyaltyContainer.innerHTML = `<p class="text-slate-400 text-[10px] italic">Loading loyalty history...</p>`;
    get(ref(db, `users/${uid}`)).then((userSnap) => {
      if (userSnap.exists()) {
        const patient = userSnap.val();
        const coins = patient.coins !== undefined ? patient.coins : 250;
        const refCode = patient.referralCode || `${(patient.name || "USER").substring(0, 4).toUpperCase()}${uid.substring(0, 4).toUpperCase()}`;
        const refCount = patient.referralCount || 0;
        const refEarnings = patient.referralEarnings || 0;
        
        let tier = "Silver Wellness Member";
        let tierColor = "text-slate-500 bg-slate-100 border-slate-200";
        if (coins >= 1000) {
          tier = "Platinum Elite Care";
          tierColor = "text-violet-750 bg-violet-100/60 border-violet-200 text-violet-700";
        } else if (coins >= 500) {
          tier = "Gold Premium Care";
          tierColor = "text-yellow-750 bg-yellow-100/60 border-yellow-250 text-amber-700 border-amber-200";
        }

        loyaltyContainer.innerHTML = `
          <div class="grid grid-cols-2 gap-3 text-xs font-semibold">
            <div class="bg-white p-2.5 rounded-lg border border-slate-100">
              <span class="text-[10px] text-slate-400 uppercase">Meds Coins Balance</span>
              <p class="text-emerald-700 font-extrabold text-sm font-sans mt-0.5">${coins} <span class="text-[8px] uppercase text-slate-400 font-bold">Coins</span></p>
            </div>
            <div class="bg-white p-2.5 rounded-lg border border-slate-100 select-all font-mono">
              <span class="text-[10px] text-slate-400 uppercase font-sans">Referral Code</span>
              <p class="text-indigo-600 font-bold text-xs mt-0.5">${refCode}</p>
            </div>
            <div class="col-span-2 flex items-center justify-between pt-1 border-t border-slate-100/50">
              <span class="text-slate-400 text-[9.5px]">Loyalty Tier Status:</span>
              <span class="px-2 py-0.5 rounded font-black uppercase text-[8px] tracking-wide border ${tierColor}">${tier}</span>
            </div>
            <div class="col-span-2 flex items-center justify-between text-[9px] text-slate-400">
              <span>Roster Invitations: <strong>${refCount} users</strong></span>
              <span>Referral Cashbacks: <strong class="text-emerald-600">₹${refEarnings}</strong></span>
            </div>
          </div>
        `;
      } else {
        loyaltyContainer.innerHTML = `<p class="text-slate-400 text-xs italic py-1">Loyalty data error.</p>`;
      }
    }).catch(() => {
      loyaltyContainer.innerHTML = `<p class="text-rose-500 text-xs py-1">Loyalty retrieval failed.</p>`;
    });
  }

  // Unhide modal
  const modal = document.getElementById("user-details-inspect-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeUserDetailsInspectModal() {
  const modal = document.getElementById("user-details-inspect-modal");
  if (modal) modal.classList.add("hidden");
}

function initNotificationsCenter() {
  const notifForm = document.getElementById("form-broadcast-panel");
  if (notifForm) {
    notifForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const category = (document.getElementById("notif-category") as HTMLSelectElement).value;
      const audience = (document.getElementById("notif-audience") as HTMLSelectElement).value;
      const title = (document.getElementById("notif-title") as HTMLInputElement).value.trim();
      const message = (document.getElementById("notif-message") as HTMLTextAreaElement).value.trim();

      const notifId = "NOTIF_" + Date.now();
      const newNotif = {
        notifId,
        category,
        audience,
        title,
        message,
        timestamp: Date.now()
      };

      set(ref(db, `notifications/${notifId}`), newNotif)
        .then(() => {
          showToast("Network dispatch transmitted successfully!", "success");
          (notifForm as HTMLFormElement).reset();
        })
        .catch(() => {
          showToast("Failed to broadcast alert.", "error");
        });
    });
  }

  // Subscribe to real-time notifications
  onValue(ref(db, "notifications"), (snapshot) => {
    const container = document.getElementById("notif-logs-container");
    if (!container) return;

    if (!snapshot.exists()) {
      container.innerHTML = `<p class="text-xs text-slate-400 text-center py-12 font-semibold">No notifications found in network database.</p>`;
      const badge = document.getElementById("notif-count-badge");
      if (badge) badge.innerText = "0 Bulletins";
      return;
    }

    const items: any[] = [];
    snapshot.forEach((child) => {
      items.push(child.val());
    });

    notificationsCache = items.sort((a, b) => b.timestamp - a.timestamp);

    const badge = document.getElementById("notif-count-badge");
    if (badge) badge.innerText = `${notificationsCache.length} Bulletins`;

    container.innerHTML = notificationsCache.map((n) => {
      const dateStr = new Date(n.timestamp).toLocaleString();
      let catColor = "bg-teal-50 text-teal-800 border-teal-100";
      if (n.category === "PROMOTIONAL") catColor = "bg-violet-50 text-violet-800 border-violet-100";
      if (n.category === "MAINTENANCE") catColor = "bg-rose-50 text-rose-800 border-rose-100";

      return `
        <div class="py-3 flex items-start gap-4 text-xs font-semibold leading-relaxed border-b border-slate-50 last:border-none">
          <div class="p-2 rounded-xl bg-slate-50 border shrink-0 text-slate-400 select-none">
            <i class="fa-solid ${n.category === 'MAINTENANCE' ? 'fa-triangle-exclamation text-rose-500' : 'fa-bullhorn text-teal-500'}"></i>
          </div>
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-extrabold text-slate-805 text-slate-900 truncate pr-2">${n.title}</span>
              <span class="text-[9px] font-mono text-slate-400 select-none font-bold">${dateStr}</span>
            </div>
            <p class="text-slate-500 font-medium leading-relaxed font-sans text-[11px]">${n.message}</p>
            <div class="flex items-center gap-1.5 select-none font-bold text-[9px] pt-1.5">
              <span class="px-2 py-0.5 border rounded-md uppercase ${catColor}">${n.category}</span>
              <span class="px-2 py-0.5 border border-slate-100 bg-slate-50 text-slate-500 rounded-md uppercase">${n.audience} Group</span>
              <button onclick="deleteNotification('${n.notifId}')" class="text-rose-500 hover:scale-105 transition-all ml-auto font-black cursor-pointer bg-transparent border-none">
                Delete Archive
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  });
}

function deleteNotification(id: string) {
  if (confirm("Delete this notification record from history?")) {
    remove(ref(db, `notifications/${id}`)).then(() => {
      showToast("Notification archived cleared", "info");
    });
  }
}

function initReviewsComplaintsHub() {
  const starBtns = document.querySelectorAll(".review-stars-btn");
  starBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      starBtns.forEach((b) => b.classList.remove("active", "bg-slate-900", "text-white"));
      const button = e.currentTarget as HTMLButtonElement;
      button.classList.add("active", "bg-slate-900", "text-white");
      activeReviewsStarFilter = button.getAttribute("data-stars") || "all";
      renderGlobalReviews();
    });
  });

  const searchInp = document.getElementById("reviews-search-input");
  if (searchInp) {
    searchInp.addEventListener("input", (e) => {
      reviewsSearchQuery = (e.target as HTMLInputElement).value;
      renderGlobalReviews();
    });
  }

  // Tab switching
  const tabReviews = document.getElementById("tab-btn-reviews");
  const tabComplaints = document.getElementById("tab-btn-complaints");
  const subviewReviews = document.getElementById("subview-reviews-container");
  const subviewComplaints = document.getElementById("subview-complaints-container");

  if (tabReviews && tabComplaints && subviewReviews && subviewComplaints) {
    tabReviews.addEventListener("click", () => {
      tabReviews.className = "px-3.5 py-1.5 rounded-lg text-xs font-bold bg-white text-indigo-700 shadow-sm cursor-pointer transition-all";
      tabComplaints.className = "px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer transition-all";
      subviewReviews.classList.remove("hidden");
      subviewComplaints.classList.add("hidden");
    });

    tabComplaints.addEventListener("click", () => {
      tabComplaints.className = "px-3.5 py-1.5 rounded-lg text-xs font-bold bg-white text-indigo-700 shadow-sm cursor-pointer transition-all";
      tabReviews.className = "px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer transition-all";
      subviewComplaints.classList.remove("hidden");
      subviewReviews.classList.add("hidden");
    });
  }

  // Subscribe to reviews
  onValue(ref(db, "reviews"), (snapshot) => {
    globalReviewsCache = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const storeId = child.key;
        if (storeId) {
          child.forEach((reviewChild) => {
            const rev = reviewChild.val();
            if (rev) {
              rev.storeId = storeId;
              rev.reviewId = reviewChild.key;
              globalReviewsCache.push(rev);
            }
          });
        }
      });
    }
    renderGlobalReviews();
  });

  // Subscribe to user complaints
  onValue(ref(db, "complaints"), (snapshot) => {
     complaintsCache = [];
     if (snapshot.exists()) {
       snapshot.forEach((child) => {
         const comp = child.val();
         if (comp) {
           comp.complaintId = child.key;
           complaintsCache.push(comp);
         }
       });
     }
     renderComplaintsTable();
  });
}

function renderGlobalReviews() {
  const container = document.getElementById("reviews-global-card-grid");
  if (!container) return;

  const query = reviewsSearchQuery.trim().toLowerCase();
  const filtered = globalReviewsCache.filter((r) => {
    if (activeReviewsStarFilter !== "all") {
      const limit = parseInt(activeReviewsStarFilter);
      if (r.rating !== limit) return false;
    }
    if (query) {
      const matchText = `${r.comment} ${r.patientName} ${r.medicineName || ""}`.toLowerCase();
      if (!matchText.includes(query)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center py-16 col-span-full">No matching customer reviews logs synced.</p>`;
    return;
  }

  container.innerHTML = filtered.map((r) => {
    const starsStr = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
    const dateStr = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : "Historical Log";
    return `
      <div class="bg-white p-4 border rounded-2xl shadow-xs space-y-3 relative hover:shadow-sm transition-all text-xs font-semibold">
        <div class="flex items-center justify-between">
          <span class="text-amber-500 font-bold select-none">${starsStr}</span>
          <span class="text-[9px] font-mono font-bold text-slate-400">${dateStr}</span>
        </div>
        <p class="text-slate-700 leading-relaxed font-sans font-medium text-[11px]">"${r.comment || "No comment left"}"</p>
        <div class="flex items-center justify-between border-t border-slate-50 pt-2 text-[10px] select-none font-bold">
          <span class="text-slate-600 truncate max-w-[125px]"><i class="fa-solid fa-circle-user mr-1 text-slate-400 animate-pulse"></i>${r.patientName || "Anonymous Patient"}</span>
          <button onclick="dismissReview('${r.storeId}', '${r.reviewId}')" class="text-rose-500 hover:scale-105 transition-all cursor-pointer bg-transparent border-none">
            <i class="fa-regular fa-trash-can mr-1"></i>Dismiss
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function dismissReview(storeId: string, revId: string) {
  if (confirm("Clinical Mandate: Permanently exclude this patient review comment from store feedback metrics?")) {
    remove(ref(db, `reviews/${storeId}/${revId}`)).then(() => {
      showToast("Review reference suppressed", "info");
    });
  }
}

function renderComplaintsTable() {
  const tbody = document.getElementById("tbody-complaints-registry");
  const countBadge = document.getElementById("complaints-badge-count");
  if (!tbody) return;

  const openTickets = complaintsCache.filter((c) => !c.resolved);
  if (countBadge) countBadge.innerText = `${openTickets.length} Open Tickets`;

  if (complaintsCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-12 text-center text-slate-400 font-medium">No customer dispute folders active.</td></tr>`;
    return;
  }

  tbody.innerHTML = complaintsCache.map((c) => {
    const dateStr = c.timestamp ? new Date(c.timestamp).toLocaleDateString() : "Today";
    return `
      <tr class="hover:bg-slate-50/50 transition-all text-xs font-semibold border-b border-slate-100 last:border-none">
        <td class="px-5 py-4">
          <p class="font-bold text-slate-900">${c.name || "Customer Ticket"}</p>
          <p class="text-[10px] font-mono text-slate-400 font-bold break-all">${c.email || "support@rsmedshub.com"}</p>
        </td>
        <td class="px-5 py-4 font-mono text-slate-500 font-bold max-w-[110px] truncate">${c.orderId || "N/A"}</td>
        <td class="px-5 py-4">
          <p class="font-extrabold text-slate-800 leading-tight">${c.subject || "Dispute"}</p>
          <p class="text-slate-500 mt-1 max-w-sm font-medium leading-relaxed font-sans text-[11px]">${c.description || "No dispute details filled"}</p>
        </td>
        <td class="px-5 py-4 font-semibold text-slate-600 select-none">${dateStr}</td>
        <td class="px-5 py-4 select-none">
          <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded ${c.resolved ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}">
            ${c.resolved ? "Closed & Cleared" : "Open Dispute"}
          </span>
        </td>
        <td class="px-5 py-4 text-right space-x-1">
          ${!c.resolved ? `
            <button onclick="resolveComplaint('${c.complaintId}')" class="text-[10px] font-black px-2.5 py-1 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 cursor-pointer border-none shadow-sm shadow-emerald-150">
              Resolve
            </button>
          ` : ""}
          <button onclick="deleteComplaint('${c.complaintId}')" class="text-[10px] font-bold px-2.5 py-1 bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
            Purge Folder
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function resolveComplaint(id: string) {
  update(ref(db, `complaints/${id}`), { resolved: true }).then(() => {
    showToast("Complaint resolved & closed", "success");
  });
}

function deleteComplaint(id: string) {
  if (confirm("Delete this complaint log permanently from records?")) {
    remove(ref(db, `complaints/${id}`)).then(() => {
      showToast("Complaint archived purged", "info");
    });
  }
}

function initCloudinaryMediaHub() {
  const fileInp = document.getElementById("cld-hub-file") as HTMLInputElement;
  const progressBlock = document.getElementById("cld-hub-progress-block");
  const progressBar = document.getElementById("cld-hub-progress-bar");
  const successBlock = document.getElementById("cld-hub-success-block");
  const successUrl = document.getElementById("cld-hub-success-url");

  if (fileInp) {
    fileInp.addEventListener("change", async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (progressBlock) progressBlock.classList.remove("hidden");
      if (successBlock) successBlock.classList.add("hidden");
      if (progressBar) progressBar.style.width = "40%";

      try {
        const url = await uploadToCloudinary(file);
        if (progressBar) progressBar.style.width = "100%";
        setTimeout(() => {
          if (progressBlock) progressBlock.classList.add("hidden");
          if (successBlock) successBlock.classList.remove("hidden");
          if (successUrl) successUrl.innerText = url;
          // Clear file input value
          fileInp.value = "";
          showToast("Media assets securely injected into Cloudinary!", "success");
        }, 500);
      } catch (err) {
        if (progressBlock) progressBlock.classList.add("hidden");
        showToast("Asset upload failed.", "error");
      }
    });
  }

  // Real-time aggregate subscription
  const aggregateAllMediaAssets = () => {
    // 1. Marketing Banners
    onValue(ref(db, "banners"), (snapshot) => {
      const assets: any[] = [];
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const val = child.val();
          if (val && val.url) {
            assets.push({ id: child.key, label: "Marketing Banner Asset", url: val.url, category: "BANNER" });
          }
        });
      }

      // 2. Rider verification paperwork
      onValue(ref(db, "deliveryboy1"), (riderSnap) => {
        if (riderSnap.exists()) {
          riderSnap.forEach((child) => {
            const r = child.val();
            if (r) {
              if (r.aadhaarFrontUrl) assets.push({ id: `${child.key}_aadhaar_f`, label: `${r.name || "Rider"} Aadhaar Front`, url: r.aadhaarFrontUrl, category: "RIDER_DOC" });
              if (r.aadhaarBackUrl) assets.push({ id: `${child.key}_aadhaar_b`, label: `${r.name || "Rider"} Aadhaar Back`, url: r.aadhaarBackUrl, category: "RIDER_DOC" });
              if (r.dlUrl) assets.push({ id: `${child.key}_dl`, label: `${r.name || "Rider"} Driving License`, url: r.dlUrl, category: "RIDER_DOC" });
              if (r.qrCodeUrl) assets.push({ id: `${child.key}_qr`, label: `${r.name || "Rider"} QR Payment Code`, url: r.qrCodeUrl, category: "FINANCE" });
            }
          });
        }

        // 3. Store licenses
        onValue(ref(db, "stores"), (storeSnap) => {
          if (storeSnap.exists()) {
            storeSnap.forEach((child) => {
              const s = child.val();
              if (s) {
                if (s.imageUrl) assets.push({ id: `${child.key}_avatar`, label: `${s.name || "Store"} Branch Image`, url: s.imageUrl, category: "STORE_LOGO" });
                if (s.licenseImageUrl) assets.push({ id: `${child.key}_license`, label: `${s.name || "Store"} Drug License Copy`, url: s.licenseImageUrl, category: "STORE_LICENSE" });
              }
            });
          }

          mediaAssetsCache = assets;
          renderCloudinaryAssets();
        });
      });
    });
  };

  aggregateAllMediaAssets();
}

function renderCloudinaryAssets() {
  const container = document.getElementById("cld-assets-grid");
  const badge = document.getElementById("cld-assets-count-badge");
  if (!container) return;

  if (badge) badge.innerText = `${mediaAssetsCache.length} Assets`;

  if (mediaAssetsCache.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center py-16 col-span-full">Synthesizing document database file streams...</p>`;
    return;
  }

  container.innerHTML = mediaAssetsCache.map((a) => {
    return `
      <div class="bg-slate-50 p-2 border border-slate-150 rounded-xl flex flex-col space-y-2 select-none">
        <div class="relative w-full h-24 rounded-lg overflow-hidden border border-slate-100 bg-white/50">
          <img src="${a.url}" referrerPolicy="no-referrer" class="w-full h-full object-cover">
          <span class="absolute top-1 left-1 px-1.5 py-0.5 bg-slate-900/85 text-white text-[8px] font-black tracking-wide rounded select-none uppercase">
            ${a.category}
          </span>
        </div>
        <div class="space-y-1 text-[10px] font-bold">
          <p class="text-slate-800 leading-tight truncate" title="${a.label}">${a.label}</p>
          <a href="${a.url}" target="_blank" class="text-indigo-500 hover:underline block text-[9px] truncate">${a.url}</a>
        </div>
      </div>
    `;
  }).join("");
}

function initPlatformSettings() {
  onValue(ref(db, "platform_settings"), (snapshot) => {
    if (snapshot.exists()) {
      const s = snapshot.val();
      const nInp = document.getElementById("set-app-name") as HTMLInputElement;
      if (nInp) nInp.value = s.appName || "RS Meds Hub Medicine Delivery Network";

      const eInp = document.getElementById("set-email") as HTMLInputElement;
      if (eInp) eInp.value = s.supportEmail || "support@rsmedshub.com";

      const pInp = document.getElementById("set-phone") as HTMLInputElement;
      if (pInp) pInp.value = s.supportPhone || "+91-9988776655";

      const lInp = document.getElementById("set-logo") as HTMLInputElement;
      if (lInp) lInp.value = s.brandLogoUrl || "";

      const tTxt = document.getElementById("set-terms") as HTMLTextAreaElement;
      if (tTxt) tTxt.value = s.clinicalTerms || "";

      const prTxt = document.getElementById("set-privacy") as HTMLTextAreaElement;
      if (prTxt) prTxt.value = s.privacyPolicy || "";

      const autoTgl = document.getElementById("set-autosafeguard-toggle") as HTMLInputElement;
      if (autoTgl) {
        autoTgl.checked = s.inactivityEnabled || false;
        inactivityEnabled = s.inactivityEnabled || false;
      }

      const autoLim = document.getElementById("set-autosafeguard-limit") as HTMLSelectElement;
      if (autoLim) {
        autoLim.value = s.inactivityLimitSeconds?.toString() || "300";
        inactivityLimitSeconds = s.inactivityLimitSeconds || 305;
      }

      const rInp = document.getElementById("set-delivery-radius") as HTMLInputElement;
      if (rInp) {
        rInp.value = s.deliveryRadius?.toString() || "10";
      }
    }
  });

  const saveSettings = () => {
    const appName = (document.getElementById("set-app-name") as HTMLInputElement).value.trim();
    const supportEmail = (document.getElementById("set-email") as HTMLInputElement).value.trim();
    const supportPhone = (document.getElementById("set-phone") as HTMLInputElement).value.trim();
    const brandLogoUrl = (document.getElementById("set-logo") as HTMLInputElement).value.trim();
    const clinicalTerms = (document.getElementById("set-terms") as HTMLTextAreaElement).value.trim();
    const privacyPolicy = (document.getElementById("set-privacy") as HTMLTextAreaElement).value.trim();
    const activeToggle = (document.getElementById("set-autosafeguard-toggle") as HTMLInputElement).checked;
    const limitSec = parseInt((document.getElementById("set-autosafeguard-limit") as HTMLSelectElement).value);
    const deliveryRadius = parseFloat((document.getElementById("set-delivery-radius") as HTMLInputElement).value) || 10;

    const payload = {
      appName,
      supportEmail,
      supportPhone,
      brandLogoUrl,
      clinicalTerms,
      privacyPolicy,
      inactivityEnabled: activeToggle,
      inactivityLimitSeconds: limitSec,
      deliveryRadius
    };

    set(ref(db, "platform_settings"), payload).then(() => {
      showToast("Platform custom constraints updated safely inside DB!", "success");
    }).catch(() => {
      showToast("Identity sync failed", "error");
    });
  };

  const saveBtn = document.getElementById("btn-save-settings-top");
  if (saveBtn) saveBtn.addEventListener("click", () => saveSettings());

  const settingsForm = document.getElementById("form-platform-settings");
  if (settingsForm) {
    settingsForm.addEventListener("submit", (e) => {
      e.preventDefault();
      saveSettings();
    });
  }

  const logoFileInp = document.getElementById("set-logo-file");
  if (logoFileInp) {
    logoFileInp.addEventListener("change", async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      showToast("Inoculating brand asset...", "info");
      try {
        const url = await uploadToCloudinary(file);
        const lInp = document.getElementById("set-logo") as HTMLInputElement;
        if (lInp) lInp.value = url;
        showToast("Brand logo updated!", "success");
      } catch (err) {
        showToast("Logo injection aborted", "error");
      }
    });
  }

  const checkActivity = () => {
    if (!inactivityEnabled) return;
    const idleSeconds = Math.floor((Date.now() - lastUserActivityTime) / 1000);
    if (idleSeconds >= inactivityLimitSeconds) {
       showToast("Guard Triggered: Admin idle for security threshold.", "error");
       signOut(auth).then(() => {
         window.location.reload();
       });
    }
  };

  setInterval(checkActivity, 5000);

  ["click", "mousemove", "keypress", "scroll", "touchstart"].forEach((evt) => {
    window.addEventListener(evt, () => {
      lastUserActivityTime = Date.now();
    });
  });
}

// =================================== Realtime Logistics Dispatch Tracker Center ===================================
let logisticsMapInstance: any = null;
let logisticsOverlays: any[] = [];
let logisticsFilterTab = "all"; // "all", "stores", "riders", "active-deliveries"
let logisticsSearch = "";
let logisticsStateFilter = "All";
let logisticsDistrictFilter = "All";
let selectedActiveLiveRoute: any = null;
let logisticsMapReady = false;

function initLiveLogisticsTracker() {
  const openBtn = document.getElementById("btn-open-logistics-tracking");
  const sidebarBtn = document.getElementById("btn-sidebar-logistics");
  const closeBtn = document.getElementById("btn-close-logistics-tracker");
  const modal = document.getElementById("logistics-tracker-modal");

  const openModal = () => {
    if (modal) {
      modal.classList.remove("hidden");
      modal.classList.add("flex");
      setTimeout(() => {
        initLogisticsMap();
      }, 50);
    }
  };

  openBtn?.addEventListener("click", openModal);
  sidebarBtn?.addEventListener("click", openModal);

  closeBtn?.addEventListener("click", () => {
    if (modal) {
      modal.classList.remove("flex");
      modal.classList.add("hidden");
    }
  });

  // Event handlers for filters
  document.getElementById("tab-logistics-view-all")?.addEventListener("click", (e) => switchLogisticsTab("all", e.currentTarget as HTMLButtonElement));
  document.getElementById("tab-logistics-view-stores")?.addEventListener("click", (e) => switchLogisticsTab("stores", e.currentTarget as HTMLButtonElement));
  document.getElementById("tab-logistics-view-riders")?.addEventListener("click", (e) => switchLogisticsTab("riders", e.currentTarget as HTMLButtonElement));
  document.getElementById("tab-logistics-view-active-deliveries")?.addEventListener("click", (e) => switchLogisticsTab("active-deliveries", e.currentTarget as HTMLButtonElement));

  document.getElementById("logistics-filter-state")?.addEventListener("change", (e) => {
    logisticsStateFilter = (e.target as HTMLSelectElement).value;
    renderLogisticsDashboard();
  });

  document.getElementById("logistics-filter-district")?.addEventListener("change", (e) => {
    logisticsDistrictFilter = (e.target as HTMLSelectElement).value;
    renderLogisticsDashboard();
  });

  document.getElementById("logistics-search-input")?.addEventListener("input", (e) => {
    logisticsSearch = (e.target as HTMLInputElement).value.toLowerCase().trim();
    renderLogisticsDashboard();
  });

  document.getElementById("btn-clear-active-route")?.addEventListener("click", () => {
    selectedActiveLiveRoute = null;
    document.getElementById("logistics-active-tracking")?.classList.add("hidden");
    renderLogisticsDashboard();
  });

  // Setup reactive triggers
  onValue(ref(db, "stores"), () => {
    if (modal && !modal.classList.contains("hidden")) {
      populateLogisticsFilters();
      renderLogisticsDashboard();
    }
  });

  onValue(ref(db, "deliveryboy1"), () => {
    if (modal && !modal.classList.contains("hidden")) {
      populateLogisticsFilters();
      renderLogisticsDashboard();
    }
  });

  onValue(ref(db, "orders"), () => {
    if (modal && !modal.classList.contains("hidden")) {
      renderLogisticsDashboard();
    }
  });
}

function switchLogisticsTab(tab: string, btn: HTMLButtonElement) {
  logisticsFilterTab = tab;
  const tabIds = ["tab-logistics-view-all", "tab-logistics-view-stores", "tab-logistics-view-riders", "tab-logistics-view-active-deliveries"];
  tabIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.className = "flex-1 py-1.5 text-center rounded-lg text-slate-400 font-semibold transition-all hover:text-white cursor-pointer";
    }
  });
  btn.className = "flex-1 py-1.5 text-center rounded-lg bg-teal-500 text-slate-950 font-bold transition-all cursor-pointer";
  renderLogisticsDashboard();
}

function initLogisticsMap() {
  const mappls = (window as any).mappls;
  if (!mappls) {
    loadMapplsScript(() => {
      initLogisticsMap();
    });
    return;
  }

  const mapDiv = document.getElementById("admin-live-logistics-map");
  if (!mapDiv) return;

  const defaultLat = 12.9716;
  const defaultLng = 77.5946;

  try {
    // If Map already initialized, just enforce layout render
    if ((window as any)["map_admin_live_logistics_map"]) {
      logisticsMapInstance = (window as any)["map_admin_live_logistics_map"];
      logisticsMapReady = true;
      const loadingOverlay = document.getElementById("logistics-map-loading");
      if (loadingOverlay) loadingOverlay.classList.add("hidden");
      setTimeout(() => {
        try {
          logisticsMapInstance.invalidateSize();
        } catch(err) {}
      }, 100);
      populateLogisticsFilters();
      renderLogisticsDashboard();
      return;
    }

    mapDiv.innerHTML = "";
    logisticsMapInstance = new mappls.Map("admin-live-logistics-map", {
      center: { lat: defaultLat, lng: defaultLng },
      zoom: 12,
      zoomControl: true,
      attributionControl: false
    });
    
    (window as any)["map_admin_live_logistics_map"] = logisticsMapInstance;
    logisticsMapReady = true;
    
    const loadingOverlay = document.getElementById("logistics-map-loading");
    if (loadingOverlay) loadingOverlay.classList.add("hidden");
    
    populateLogisticsFilters();
    renderLogisticsDashboard();
  } catch (e) {
    console.error("Mappls Live Logistics map init error:", e);
  }
}

function populateLogisticsFilters() {
  const states = new Set<string>();
  const districts = new Set<string>();

  if (Array.isArray(adminStoresCache)) {
    adminStoresCache.forEach(s => {
      if (s.state) states.add(s.state.trim());
      if (s.district) districts.add(s.district.trim());
    });
  }

  if (Array.isArray(ridersCache)) {
    ridersCache.forEach(r => {
      if (r.state) states.add(r.state.trim());
      if (r.district) districts.add(r.district.trim());
    });
  }

  const stateSel = document.getElementById("logistics-filter-state") as HTMLSelectElement;
  const distSel = document.getElementById("logistics-filter-district") as HTMLSelectElement;

  if (stateSel) {
    const curVal = stateSel.value;
    stateSel.innerHTML = '<option value="All">All States</option>';
    states.forEach(st => {
      stateSel.innerHTML += `<option value="${st}">${st}</option>`;
    });
    if (states.has(curVal)) stateSel.value = curVal;
  }

  if (distSel) {
    const curVal = distSel.value;
    distSel.innerHTML = '<option value="All">All Districts</option>';
    districts.forEach(ds => {
      distSel.innerHTML += `<option value="${ds}">${ds}</option>`;
    });
    if (districts.has(curVal)) distSel.value = curVal;
  }
}

function focusLogisticsCoordinates(lat: number, lng: number, zoomLevel: number = 14) {
  if (logisticsMapInstance && logisticsMapReady) {
    try {
      logisticsMapInstance.setCenter({ lat, lng });
      logisticsMapInstance.setZoom(zoomLevel);
    } catch(err) {
      console.error("Fail centering coordinates index:", err);
    }
  }
}

function trackActiveLogisticsRoute(orderId: string) {
  const matchedOrder = (ordersCache || []).find(o => o.orderId === orderId);
  if (matchedOrder) {
    selectedActiveLiveRoute = matchedOrder;
    // Show live route tracking HUD overlay
    const trackingHUD = document.getElementById("logistics-active-tracking");
    if (trackingHUD) {
      trackingHUD.classList.remove("hidden");
    }
    renderLogisticsDashboard();
    
    // Auto center map on the store location
    if (matchedOrder.storeLocation?.lat && matchedOrder.storeLocation?.lng) {
      focusLogisticsCoordinates(matchedOrder.storeLocation.lat, matchedOrder.storeLocation.lng, 13);
    }
    showToast(`Tracing LIVE dispatch route for Order #${orderId}`, "info");
  }
}

function renderLogisticsDashboard() {
  if (!logisticsMapReady || !logisticsMapInstance) return;

  const mappls = (window as any).mappls;
  if (!mappls) return;

  // 1. Gather Telemetry Stats
  let onlineRiders = 0;
  let offlineRiders = 0;
  let activeRidersCount = 0;
  let activeShipmentsSum = 0;

  const activeRiderIds = new Set<string>();

  // Determine active shipments & active riders from ordersCache
  const activeOrders = (ordersCache || []).filter(o => 
    o.status !== "delivered" && o.status !== "cancelled"
  );
  activeShipmentsSum = activeOrders.length;

  activeOrders.forEach(o => {
    if (o.deliveryId) {
      activeRiderIds.add(o.deliveryId);
    }
  });
  activeRidersCount = activeRiderIds.size;

  (ridersCache || []).forEach(r => {
    if (r.active) {
      onlineRiders++;
    } else {
      offlineRiders++;
    }
  });

  // Push Stats into UI
  const onlineEl = document.getElementById("logistics-stat-online");
  if (onlineEl) onlineEl.innerText = onlineRiders.toString();

  const activeRidersEl = document.getElementById("logistics-stat-active-riders");
  if (activeRidersEl) activeRidersEl.innerText = activeRidersCount.toString();

  const offlineEl = document.getElementById("logistics-stat-offline");
  if (offlineEl) offlineEl.innerText = offlineRiders.toString();

  const shipmentsEl = document.getElementById("logistics-stat-shipments");
  if (shipmentsEl) shipmentsEl.innerText = activeShipmentsSum.toString();

  // Clear previous overlays
  logisticsOverlays.forEach((ol: any) => {
    try {
      if (ol && typeof ol.remove === "function") {
        ol.remove();
      }
    } catch(e) {}
  });
  logisticsOverlays = [];

  // Filter lists & assets
  const filteredStores = (adminStoresCache || []).filter(s => {
    if (logisticsStateFilter !== "All" && s.state !== logisticsStateFilter) return false;
    if (logisticsDistrictFilter !== "All" && s.district !== logisticsDistrictFilter) return false;
    if (logisticsSearch) {
      const match = (s.name || "").toLowerCase().includes(logisticsSearch) ||
                    (s.storeId || "").toLowerCase().includes(logisticsSearch) ||
                    (s.district || "").toLowerCase().includes(logisticsSearch);
      if (!match) return false;
    }
    return true;
  });

  const filteredRiders = (ridersCache || []).filter(r => {
    if (logisticsStateFilter !== "All" && r.state !== logisticsStateFilter) return false;
    if (logisticsDistrictFilter !== "All" && r.district !== logisticsDistrictFilter) return false;
    if (logisticsSearch) {
      const match = (r.name || "").toLowerCase().includes(logisticsSearch) ||
                    (r.mobile || "").toLowerCase().includes(logisticsSearch) ||
                    (r.uid || r.deliveryId || "").toLowerCase().includes(logisticsSearch);
      if (!match) return false;
    }
    // Tab filtering
    if (logisticsFilterTab === "active-deliveries") {
      return activeRiderIds.has(r.deliveryId || r.uid);
    }
    return true;
  });

  // 2. Plot Map Objects

  // Draw Stores (🏥 representation if not on "Riders Only" tab filter)
  if (logisticsFilterTab === "all" || logisticsFilterTab === "stores") {
    filteredStores.forEach(s => {
      if (s.location?.lat && s.location?.lng) {
        try {
          const m = new mappls.Marker({
            map: logisticsMapInstance,
            position: { lat: s.location.lat, lng: s.location.lng },
            html: `<div class="w-8 h-8 rounded-full shadow-lg border-2 border-white flex items-center justify-center bg-teal-500 text-white hover:scale-110 transition-transform cursor-pointer" title="${s.name || "Pharmacy Branch"}"><i class="fa-solid fa-hospital text-[11px]"></i></div>`
          });
          
          // Tooltip click listener which launches the Inspector Profile Modal
          m.addListener("click", () => {
            showToast(`inspecting ${s.name}...`, "info");
            inspectAsset("store", s.storeId);
          });
          
          logisticsOverlays.push(m);
        } catch(me) {
          console.error("Store marker exception:", me);
        }
      }
    });
  }

  // Draw Riders (🚴 representation if not on "Stores Only" tab filter)
  if (logisticsFilterTab === "all" || logisticsFilterTab === "riders" || logisticsFilterTab === "active-deliveries") {
    filteredRiders.forEach(r => {
      const live = r.location;
      if (live?.lat && live?.lng) {
        try {
          const isRiderActive = activeRiderIds.has(r.uid || r.deliveryId);
          const colorClass = isRiderActive ? "bg-amber-500" : (r.active ? "bg-emerald-500" : "bg-slate-500");
          const m = new mappls.Marker({
            map: logisticsMapInstance,
            position: { lat: live.lat, lng: live.lng },
            html: `<div class="w-8.5 h-8.5 rounded-full shadow-lg border-2 border-slate-900 flex items-center justify-center ${colorClass} text-white hover:scale-110 transition-transform cursor-pointer" title="${r.name || "Rider Branch"}"><i class="fa-solid fa-motorcycle text-xs"></i></div>`
          });

          m.addListener("click", () => {
            showToast(`inspecting ${r.name || "Rider Agent"}...`, "info");
            inspectAsset("rider", r.uid || r.deliveryId);
          });

          logisticsOverlays.push(m);
        } catch(me) {
          console.error("Rider marker exception:", me);
        }
      }
    });
  }

  // 3. Draw Active Shipment Routing paths if selecting focused tracking
  if (selectedActiveLiveRoute) {
    const o = selectedActiveLiveRoute;
    const store = (adminStoresCache || []).find(s => s.storeId === o.storeId);
    const rider = (ridersCache || []).find(r => r.deliveryId === o.deliveryId || r.uid === o.deliveryId);
    
    const sLat = store?.location?.lat || o.storeLocation?.lat;
    const sLng = store?.location?.lng || o.storeLocation?.lng;
    const rLat = rider?.location?.lat;
    const rLng = rider?.location?.lng;
    const cLat = o.userLocation?.lat;
    const cLng = o.userLocation?.lng;

    // Direct active panel HUD bindings
    const hudDetails = document.getElementById("logistics-route-details");
    if (hudDetails) {
      const calculatedSpeed = rider?.location?.speed || (rider?.active ? 28 : 0);
      const relativeTime = rider?.location?.lastUpdated ? formatRelativeTime(rider.location.lastUpdated) : "Just now";
      hudDetails.innerHTML = `
        <div class="space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
          <p class="text-white font-bold"><i class="fa-solid fa-file-medical text-teal-400 mr-1.5"></i> Order #${o.orderId}</p>
          <p class="text-[10px] text-slate-400">Store Hub: <strong class="text-slate-200">${o.storeName || "MedsHub Pharmacy"}</strong></p>
          <p class="text-[10px] text-slate-400">Rider Unit: <strong class="text-slate-200">${rider?.name || o.deliveryName || "Agent"}</strong></p>
          <p class="text-[10px] text-slate-400 font-mono">Current Speed: <strong class="text-amber-400">${calculatedSpeed} KM/H</strong></p>
          <p class="text-[10px] text-slate-400 font-mono">Telemetry Signal: <strong class="text-teal-400">${relativeTime}</strong></p>
          <p class="text-[10px] text-rose-400 font-bold uppercase mt-1 text-[9px]"><i class="fa-solid fa-truck-fast"></i> Transit Status: ${o.status?.toUpperCase() || "SHIPPED"}</p>
        </div>
      `;
    }

    // Plot Route Paths
    if (sLat && sLng && cLat && cLng) {
      // 🏥 Store Pin Marker
      try {
        const storeMarker = new mappls.Marker({
          map: logisticsMapInstance,
          position: { lat: sLat, lng: sLng },
          html: `<div class="w-10 h-10 rounded-full bg-teal-500 border-2 border-white flex items-center justify-center text-white shadow-2xl relative"><i class="fa-solid fa-hospital text-sm"></i><span class="absolute -top-1.5 -right-1 bg-slate-900 text-[8px] font-black px-1 rounded uppercase border border-slate-700">Hub</span></div>`
        });
        logisticsOverlays.push(storeMarker);
      } catch(pe) {}

      // 🏠 Patient Pin Marker
      try {
        const patientMarker = new mappls.Marker({
          map: logisticsMapInstance,
          position: { lat: cLat, lng: cLng },
          html: `<div class="w-10 h-10 rounded-full bg-rose-500 border-2 border-white flex items-center justify-center text-white shadow-2xl relative"><i class="fa-solid fa-house-chimney-medical text-sm"></i><span class="absolute -top-1.5 -right-1 bg-slate-900 text-[8px] font-black px-1 rounded uppercase border border-slate-700">Customer</span></div>`
        });
        logisticsOverlays.push(patientMarker);
      } catch(pe) {}

      // If rider coordinates are active, plot the rider marker & render path blocks
      if (rLat && rLng) {
        try {
          const riderMarker = new mappls.Marker({
            map: logisticsMapInstance,
            position: { lat: rLat, lng: rLng },
            html: `<div class="w-10 h-10 rounded-full bg-amber-500 border-2 border-slate-950 flex items-center justify-center text-white shadow-2xl relative animate-bounce"><i class="fa-solid fa-motorcycle text-sm"></i><span class="absolute -top-1.5 -right-1 bg-slate-950 text-[8px] font-black px-1 rounded uppercase border border-slate-800">Rider</span></div>`
          });
          logisticsOverlays.push(riderMarker);
        } catch(pe) {}

        // Trace Segment 1: Rider -> Store
        getMapplsRoute(rLat, rLng, sLat, sLng).then(res1 => {
          if (res1?.polyline) {
            try {
              const polyline1 = new mappls.Polyline({
                map: logisticsMapInstance,
                paths: res1.polyline.map((p: any) => ({ lat: p[0], lng: p[1] })),
                strokeColor: "#3b82f6", // Blue solid
                strokeWeight: 6,
                strokeOpacity: 0.95
              });
              logisticsOverlays.push(polyline1);
            } catch(e) {}
          }
        });

        // Trace Segment 2: Store -> Patient
        getMapplsRoute(sLat, sLng, cLat, cLng).then(res2 => {
          if (res2?.polyline) {
            try {
              const polyline2 = new mappls.Polyline({
                map: logisticsMapInstance,
                paths: res2.polyline.map((p: any) => ({ lat: p[0], lng: p[1] })),
                strokeColor: "#10b981", // Emerald dashed representation
                strokeWeight: 5,
                strokeOpacity: 0.85,
                dashArray: "10, 10"
              });
              logisticsOverlays.push(polyline2);
            } catch(e) {}
          }
        });
      } else {
        // Fallback trace directly: Store -> Patient
        getMapplsRoute(sLat, sLng, cLat, cLng).then(res => {
          if (res?.polyline) {
            try {
              const polyline = new mappls.Polyline({
                map: logisticsMapInstance,
                paths: res.polyline.map((p: any) => ({ lat: p[0], lng: p[1] })),
                strokeColor: "#4f46e5",
                strokeWeight: 6,
                strokeOpacity: 0.9
              });
              logisticsOverlays.push(polyline);
            } catch(e) {}
          }
        });
      }
    }
  }

  // 4. Render Left Sidebar items Feed
  const feedList = document.getElementById("logistics-feed-list");
  if (!feedList) return;

  if (logisticsFilterTab === "stores") {
    if (filteredStores.length === 0) {
      feedList.innerHTML = `<p class="text-xs text-slate-500 py-6 text-center">No matching stores found.</p>`;
      return;
    }
    
    feedList.innerHTML = filteredStores.map(s => {
      const lat = s.location?.lat || 0;
      const lng = s.location?.lng || 0;
      const pinAction = lat && lng ? `onclick="focusLogisticsCoordinates(${lat}, ${lng}, 15)"` : '';
      return `
        <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 select-none hover:border-teal-500/50 transition-all">
          <div class="flex items-start justify-between gap-2">
            <div>
              <span class="text-[9px] bg-teal-500/10 text-teal-400 font-bold px-1.5 py-0.5 rounded border border-teal-500/15 uppercase">🏥 STORE HUB</span>
              <h4 class="text-xs font-bold text-white mt-1.5 tracking-tight">${s.name || "MedsHub Pharmacy"}</h4>
              <p class="text-[10px] text-slate-400 mt-1 uppercase font-mono">${s.storeId || "N/A"}</p>
              <p class="text-[10px] text-slate-400 leading-tight mt-1">${s.address || "Billing Area Gonda, Uttar Pradesh"}</p>
            </div>
            
            ${lat && lng ? `
              <button ${pinAction} class="p-2 bg-slate-950 text-teal-400 hover:text-white hover:bg-teal-500/20 border border-slate-800 hover:border-teal-500/40 rounded-lg text-xs transition-all cursor-pointer" title="Focus Store map view">
                <i class="fa-solid fa-map-location-dot"></i>
              </button>
            ` : ''}
          </div>
          <div class="mt-2 pt-2 border-t border-slate-800/80 flex justify-between items-center text-[9px] text-slate-500 font-bold uppercase tracking-wide">
            <span>District: ${s.district || "Gonda"}</span>
            <span>State: ${s.state || "Uttar Pradesh"}</span>
          </div>
        </div>
      `;
    }).join("");

  } else if (logisticsFilterTab === "riders") {
    if (filteredRiders.length === 0) {
      feedList.innerHTML = `<p class="text-xs text-slate-500 py-6 text-center">No matching delivery boys found.</p>`;
      return;
    }

    feedList.innerHTML = filteredRiders.map(r => {
      const lat = r.location?.lat || 0;
      const lng = r.location?.lng || 0;
      const pinAction = lat && lng ? `onclick="focusLogisticsCoordinates(${lat}, ${lng}, 15)"` : '';
      const activeDeliveryOrder = activeOrders.find(o => o.deliveryId === r.uid || o.deliveryId === r.deliveryId);
      const isDelivering = !!activeDeliveryOrder;
      
      const badgeText = isDelivering ? "In Transit" : (r.active ? "Online / Idle" : "Offline");
      const badgeClass = isDelivering ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" : (r.active ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-slate-500/15 text-slate-400 border border-slate-500/20");
      const lastUpStr = r.location?.lastUpdated ? formatRelativeTime(r.location.lastUpdated) : "No coordinates linked";

      return `
        <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 select-none hover:border-indigo-500/50 transition-all">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <span class="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${badgeClass}">${badgeText}</span>
              <h4 class="text-xs font-bold text-white mt-2 tracking-tight truncate">${r.name || "Delivery Agent"}</h4>
              <p class="text-[9px] text-slate-500 mt-1 uppercase font-mono truncate">ID: ${r.uid || "N/A"}</p>
              <p class="text-[10px] text-slate-400 font-sans mt-1">Mobile: ${r.mobile || "N/A"}</p>
              <p class="text-[10px] text-slate-404 text-slate-500 font-mono mt-0.5">Signal: ${lastUpStr}</p>
            </div>

            <div class="flex flex-col gap-1.5">
              ${lat && lng ? `
                <button ${pinAction} class="p-2 bg-slate-950 text-indigo-400 hover:text-white hover:bg-indigo-500/20 border border-slate-800 hover:border-indigo-500/40 rounded-lg text-xs transition-all cursor-pointer" title="Focus Rider position">
                  <i class="fa-solid fa-location-crosshairs"></i>
                </button>
              ` : ''}
              ${isDelivering ? `
                <button onclick="trackActiveLogisticsRoute('${activeDeliveryOrder.orderId}')" class="p-2 bg-amber-500/10 text-amber-500 hover:text-white hover:bg-amber-500 rounded-lg text-xs transition-all cursor-pointer" title="Trace Dispatch Route">
                  <i class="fa-solid fa-route animate-pulse"></i>
                </button>
              ` : ''}
            </div>
          </div>
          <div class="mt-2 pt-2 border-t border-slate-800/80 flex justify-between items-center text-[9px] text-slate-550 text-slate-500 font-bold uppercase tracking-wide">
            <span>District: ${r.district || "Gonda"}</span>
            <span>Speed: ${r.location?.speed || (r.active ? '28 KM/H' : '0')}</span>
          </div>
        </div>
      `;
    }).join("");

  } else if (logisticsFilterTab === "active-deliveries") {
    if (activeOrders.length === 0) {
      feedList.innerHTML = `<p class="text-xs text-slate-500 py-6 text-center select-none font-medium">No active delivery assignments running right now.</p>`;
      return;
    }

    feedList.innerHTML = activeOrders.map(o => {
      const isSelected = selectedActiveLiveRoute?.orderId === o.orderId;
      const rider = (ridersCache || []).find(r => r.deliveryId === o.deliveryId || r.uid === o.deliveryId);
      const speed = rider?.location?.speed || (rider?.active ? 28 : 0);
      return `
        <div class="p-3 rounded-xl bg-slate-900 border ${isSelected ? "border-amber-500 bg-amber-500/5" : "border-slate-800"} select-none hover:border-amber-5/50 transition-all">
          <div class="flex items-start justify-between gap-1.5">
            <div>
              <span class="text-[9px] bg-indigo-500/10 text-indigo-400 font-bold px-1.5 py-0.5 rounded border border-indigo-500/15 uppercase">ACTIVE SHIPMENT</span>
              <h4 class="text-xs font-black text-slate-100 mt-2">Order #${o.orderId}</h4>
              <p class="text-[10px] text-slate-400 mt-1 font-sans">Hub: <strong>${o.storeName || "MedsHub Branch"}</strong></p>
              <p class="text-[10px] text-slate-400 mt-0.5">Rider: <strong class="text-slate-200">${rider?.name || o.deliveryName || "Agent"}</strong></p>
              <p class="text-[10px] text-slate-400 mt-0.5 truncate">Address: <span class="text-slate-350 text-slate-300 font-sans">${o.userAddress || "Patient Home, Gonda"}</span></p>
              <p class="text-[10px] text-slate-400 mt-1 font-mono">Speed: <strong class="text-amber-400">${speed} KM/H</strong></p>
            </div>

            <button onclick="trackActiveLogisticsRoute('${o.orderId}')" class="p-2 bg-slate-950 text-amber-400 hover:text-white hover:bg-amber-500 border border-slate-800 hover:border-amber-500 rounded-lg text-xs transition-all cursor-pointer" title="Track Live Route Path">
              <i class="fa-solid fa-route animate-pulse"></i>
            </button>
          </div>
          <div class="mt-2 pt-2 border-t border-slate-800/80 flex justify-between items-center text-[9px] text-slate-500 font-bold uppercase select-none">
            <span class="text-rose-400">Status: ${o.status || "TRANSIT"}</span>
            <span class="text-slate-400">Total: ₹${o.total || 0}</span>
          </div>
        </div>
      `;
    }).join("");

  } else {
    // Default All tab combines matching stores and active riders
    if (filteredStores.length === 0 && filteredRiders.length === 0) {
      feedList.innerHTML = `<p class="text-xs text-slate-500 py-6 text-center select-none">No general logistics nodes matched your parameters.</p>`;
      return;
    }

    let html = "";
    
    // Add up to 5 matching stores
    filteredStores.slice(0, 5).forEach(s => {
      const lat = s.location?.lat || 0;
      const lng = s.location?.lng || 0;
      const pinAction = lat && lng ? `onclick="focusLogisticsCoordinates(${lat}, ${lng}, 15)"` : '';
      html += `
        <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 select-none hover:border-teal-500/40 transition-all">
          <div class="flex items-start justify-between gap-1.5">
            <div>
              <span class="text-[9px] bg-teal-500/10 text-teal-400 font-bold px-1.5 py-0.5 rounded border border-teal-500/15 uppercase">🏥 STORE BRANCH</span>
              <h4 class="text-xs font-bold text-white mt-1.5 truncate max-w-[200px]">${s.name || "Pharmacy Nodes"}</h4>
              <p class="text-[9px] text-slate-500 mt-1">ID: ${s.storeId || "N/A"}</p>
            </div>
            ${lat && lng ? `
              <button ${pinAction} class="p-2 bg-slate-950 text-teal-400 hover:text-white hover:bg-teal-500/20 border border-slate-800 hover:border-teal-500/40 rounded-lg text-xs transition-all cursor-pointer">
                <i class="fa-solid fa-map-location-dot"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    });

    // Add list riders
    filteredRiders.forEach(r => {
      const lat = r.location?.lat || 0;
      const lng = r.location?.lng || 0;
      const pinAction = lat && lng ? `onclick="focusLogisticsCoordinates(${lat}, ${lng}, 15)"` : '';
      const isRiderActive = activeRiderIds.has(r.uid || r.deliveryId);
      const colorClass = isRiderActive ? "text-amber-400" : (r.active ? "text-emerald-400" : "text-slate-400");
      const isDelivering = isRiderActive;
      const activeDeliveryOrder = activeOrders.find(o => o.deliveryId === r.uid || o.deliveryId === r.deliveryId);

      html += `
        <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 select-none hover:border-indigo-500/40 transition-all">
          <div class="flex items-start justify-between gap-1.5">
            <div>
              <span class="text-[9px] bg-indigo-500/10 ${colorClass} font-bold px-1.5 py-0.5 rounded border border-indigo-500/15 uppercase">${isRiderActive ? "Transit Assignment" : (r.active ? "Online / Ready" : "Offline")}</span>
              <h4 class="text-xs font-bold text-white mt-1.5 truncate max-w-[200px]">${r.name || "Delivery Agent"}</h4>
              <p class="text-[9px] text-slate-500 mt-1 truncate">ID: ${r.uid || "N/A"}</p>
            </div>
            <div class="flex items-center gap-1">
              ${lat && lng ? `
                <button ${pinAction} class="p-2 bg-slate-950 text-indigo-400 hover:text-white hover:bg-indigo-500/25 border border-slate-800 hover:border-indigo-550 rounded-lg text-xs transition-all cursor-pointer">
                  <i class="fa-solid fa-location-crosshairs"></i>
                </button>
              ` : ''}
              ${isDelivering ? `
                <button onclick="trackActiveLogisticsRoute('${activeDeliveryOrder.orderId}')" class="p-2 bg-amber-500/10 text-amber-505 text-amber-400 hover:text-white hover:bg-amber-550 border border-slate-800 hover:border-amber-550 rounded-lg text-xs transition-all cursor-pointer">
                  <i class="fa-solid fa-route animate-pulse"></i>
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    });

    feedList.innerHTML = html;
  }
}

function formatRelativeTime(msec: number): string {
  if (!msec) return "Never";
  const diff = Date.now() - msec;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "Just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(msec).toLocaleDateString();
}

function inspectAsset(type: 'store' | 'rider', id: string) {
  const overlay = document.getElementById("logistics-inspect-overlay");
  const body = document.getElementById("logistics-inspect-body");
  const tag = document.getElementById("inspect-entity-tag");
  if (!overlay || !body || !tag) return;

  if (type === 'store') {
    const store = (adminStoresCache || []).find(s => s.storeId === id);
    if (!store) {
      showToast("Store not found in cache", "error");
      return;
    }
    tag.innerText = "🏥 STORE INFO INSIGHT";
    body.innerHTML = `
      <div class="space-y-2">
        <h3 class="text-xs font-black text-white uppercase">${store.name || "MedsHub Pharmacy"}</h3>
        <div class="grid grid-cols-2 gap-1 text-[10px] font-mono p-1.5 bg-slate-900 rounded border border-slate-800">
          <span class="text-slate-404 text-slate-400">STORE ID:</span> <span class="text-slate-200 text-right font-bold truncate">${store.storeId || "N/A"}</span>
          <span class="text-slate-404 text-slate-400">STATE:</span> <span class="text-slate-200 text-right">${store.state || "Uttar Pradesh"}</span>
          <span class="text-slate-404 text-slate-400">DISTRICT:</span> <span class="text-slate-200 text-right">${store.district || "Gonda"}</span>
          <span class="text-slate-404 text-slate-400">REVENUE:</span> <span class="text-emerald-400 text-right">₹${store.revenue || 0}</span>
          <span class="text-slate-404 text-slate-400">LATITUDE:</span> <span class="text-slate-200 text-right">${store.location?.lat?.toFixed(5) || "N/A"}</span>
          <span class="text-slate-404 text-slate-400">LONGITUDE:</span> <span class="text-slate-200 text-right">${store.location?.lng?.toFixed(5) || "N/A"}</span>
        </div>
        <p class="text-[9.5px] leading-snug text-slate-400"><i class="fa-solid fa-map-pin text-rose-500 mr-1 text-[10px]"></i>${store.address || "No precise description provided"}</p>
        <button onclick="focusLogisticsCoordinates(${store.location?.lat}, ${store.location?.lng}, 15)" class="w-full bg-teal-500 hover:bg-teal-600 text-slate-950 font-black py-1.5 rounded-lg text-[10px] uppercase transition-all tracking-wider cursor-pointer">
          <i class="fa-solid fa-location-dot"></i> Focus Store Map Node
        </button>
      </div>
    `;
    overlay.classList.remove("hidden");
    if (store.location?.lat && store.location?.lng) {
      focusLogisticsCoordinates(store.location.lat, store.location.lng, 14);
    }
  } else if (type === 'rider') {
    const rider = (ridersCache || []).find(r => r.deliveryId === id || r.uid === id);
    if (!rider) {
      showToast("Rider not found in cache", "error");
      return;
    }
    tag.innerText = "🚴 RIDER TELEMETRY INSIGHT";
    
    const activeOrders = (ordersCache || []).filter(o => o.status !== "delivered" && o.status !== "cancelled");
    const matchedActiveOrder = activeOrders.find(o => o.deliveryId === rider.uid || o.deliveryId === rider.deliveryId);
    const isRiderActive = !!matchedActiveOrder;
    const mode = isRiderActive ? "TRANSIT DELIVERING" : (rider.active ? "ONLINE / IDLE" : "OFFLINE");
    const modeColor = isRiderActive ? "text-amber-400" : (rider.active ? "text-emerald-400" : "text-slate-400");
    const speed = rider.location?.speed || (rider.active ? 28 : 0);
    
    body.innerHTML = `
      <div class="space-y-2">
        <h3 class="text-xs font-black text-white uppercase">${rider.name || "Delivery Agent"}</h3>
        <div class="grid grid-cols-2 gap-1 text-[10px] font-mono p-1.5 bg-slate-900 rounded border border-slate-800">
          <span class="text-slate-404 text-slate-400">RIDER ID:</span> <span class="text-slate-200 text-right truncate font-bold" title="${rider.deliveryId || rider.uid}">${(rider.deliveryId || rider.uid || "N/A").substring(0, 12)}...</span>
          <span class="text-slate-404 text-slate-400">MOBILE:</span> <span class="text-slate-200 text-right">${rider.mobile || "N/A"}</span>
          <span class="text-slate-404 text-slate-400">STATUS:</span> <span class="${modeColor} text-right font-black">${mode}</span>
          <span class="text-slate-404 text-slate-400">SPEED DETECT:</span> <span class="text-amber-400 text-right font-bold">${speed} KM/H</span>
          <span class="text-slate-404 text-slate-400">LATITUDE:</span> <span class="text-slate-200 text-right">${rider.location?.lat?.toFixed(5) || "N/A"}</span>
          <span class="text-slate-404 text-slate-400">LONGITUDE:</span> <span class="text-slate-200 text-right">${rider.location?.lng?.toFixed(5) || "N/A"}</span>
        </div>
        <p class="text-[9.5px] leading-snug text-slate-400"><i class="fa-solid fa-clock mr-1 text-[10px] text-teal-400"></i>Signal updated: ${rider.location?.lastUpdated ? formatRelativeTime(rider.location.lastUpdated) : "N/A"}</p>
        <div class="flex gap-1.5">
          <button onclick="focusLogisticsCoordinates(${rider.location?.lat}, ${rider.location?.lng}, 15)" class="flex-1 bg-teal-500 hover:bg-teal-600 text-slate-950 font-black py-1.5 rounded-lg text-[10px] uppercase transition-all tracking-wider cursor-pointer">
            <i class="fa-solid fa-crosshairs"></i> Focus
          </button>
          ${isRiderActive ? `
            <button onclick="trackActiveLogisticsRoute('${matchedActiveOrder.orderId}')" class="flex-1 bg-indigo-550 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-1.5 rounded-lg text-[10px] uppercase transition-all tracking-wider cursor-pointer">
              <i class="fa-solid fa-route"></i> Trace Route
            </button>
          ` : ''}
        </div>
      </div>
    `;
    overlay.classList.remove("hidden");
    if (rider.location?.lat && rider.location?.lng) {
      focusLogisticsCoordinates(rider.location.lat, rider.location.lng, 14);
    }
  }
}

// Window bindings helper
Object.assign(window, {
  inspectAsset,
  focusLogisticsCoordinates,
  trackActiveLogisticsRoute,
  smcSelectStore,
  closeSmcEditModal,
  smcFocusDeliveryRoute,
  closeUserDetailsInspectModal,
  inspectPatientDossier,
  deleteNotification,
  dismissReview,
  resolveComplaint,
  deleteComplaint,
  smcDeleteMedicine(medId: string) {
    if (confirm("Clinical Mandate: Permanently remove this medicine on behalf of the store?")) {
      remove(ref(db, `medicines/${medId}`)).then(() => {
        showToast("Medicine cleared successfully", "info");
      });
    }
  },
  smcUpdatePrice(medId: string, valStr: string) {
    const nextP = parseFloat(valStr);
    if (isNaN(nextP) || nextP <= 0) {
      showToast("Invalid price format", "error");
      return;
    }
    update(ref(db, `medicines/${medId}`), { price: nextP }).then(() => {
      showToast("Store shelf price overrides synced in db!", "success");
    });
  },
  smcUpdateStock(medId: string, valStr: string) {
    const nextS = parseInt(valStr);
    if (isNaN(nextS) || nextS < 0) {
      showToast("Invalid stock volume", "error");
      return;
    }
    update(ref(db, `medicines/${medId}`), { stock: nextS }).then(() => {
      showToast("Store stock volume overrides synced in db!", "success");
    });
  }
});

function initSupportCenterManagement() {
  const refPath = "support_settings";

  // Real-time listener for support configurations
  onValue(ref(db, refPath), (snapshot) => {
    if (snapshot.exists()) {
      const s = snapshot.val();

      const phoneInp = document.getElementById("set-sup-phone") as HTMLInputElement;
      if (phoneInp) phoneInp.value = s.phone || "+919999999999";

      const waInp = document.getElementById("set-sup-whatsapp") as HTMLInputElement;
      if (waInp) waInp.value = s.whatsapp || "+919999999999";

      const emergencyInp = document.getElementById("set-sup-emergency") as HTMLInputElement;
      if (emergencyInp) emergencyInp.value = s.emergency || "+919876543210";

      const emailInp = document.getElementById("set-sup-email") as HTMLInputElement;
      if (emailInp) emailInp.value = s.email || "support@rsmedshub.com";

      const hoursInp = document.getElementById("set-sup-hours") as HTMLInputElement;
      if (hoursInp) hoursInp.value = s.hours || "9:00 AM - 10:00 PM (Daily)";

      // Handle states of checkboxes
      const callToggle = document.getElementById("set-sup-call-toggle") as HTMLInputElement;
      if (callToggle) callToggle.checked = s.enableCall !== false;

      const waToggle = document.getElementById("set-sup-whatsapp-toggle") as HTMLInputElement;
      if (waToggle) waToggle.checked = s.enableWhatsapp !== false;

      const emergencyToggle = document.getElementById("set-sup-emergency-toggle") as HTMLInputElement;
      if (emergencyToggle) emergencyToggle.checked = s.enableEmergency !== false;

      // Update indicators
      const badgeCall = document.getElementById("st-badge-call");
      if (badgeCall) {
        if (s.enableCall !== false) {
          badgeCall.innerText = "ONLINE";
          badgeCall.className = "text-emerald-400 font-bold font-sans";
        } else {
          badgeCall.innerText = "OFFLINE";
          badgeCall.className = "text-rose-455 text-rose-400 font-bold font-sans";
        }
      }

      const badgeWa = document.getElementById("st-badge-whatsapp");
      if (badgeWa) {
        if (s.enableWhatsapp !== false) {
          badgeWa.innerText = "ONLINE";
          badgeWa.className = "text-emerald-400 font-bold font-sans";
        } else {
          badgeWa.innerText = "OFFLINE";
          badgeWa.className = "text-rose-455 text-rose-400 font-bold font-sans";
        }
      }

      const badgeEmerg = document.getElementById("st-badge-emergency");
      if (badgeEmerg) {
        if (s.enableEmergency !== false) {
          badgeEmerg.innerText = "HIGH PRECEDENCE";
          badgeEmerg.className = "text-rose-400 font-bold font-sans";
        } else {
          badgeEmerg.innerText = "DISABLED";
          badgeEmerg.className = "text-slate-450 text-slate-400 font-bold font-sans";
        }
      }
    }
  });

  const saveSupportSettings = () => {
    const phone = (document.getElementById("set-sup-phone") as HTMLInputElement).value.trim();
    const whatsapp = (document.getElementById("set-sup-whatsapp") as HTMLInputElement).value.trim();
    const emergency = (document.getElementById("set-sup-emergency") as HTMLInputElement).value.trim();
    const email = (document.getElementById("set-sup-email") as HTMLInputElement).value.trim();
    const hours = (document.getElementById("set-sup-hours") as HTMLInputElement).value.trim();

    const enableCall = (document.getElementById("set-sup-call-toggle") as HTMLInputElement).checked;
    const enableWhatsapp = (document.getElementById("set-sup-whatsapp-toggle") as HTMLInputElement).checked;
    const enableEmergency = (document.getElementById("set-sup-emergency-toggle") as HTMLInputElement).checked;

    if (!phone || !whatsapp || !emergency || !email || !hours) {
      showToast("Please fill in all support details fully.", "error");
      return;
    }

    const payload = {
      phone,
      whatsapp,
      emergency,
      email,
      hours,
      enableCall,
      enableWhatsapp,
      enableEmergency,
      updatedAt: Date.now()
    };

    set(ref(db, "support_settings"), payload).then(() => {
      showToast("Support Center Configuration written and synced safely!", "success");
    }).catch((err) => {
      console.error(err);
      showToast("Failed to lock support state.", "error");
    });
  };

  document.getElementById("btn-save-support-top")?.addEventListener("click", saveSupportSettings);
}

// =================================== ADVANCED RIDER FINANCE & SETTLEMENT CENTER ===================================
let settlementRequestsCache: any[] = [];
let codDepositsCache: any[] = [];
let rfRiderSearchQuery = "";
let rfLedgerFilter = "all";

let renderRidersPayrollTable: any;
let renderSalaryLedgerRecords: any;
let renderRiderSettlementClaims: any;
let renderCodReconciliationTable: any;
let renderPendingCODDeposits: any;

function initRiderFinanceCenter() {
  console.log("Initializing MedsHub Rider Finance & Settlement Center...");

  // BIND SUBTABS
  const rfSubtabButtons = document.querySelectorAll(".rf-subtab-btn");
  rfSubtabButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetButton = e.currentTarget as HTMLButtonElement;
      const targetTab = targetButton.getAttribute("data-tab")!;

      rfSubtabButtons.forEach((b) => b.classList.remove("bg-white", "text-slate-900", "shadow-xs", "border", "border-slate-200/50"));
      rfSubtabButtons.forEach((b) => b.classList.add("text-slate-500", "hover:text-slate-800"));

      targetButton.classList.remove("text-slate-500", "hover:text-slate-800");
      targetButton.classList.add("bg-white", "text-slate-900", "shadow-xs", "border", "border-slate-200/50");

      document.querySelectorAll(".rf-subtab-panel").forEach((p) => p.classList.add("hidden"));
      const panelEl = document.getElementById(targetTab);
      if (panelEl) {
        panelEl.classList.remove("hidden");
      }
    });
  });

  // CONNECT BANNER BUTTONS FOR TAB SHORTCUTS
  document.getElementById("alert-tab-settlements-btn")?.addEventListener("click", () => {
    const el = document.getElementById("subtab-settlements-btn");
    if (el) el.click();
  });
  document.getElementById("alert-tab-deposits-btn")?.addEventListener("click", () => {
    const el = document.getElementById("subtab-cod-btn");
    if (el) el.click();
  });

  // RIDER SEARCH query watcher
  document.getElementById("inp-rf-rider-search")?.addEventListener("input", (e) => {
    rfRiderSearchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
    
    // Recalculate and update the UI directly
    const calcEarnings = getRidersEarningsMap();
    const calcApprovedDeposits = getRidersApprovedDepositsMap();
    const calcPaidClaims = getRidersPaidClaimsMap();
    const calcPendingClaims = getRidersPendingClaimsMap();
    const codecMap = getRidersCodHandledMap();
    
    renderRidersPayrollTable(calcEarnings, calcApprovedDeposits, calcPaidClaims, calcPendingClaims, codecMap);
  });

  // LEDGER FILTER triggers
  document.getElementById("rf-ledger-filter-all")?.addEventListener("click", () => {
    (window as any).setRfLedgerFilter("all");
  });
  document.getElementById("rf-ledger-filter-upi")?.addEventListener("click", () => {
    (window as any).setRfLedgerFilter("upi");
  });
  document.getElementById("rf-ledger-filter-bank")?.addEventListener("click", () => {
    (window as any).setRfLedgerFilter("bank");
  });

  // EXPORT LEDGER trigger
  document.getElementById("btn-rf-export-ledger")?.addEventListener("click", () => {
    (window as any).triggerSalaryReportGenerate();
  });

  // WATCH FOR SETTLEMENT REQUESTS
  onValue(ref(db, "settlementRequests"), (snapshot) => {
    settlementRequestsCache = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        settlementRequestsCache.push({
          key: child.key,
          ...child.val()
        });
      });
    }
    settlementRequestsCache.sort((a,b) => b.createdAt - a.createdAt);
    (window as any).recalculateAndRenderFinanceDashboard();
  });

  // WATCH FOR COD DEPOSITS
  onValue(ref(db, "cod_deposits"), (snapshot) => {
    codDepositsCache = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        codDepositsCache.push({
          key: child.key,
          ...child.val()
        });
      });
    }
    codDepositsCache.sort((a,b) => b.createdAt - a.createdAt);
    (window as any).recalculateAndRenderFinanceDashboard();
  });

  // Process Payout Form Dialog
  const payoutForm = document.getElementById("form-rf-process-payout");
  payoutForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    processFastRiderPayout();
  });

  // Payout Modal Close
  document.getElementById("btn-close-rf-payout-modal")?.addEventListener("click", () => {
    document.getElementById("rf-payout-modal")?.classList.add("hidden");
  });
}

function processFastRiderPayout() {
  const riderId = (document.getElementById("rf-payout-rider-id") as HTMLInputElement).value;
  const name = document.getElementById("rf-payout-rider-name")?.innerText || "Rider Partner";
  const amount = Number((document.getElementById("rf-payout-amount") as HTMLInputElement).value.trim());
  const method = (document.getElementById("rf-payout-method") as HTMLInputElement).value;
  const target = (document.getElementById("rf-payout-target") as HTMLInputElement).value.trim();
  const utr = (document.getElementById("rf-payout-utr") as HTMLInputElement).value.trim();

  if (!riderId) return;

  if (amount <= 0) {
    showToast("Disbursement requires a positive amount transfer.", "error");
    return;
  }

  if (!utr) {
    showToast("UTR transaction reference number is required.", "error");
    return;
  }

  showToast("Registering transaction record...", "info");
  const claimId = "CLAIM_ADMIN_" + Date.now();

  const payoutPayload = {
    claimId,
    riderId,
    riderName: name,
    amount,
    upiId: target,
    paymentMethod: method === 'upi' ? 'UPI' : 'Bank Transfer',
    status: "approved",
    createdAt: Date.now(),
    approvedAt: Date.now(),
    utrNumber: utr.toUpperCase()
  };

  set(ref(db, `settlementRequests/${claimId}`), payoutPayload).then(() => {
    set(ref(db, `settlements/${riderId}/${claimId}`), payoutPayload).then(() => {
      showToast("Rider salary disbursed and recorded in database ledger!", "success");
      document.getElementById("rf-payout-modal")?.classList.add("hidden");
    });
  }).catch((err) => {
    console.error(err);
    showToast("Sync fail recording ledger entries.", "error");
  });
}

Object.assign(window, {
  recalculateAndRenderFinanceDashboard() {
    let totalRiderEarnings = 0;
    let totalCodCollected = 0;
    let totalCodDeposited = 0;
    let totalPendingSalary = 0;
    let totalPaidSalary = 0;

    const riderEarningsMap: { [riderId: string]: number } = {};
    const riderCodHandledMap: { [riderId: string]: number } = {};
    const riderApprovedDepositsMap: { [riderId: string]: number } = {};
    const riderPaidClaimsMap: { [riderId: string]: number } = {};
    const riderPendingClaimsMap: { [riderId: string]: number } = {};

    ordersCache.forEach((order: any) => {
      if (order.status === "delivered" && order.deliveryId) {
        const rId = order.deliveryId;
        const earningsValue = order.deliveryCharge || 40;
        totalRiderEarnings += earningsValue;
        riderEarningsMap[rId] = (riderEarningsMap[rId] || 0) + earningsValue;

        if (order.paymentMethod === "cod") {
          const codVal = Number(order.payableAmount || order.totalAmount || order.total || 0);
          totalCodCollected += codVal;
          riderCodHandledMap[rId] = (riderCodHandledMap[rId] || 0) + codVal;
        }
      }
    });

    codDepositsCache.forEach((dep) => {
      if (dep.status === "approved" || dep.status === "completed" || dep.status === "success") {
        const amt = Number(dep.amount || 0);
        totalCodDeposited += amt;
        riderApprovedDepositsMap[dep.riderId] = (riderApprovedDepositsMap[dep.riderId] || 0) + amt;
      }
    });

    settlementRequestsCache.forEach((req) => {
      const amt = Number(req.amount || 0);
      if (req.status === "approved" || req.status === "completed" || req.status === "success") {
        totalPaidSalary += amt;
        riderPaidClaimsMap[req.riderId] = (riderPaidClaimsMap[req.riderId] || 0) + amt;
      } else if (req.status === "pending") {
        totalPendingSalary += amt;
        riderPendingClaimsMap[req.riderId] = (riderPendingClaimsMap[req.riderId] || 0) + amt;
      }
    });

    const elTotalEarnings = document.getElementById("rf-stat-total-earnings");
    if (elTotalEarnings) elTotalEarnings.innerText = `₹${totalRiderEarnings}`;

    const elCodCollected = document.getElementById("rf-stat-cod-collected");
    const codOnHand = Math.max(0, totalCodCollected - totalCodDeposited);
    if (elCodCollected) elCodCollected.innerText = `₹${codOnHand}`;

    const elCodDeposited = document.getElementById("rf-stat-cod-deposited");
    if (elCodDeposited) elCodDeposited.innerText = `₹${totalCodDeposited}`;

    const elPendingSalary = document.getElementById("rf-stat-pending-salary");
    if (elPendingSalary) elPendingSalary.innerText = `₹${totalPendingSalary}`;

    const elPaidSalary = document.getElementById("rf-stat-paid-salary");
    if (elPaidSalary) elPaidSalary.innerText = `₹${totalPaidSalary}`;

    let activeClaimsCount = settlementRequestsCache.filter((r) => r.status === "pending").length;
    const elAlertBadge = document.getElementById("rf-pending-alerts-badge");
    if (elAlertBadge) {
      elAlertBadge.innerText = `${activeClaimsCount} Active Claims`;
      elAlertBadge.className = `text-[9px] px-1.5 py-0.5 rounded-md font-bold mt-2 w-max text-[8px] ${
        activeClaimsCount > 0 ? "bg-rose-100 text-rose-700 animate-pulse" : "bg-rose-50 text-rose-600"
      }`;
    }

    const bCountClaims = document.getElementById("badge-count-pending-claims");
    if (bCountClaims) {
      if (activeClaimsCount > 0) {
        bCountClaims.innerText = activeClaimsCount.toString();
        bCountClaims.classList.remove("hidden");
      } else {
        bCountClaims.classList.add("hidden");
      }
    }

    let activeDepositsCount = codDepositsCache.filter((d) => d.status === "pending").length;
    const bCountDeposits = document.getElementById("badge-count-pending-deposits");
    if (bCountDeposits) {
      if (activeDepositsCount > 0) {
        bCountDeposits.innerText = activeDepositsCount.toString();
        bCountDeposits.classList.remove("hidden");
      } else {
        bCountDeposits.classList.add("hidden");
      }
    }

    const alertBanner = document.getElementById("rf-pending-alerts-banner");
    let someRiderWithHighCod = ridersCache.some((r) => {
      const collected = riderCodHandledMap[r.uid] || 0;
      const deposited = riderApprovedDepositsMap[r.uid] || 0;
      return (collected - deposited) >= 5000;
    });

    if (alertBanner) {
      if (activeClaimsCount > 0 || activeDepositsCount > 0 || someRiderWithHighCod) {
        alertBanner.classList.remove("hidden");
      } else {
        alertBanner.classList.add("hidden");
      }
    }

    renderRidersPayrollTable(riderEarningsMap, riderApprovedDepositsMap, riderPaidClaimsMap, riderPendingClaimsMap, riderCodHandledMap);
    renderSalaryLedgerRecords();
    renderRiderSettlementClaims();
    renderCodReconciliationTable(riderCodHandledMap, riderApprovedDepositsMap);
    renderPendingCODDeposits();
  },

  setRfLedgerFilter(filter: string) {
    rfLedgerFilter = filter;
    
    document.querySelectorAll(".rf-ledger-filter-btn").forEach((btn) => {
      btn.classList.remove("bg-slate-900", "text-white", "border-transparent");
      btn.classList.add("bg-white", "border", "border-slate-200", "text-slate-600", "hover:bg-slate-50");
    });
    
    const term = `rf-ledger-filter-${filter}`;
    const activeBtn = document.getElementById(term);
    if (activeBtn) {
      activeBtn.className = "rf-ledger-filter-btn bg-slate-900 text-white px-2 py-1 rounded-md text-[8.5px] font-black uppercase transition-all tracking-wide border border-transparent cursor-pointer";
    }

    renderSalaryLedgerRecords();
  },

  triggerOneClickPayout(riderId: string, riderName: string, maxWithdrawable: number, upiId: string) {
    const inpRiderId = document.getElementById("rf-payout-rider-id") as HTMLInputElement;
    if (inpRiderId) inpRiderId.value = riderId;

    const lblRiderName = document.getElementById("rf-payout-rider-name");
    if (lblRiderName) lblRiderName.innerText = riderName;

    const lblRiderSub = document.getElementById("rf-payout-rider-sub");
    if (lblRiderSub) lblRiderSub.innerText = `Pending balance available: ₹${maxWithdrawable}`;

    const inpAmount = document.getElementById("rf-payout-amount") as HTMLInputElement;
    if (inpAmount) {
      inpAmount.value = maxWithdrawable > 0 ? maxWithdrawable.toString() : "0";
      inpAmount.max = maxWithdrawable.toString();
    }

    const inpTarget = document.getElementById("rf-payout-target") as HTMLInputElement;
    if (inpTarget) inpTarget.value = upiId || "";

    const inpUtr = document.getElementById("rf-payout-utr") as HTMLInputElement;
    if (inpUtr) inpUtr.value = "";

    const modal = document.getElementById("rf-payout-modal");
    if (modal) {
      modal.classList.remove("hidden");
    }
  },

  triggerSalaryReportGenerate() {
    const successes = settlementRequestsCache.filter((r) => r.status === "approved" || r.status === "completed" || r.status === "success");
    if (successes.length === 0) {
      showToast("No cleared disbursed payout ledger history available to export.", "info");
      return;
    }

    let csvContent = "MedsHub Rider Salary Report\nGenerated on: " + new Date().toISOString() + "\n\n";
    csvContent += "Payout Date,Claim ID,Rider Name,Disbursed Amount (₹),Disbursal Pipeline,Target VPA/Details,UTR Transaction ID\n";
    
    successes.forEach((r) => {
      const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "N/A";
      csvContent += `"${dateStr}","${r.claimId || r.key}","${r.riderName || 'Rider'}",${r.amount},"${r.paymentMethod || 'UPI'}","${r.upiId || ''}","${r.utrNumber || 'N/A'}"\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `medshub_salary_report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("MedsHub Salary CSV Report exported and downloaded successfully!", "success");
  },

  approveRiderSettlementDialog(claimId: string, riderId: string, amount: number, upiId: string) {
    const utrVal = prompt(`Processing Settlement Approval (#${claimId})\nPayout: ₹${amount} to ${upiId}\n\nREQUIRED: Input the formal bank/UPI transaction Reference UTR number:`);
    if (utrVal === null) return;
    const cleanedUtr = utrVal.trim().toUpperCase();
    if (!cleanedUtr) {
      showToast("A valid transaction UTR Reference is required to settle claims.", "error");
      return;
    }

    showToast("Recording approval status...", "info");
    const updatePayload = {
      status: "approved",
      utrNumber: cleanedUtr,
      approvedAt: Date.now()
    };

    update(ref(db, `settlementRequests/${claimId}`), updatePayload).then(() => {
      update(ref(db, `settlements/${riderId}/${claimId}`), updatePayload).then(() => {
        showToast("Payout Settlement Claim approved and verified successfully!", "success");
      });
    }).catch((err) => {
      console.error(err);
      showToast("Failed to write to Firebase.", "error");
    });
  },

  rejectRiderSettlementDialog(claimId: string, riderId: string) {
    const reason = prompt("Enter specific grounds/reason for rejecting this settlement:");
    if (reason === null) return;
    const cleanedReason = reason.trim();
    if (!cleanedReason) {
      showToast("Rejection requires grounds/reason.", "error");
      return;
    }

    const updatePayload = {
      status: "rejected",
      rejectionReason: cleanedReason,
      rejectedAt: Date.now()
    };

    update(ref(db, `settlementRequests/${claimId}`), updatePayload).then(() => {
      update(ref(db, `settlements/${riderId}/${claimId}`), updatePayload).then(() => {
        showToast("Payout Settlement Claim successfully rejected.", "info");
      });
    }).catch((err) => {
      console.error(err);
      showToast("Firebase transaction failed.", "error");
    });
  },

  approveCodDepositReceipt(depositId: string, riderId: string, amount: number) {
    if (confirm(`Approve COD Cash deposit claim of ₹${amount} for this rider?`)) {
      showToast("Recording approval status...", "info");
      
      const updatePayload = {
        status: "approved",
        approvedAt: Date.now()
      };

      update(ref(db, `cod_deposits/${depositId}`), updatePayload).then(() => {
        update(ref(db, `deliveryboy1/${riderId}/cod_deposits/${depositId}`), updatePayload).then(() => {
          showToast("Deposit receipt approved! Outstanding pocket balances decremented.", "success");
        });
      }).catch((err) => {
        console.error(err);
        showToast("Synchronization failure.", "error");
      });
    }
  },

  rejectCodDepositReceipt(depositId: string, riderId: string, amount: number) {
    const reason = prompt(`Enter specific reason for rejecting this COD deposit receipt of ₹${amount}:`);
    if (reason === null) return;
    const cleanedReason = reason.trim();
    if (!cleanedReason) {
      showToast("Rejection grounds required.", "error");
      return;
    }

    const updatePayload = {
      status: "rejected",
      rejectionReason: cleanedReason,
      rejectedAt: Date.now()
    };

    update(ref(db, `cod_deposits/${depositId}`), updatePayload).then(() => {
      update(ref(db, `deliveryboy1/${riderId}/cod_deposits/${depositId}`), updatePayload).then(() => {
        showToast("Deposit receipt successfully marked as rejected.", "info");
      });
    }).catch((err) => {
      console.error(err);
      showToast("Synchronization failure.", "error");
    });
  }
});

function getRidersEarningsMap() {
  const map: { [id: string]: number } = {};
  ordersCache.forEach((order: any) => {
    if (order.status === "delivered" && order.deliveryId) {
      map[order.deliveryId] = (map[order.deliveryId] || 0) + (order.deliveryCharge || 40);
    }
  });
  return map;
}

function getRidersApprovedDepositsMap() {
  const map: { [id: string]: number } = {};
  codDepositsCache.forEach((d) => {
    if (d.status === "approved" || d.status === "completed" || d.status === "success") {
      map[d.riderId] = (map[d.riderId] || 0) + Number(d.amount || 0);
    }
  });
  return map;
}

function getRidersPendingClaimsMap() {
  const map: { [id: string]: number } = {};
  settlementRequestsCache.forEach((req) => {
    if (req.status === "pending") {
      map[req.riderId] = (map[req.riderId] || 0) + Number(req.amount || 0);
    }
  });
  return map;
}

function getRidersPaidClaimsMap() {
  const map: { [id: string]: number } = {};
  settlementRequestsCache.forEach((req) => {
    if (req.status === "approved" || req.status === "completed" || req.status === "success") {
      map[req.riderId] = (map[req.riderId] || 0) + Number(req.amount || 0);
    }
  });
  return map;
}

function getRidersCodHandledMap() {
  const map: { [id: string]: number } = {};
  ordersCache.forEach((order: any) => {
    if (order.status === "delivered" && order.deliveryId && order.paymentMethod === "cod") {
      const amt = Number(order.payableAmount || order.totalAmount || order.total || 0);
      map[order.deliveryId] = (map[order.deliveryId] || 0) + amt;
    }
  });
  return map;
}

// =================================== RENDER ROUTINES DEFINITIONS ===================================
renderRidersPayrollTable = function(
  earningsMap: { [uid: string]: number } = {},
  approvedDeposits: { [uid: string]: number } = {},
  paidClaims: { [uid: string]: number } = {},
  pendingClaims: { [uid: string]: number } = {},
  codHandledMap: { [uid: string]: number } = {}
) {
  const tbody = document.getElementById("tbody-rf-riders-payroll");
  if (!tbody) return;

  if (ridersCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold uppercase text-[10px]">No registered riders found.</td></tr>`;
    return;
  }

  const calcEarnings = Object.keys(earningsMap).length ? earningsMap : getRidersEarningsMap();
  const calcApprovedDeposits = Object.keys(approvedDeposits).length ? approvedDeposits : getRidersApprovedDepositsMap();
  const calcPaidClaims = Object.keys(paidClaims).length ? paidClaims : getRidersPaidClaimsMap();
  const calcPendingClaims = Object.keys(pendingClaims).length ? pendingClaims : getRidersPendingClaimsMap();

  let filteredRiders = ridersCache;
  if (rfRiderSearchQuery) {
    filteredRiders = ridersCache.filter((r) => (r.name || "").toLowerCase().includes(rfRiderSearchQuery));
  }

  tbody.innerHTML = filteredRiders.map((r) => {
    const uid = r.uid || r.deliveryId;
    const name = r.name || "Express Rider Partner";
    const shortId = uid ? uid.substring(0, 6).toUpperCase() : "N/A";

    const allTimeEarnings = calcEarnings[uid] || 0;
    const paidSalary = calcPaidClaims[uid] || 0;
    const pendingSalary = calcPendingClaims[uid] || 0;

    const currentPendingWithmedshub = Math.max(0, allTimeEarnings - paidSalary - pendingSalary);
    const email = r.email || "No Email Registered";

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-all font-semibold text-xs text-slate-700">
        <td class="p-4 flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-70 shrink-0 border border-slate-100 flex items-center justify-center font-black">
            <i class="fa-solid fa-motorcycle text-indigo-500"></i>
          </div>
          <div>
            <h4 class="font-bold text-slate-900">${name}</h4>
            <div class="text-[9px] text-slate-400 mt-0.5 font-mono">ID: ${shortId} | Email: ${email}</div>
          </div>
        </td>
        <td class="p-4">
          <span class="bg-indigo-50 text-indigo-705 text-indigo-700 px-2 py-0.5 rounded font-black text-[9px] uppercase">${r.totalDeliveries || 0} Delivered</span>
        </td>
        <td class="p-4 font-mono font-bold text-teal-700 font-sans">₹${allTimeEarnings}</td>
        <td class="p-4 font-mono text-emerald-700 font-sans">₹${paidSalary}</td>
        <td class="p-4 font-mono">
          <div class="font-extrabold text-indigo-600 font-sans">₹${currentPendingWithmedshub}</div>
          ${pendingSalary > 0 ? `<div class="text-[8px] text-amber-500 font-sans mt-0.5 font-bold uppercase"><i class="fa-solid fa-hourglass-half"></i> ₹${pendingSalary} claim pending</div>` : ""}
        </td>
        <td class="p-4 text-center">
          <button onclick="triggerOneClickPayout('${uid}', '${name.replace(/'/g, "\\'")}', ${currentPendingWithmedshub}, '${r.upiId || ""}')" class="bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-[9px] px-2.5 py-1.5 rounded-lg border border-transparent transition-all uppercase cursor-pointer tracking-wider">
            <i class="fa-solid fa-indian-rupee-sign mr-1"></i>Pay Rider
          </button>
        </td>
      </tr>
    `;
  }).join("");
};

renderSalaryLedgerRecords = function() {
  const container = document.getElementById("rf-salary-ledger-list");
  if (!container) return;

  const disbursedPayouts = settlementRequestsCache.filter((req) => {
    const isSuccess = req.status === "approved" || req.status === "completed" || req.status === "success";
    if (!isSuccess) return false;
    
    if (rfLedgerFilter === "upi") {
      return (req.paymentMethod || "UPI").toUpperCase() === "UPI";
    } else if (rfLedgerFilter === "bank") {
      return (req.paymentMethod || "").toUpperCase().includes("BANK");
    }
    return true;
  });

  if (disbursedPayouts.length === 0) {
    container.innerHTML = `<p class="text-[9px] text-slate-400 font-bold text-center py-6 uppercase font-mono tracking-wide">No ledger records tracked</p>`;
    return;
  }

  container.innerHTML = disbursedPayouts.map((req) => {
    const dateFormatted = req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "N/A";
    
    return `
      <div class="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs space-y-1.5 flex flex-col font-semibold">
        <div class="flex items-center justify-between">
          <strong class="text-slate-800">${req.riderName || "Rider"}</strong>
          <span class="text-[8px] font-bold text-indigo-700 bg-indigo-50/70 border border-indigo-100/50 px-1 py-0.2 rounded uppercase">${req.paymentMethod || "UPI"}</span>
        </div>
        <div class="flex items-center justify-between mt-0.5 text-[10px]">
          <span class="text-slate-400 font-mono">${dateFormatted}</span>
          <span class="font-extrabold text-emerald-700 font-mono">₹${req.amount}</span>
        </div>
        <div class="border-t border-slate-200/50 pt-1.5 flex items-center justify-between text-[9px] text-slate-500 font-mono flex-wrap gap-1">
          <div>Ref: #${req.claimId ? req.claimId.substring(req.claimId.length-6).toUpperCase() : "AA"}</div>
          <div class="font-black text-slate-700">UTR: <strong class="text-indigo-600 font-extrabold select-all">${req.utrNumber || "N/A"}</strong></div>
        </div>
      </div>
    `;
  }).join("");
};

renderRiderSettlementClaims = function() {
  const tbody = document.getElementById("tbody-rf-settlement-requests");
  if (!tbody) return;

  if (settlementRequestsCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 font-bold uppercase text-[10px]">No withdrawal claims registered.</td></tr>`;
    return;
  }

  tbody.innerHTML = settlementRequestsCache.map((req) => {
    let statBadge = `<span class="bg-amber-100 text-amber-800 text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-wider">Awaiting Verification</span>`;
    if (req.status === "approved" || req.status === "completed" || req.status === "success") {
      statBadge = `<span class="bg-emerald-50 text-emerald-800 text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-wider border border-emerald-100">Disbursed</span>`;
    } else if (req.status === "rejected") {
      statBadge = `<span class="bg-rose-50 text-rose-700 text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-wider">Rejected</span>`;
    }

    const claimId = req.claimId || "CLAIM_N/A";
    const shortRef = claimId.substring(claimId.length-8).toUpperCase();
    const dateStr = req.createdAt ? new Date(req.createdAt).toLocaleString("en-US", { hour12: false }) : "N/A";

    const isPending = req.status === "pending";

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-all font-semibold text-xs text-slate-700">
        <td class="p-4 font-bold text-slate-900 font-mono">#${shortRef}</td>
        <td class="p-4">
          <div class="font-bold text-slate-900">${req.riderName || "Express Rider Partner"}</div>
          <span class="text-[9px] text-slate-400 font-mono">${req.riderEmail || ""}</span>
        </td>
        <td class="p-4 text-rose-600 font-mono font-extrabold text-sm">₹${req.amount}</td>
        <td class="p-4">
          <div class="font-mono text-slate-800 select-all font-bold text-xs">${req.upiId || "N/A"}</div>
          ${req.qrCodeUrl ? `<a href="${req.qrCodeUrl}" target="_blank" class="text-indigo-500 hover:underline mt-0.5 block text-[9px] font-bold"><i class="fa-solid fa-qrcode"></i> Display VPA QR Code</a>` : ""}
        </td>
        <td class="p-4 text-slate-400 font-mono text-[10px]">${dateStr}</td>
        <td class="p-4">${statBadge}</td>
        <td class="p-4 text-right">
          ${isPending ? `
            <div class="flex items-center justify-end gap-1.5">
              <button onclick="approveRiderSettlementDialog('${claimId}', '${req.riderId}', ${req.amount}, '${req.upiId || ""}')" class="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[9px] px-2.5 py-1.5 rounded-lg active:scale-95 transition-all shadow-xs cursor-pointer uppercase flex items-center gap-1">
                <i class="fa-solid fa-money-bill-transfer"></i> Approve
              </button>
              <button onclick="rejectRiderSettlementDialog('${claimId}', '${req.riderId}')" class="bg-rose-550 bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold text-[9px] px-2.5 py-1.5 rounded-lg active:scale-95 transition-all border border-rose-100 cursor-pointer uppercase">
                Reject
              </button>
            </div>
          ` : `
            ${req.utrNumber ? `<div class="text-[10px] text-slate-550 mr-1 font-mono font-bold">UTR: <strong class="text-indigo-600">${req.utrNumber}</strong></div>` : `<i class="fa-solid fa-check-double text-slate-400"></i>`}
          `}
        </td>
      </tr>
    `;
  }).join("");
};

renderCodReconciliationTable = function(
  riderCodHandledLocal: { [uid: string]: number } = {},
  approvedDepositsLocal: { [uid: string]: number } = {}
) {
  const tbody = document.getElementById("tbody-rf-cod-reconciliation");
  if (!tbody) return;

  if (ridersCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold uppercase text-[10px]">No riders.</td></tr>`;
    return;
  }

  const calcCodHandled = Object.keys(riderCodHandledLocal).length ? riderCodHandledLocal : getRidersCodHandledMap();
  const calcApprovedDeposits = Object.keys(approvedDepositsLocal).length ? approvedDepositsLocal : getRidersApprovedDepositsMap();

  tbody.innerHTML = ridersCache.map((r) => {
    const uid = r.uid || r.deliveryId;
    const name = r.name || "Express Rider Partner";

    const codCount = ordersCache.filter((o: any) => o.status === "delivered" && o.deliveryId === uid && o.paymentMethod === "cod").length;
    const collected = calcCodHandled[uid] || 0;
    const deposited = calcApprovedDeposits[uid] || 0;
    
    const cashOnHand = Math.max(0, collected - deposited);

    let riskBadge = `<span class="bg-emerald-50 text-emerald-700 text-[8.5px] px-2 py-0.5 rounded-lg border border-emerald-100 font-black uppercase">SAFE LIMIT</span>`;
    if (cashOnHand >= 5000) {
      riskBadge = `<span class="bg-rose-50 text-rose-750 text-[8.5px] px-2 py-0.5 rounded-lg border border-rose-100 font-black uppercase animate-bounce text-rose-700">ALERT EXCEEDED</span>`;
    } else if (cashOnHand > 0) {
      riskBadge = `<span class="bg-amber-50 text-amber-700 text-[8.5px] px-2 py-0.5 rounded-lg border border-amber-100 font-black uppercase">HELD POCKET</span>`;
    }

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-all text-slate-700 font-semibold text-xs">
        <td class="p-4 flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs text-slate-500 font-black"><i class="fa-solid fa-money-bill"></i></div>
          <div>
            <h4 class="font-bold text-slate-900">${name}</h4>
            <span class="text-[9px] text-slate-400 font-mono">Mobile: ${r.mobile || "N/A"}</span>
          </div>
        </td>
        <td class="p-4 font-mono font-bold text-[11px]">${codCount} COD Delivered</td>
        <td class="p-4 font-mono font-bold text-slate-800">₹${collected}</td>
        <td class="p-4 font-mono font-bold text-emerald-700">₹${deposited}</td>
        <td class="p-4 font-mono">
          <strong class="${cashOnHand >= 5000 ? "text-rose-600 font-black text-xs" : cashOnHand > 0 ? "text-amber-600 font-bold" : "text-slate-400"}">₹${cashOnHand}</strong>
        </td>
        <td class="p-4">${riskBadge}</td>
      </tr>
    `;
  }).join("");
};

renderPendingCODDeposits = function() {
  const container = document.getElementById("rf-pending-deposits-list");
  if (!container) return;

  const pendingDeposits = codDepositsCache.filter((d) => d.status === "pending");

  if (pendingDeposits.length === 0) {
    container.innerHTML = `
      <div class="bg-slate-50 border border-slate-100 rounded-2xl p-6 text-center text-slate-400 font-semibold text-xs py-10">
        <i class="fa-solid fa-square-check text-2xl text-slate-300 mb-2"></i>
        <p class="uppercase font-extrabold text-[9px] tracking-wide">All Rider Deposits Reconciled!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = pendingDeposits.map((d) => {
    const formattedDate = d.createdAt ? new Date(d.createdAt).toLocaleString("en-US", { hour12: false }) : "N/A";
    const depositId = d.depositId || d.key;

    const imgHtml = d.screenshotUrl ? `
      <div class="relative group mt-2 max-w-full">
        <a href="${d.screenshotUrl}" target="_blank" class="block rounded-xl overflow-hidden border border-slate-200 cursor-zoom-in group-hover:opacity-90 transition-opacity">
          <img src="${d.screenshotUrl}" alt="Deposit Screenshot Proof" class="w-full max-h-36 object-cover" referrerPolicy="no-referrer">
          <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-[9px] font-black uppercase"><i class="fa-solid fa-expand mr-1"></i> VIEW RECORD SCREENSHOT</div>
        </a>
      </div>
    ` : `<p class="text-[8.5px] text-rose-500 font-bold mt-1 uppercase"><i class="fa-solid fa-circle-exclamation"></i> No image attached</p>`;

    return `
      <div class="bg-amber-50/45 border border-amber-100/70 rounded-2xl p-4 text-xs font-semibold space-y-3 shadow-xs">
        <div class="flex items-center justify-between">
          <div>
            <strong class="text-slate-800 text-xs">${d.riderName || "Rider"}</strong>
            <p class="text-[9px] text-slate-400 font-mono mt-0.5">${formattedDate}</p>
          </div>
          <span class="bg-amber-100 text-amber-700 font-bold text-[8px] px-1.5 py-0.5 rounded uppercase">Under Review</span>
        </div>

        <div class="bg-white border border-slate-100 rounded-xl p-2.5 flex items-center justify-between font-mono">
          <span class="text-[9.5px] text-slate-500 uppercase font-sans">Deposit Sum</span>
          <strong class="text-emerald-700 text-xs font-bold">₹${d.amount}</strong>
        </div>

        <div class="text-[9.5px] font-mono text-slate-800 bg-white border border-slate-100 rounded-xl p-2 flex items-center justify-between">
          <span>UTR Submitted:</span>
          <strong class="text-indigo-650 font-bold uppercase">${d.utrNumber || "N/A"}</strong>
        </div>

        ${imgHtml}

        <div class="grid grid-cols-2 gap-2 pt-1 border-t border-dashed border-slate-200">
          <button onclick="approveCodDepositReceipt('${depositId}', '${d.riderId}', ${d.amount})" class="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[8.5px] py-2 rounded-lg active:scale-95 transition-all shadow-xs cursor-pointer uppercase flex items-center justify-center gap-1">
            <i class="fa-solid fa-check"></i> Approve
          </button>
          <button onclick="rejectCodDepositReceipt('${depositId}', '${d.riderId}', ${d.amount})" class="bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold text-[8.5px] py-2 rounded-lg active:scale-95 transition-all border border-rose-100 cursor-pointer uppercase">
            Reject
          </button>
        </div>
      </div>
    `;
  }).join("");
};


