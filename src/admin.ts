import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, update, remove, get } from "firebase/database";
import { showToast, uploadToCloudinary, getRouteMapUrl, getStaticMapUrl, loadMapplsScript, updateLeafletMap, calculateDistance } from "./utils";

// Core Variables
let activeSection = "panel-overview";
let systemTimeInterval: any = null;
let ridersCache: any[] = [];

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
  initNotificationsCenter();
  initReviewsComplaintsHub();
  initCloudinaryMediaHub();
  initPlatformSettings();

  // Connect customer search input field
  document.getElementById("user-search-input")?.addEventListener("input", (e) => {
    userSearchQuery = (e.target as HTMLInputElement).value;
    renderFilteredCustomers();
  });
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
          if (u && u.role === "user") {
            clients++;
            items.push(u);
          }
        });
      }

      const statUsers = document.getElementById("stat-users");
      if (statUsers) {
        statUsers.innerText = clients.toString();
      }
      renderCustomersTable(items);
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
      <td class="px-5 py-3 text-right">
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
      active: true
    }).then(() => {
      showToast("App promotional banner configured live!", "success");
      // Reset
      currentAdFile = null;
      (document.getElementById("form-banners") as HTMLFormElement).reset();
      document.getElementById("banner-upload-txt")!.innerText = "Select Banner from Device";
      document.getElementById("banner-upload-icon")!.className = "fa-solid fa-cloud-arrow-up text-2xl text-slate-400 mb-2";
    });
  } catch (error) {
    showToast("Banner upload failed", "error");
  }
});

function subscribeToBannersCoupons() {
  // Banner ads list
  onValue(ref(db, "banners"), (snapshot) => {
    const container = document.getElementById("banner-list-container")!;
    if (!snapshot.exists()) {
      container.innerHTML = `<p class="text-[11px] text-slate-400 py-3 text-center">No slider banners. Default banners will render.</p>`;
      return;
    }

    let html = "";
    snapshot.forEach((child) => {
      const b = child.val();
      html += `
        <div class="flex items-center gap-3 p-2 bg-slate-50 rounded-xl border border-slate-100 text-xs">
          <img src="${b.imageUrl}" class="w-14 h-8 object-cover rounded shadow-xs shrink-0">
          <div class="flex-1 truncate">
            <h5 class="font-bold text-slate-800">Redirect: <span class="text-indigo-600 font-mono text-[10px]">${b.redirectUrl || "None"}</span></h5>
            <p class="text-[10px] text-slate-400 font-mono">Weight: ${b.priority || 1}</p>
          </div>
          <button onclick="removeBanner('${b.bannerId}')" class="text-rose-500 hover:text-rose-700 cursor-pointer px-2"><i class="fa-regular fa-trash-can"></i></button>
        </div>
      `;
    });

    container.innerHTML = html;
  });

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
              <span class="bg-teal-50 text-teal-600 text-[10px] font-black tracking-wide px-2 py-0.5 rounded uppercase border border-teal-100">${cp.code}</span>
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
  removeBanner(key: string) {
    if (confirm("Delete this Cloudinary promo ad campaign?")) {
      remove(ref(db, `banners/${key}`))
        .then(() => showToast("Banner deleted", "info"));
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

function checkAndPreloadCategories() {
  get(ref(db, "categories")).then((snapshot) => {
    if (!snapshot.exists()) {
      const defaultCategories = {
        "ALL": { code: "ALL", name: "All Medicines", active: true },
        "DIABETES": { code: "DIABETES", name: "Diabetes Care", active: true },
        "HEART": { code: "HEART", name: "Heart Care", active: true },
        "BP": { code: "BP", name: "Blood Pressure", active: true },
        "ALLERGY": { code: "ALLERGY", name: "Allergy Relief", active: true },
        "COLD_FLU": { code: "COLD_FLU", name: "Cold & Flu", active: true },
        "FEVER": { code: "FEVER", name: "Fever Medicines", active: true },
        "PAIN": { code: "PAIN", name: "Pain Relief", active: true },
        "STOMACH": { code: "STOMACH", name: "Stomach Care", active: true },
        "DIGESTION": { code: "DIGESTION", name: "Digestion", active: true },
        "VITAMINS": { code: "VITAMINS", name: "Vitamins & Supplements", active: true },
        "IMMUNITY": { code: "IMMUNITY", name: "Immunity Boosters", active: true },
        "BABY_CARE": { code: "BABY_CARE", name: "Baby Care", active: true },
        "WOMEN_CARE": { code: "WOMEN_CARE", name: "Women's Care", active: true },
        "MEN_CARE": { code: "MEN_CARE", name: "Men's Care", active: true },
        "SENIOR_CARE": { code: "SENIOR_CARE", name: "Senior Citizen Care", active: true },
        "SKIN_CARE": { code: "SKIN_CARE", name: "Skin Care", active: true },
        "HAIR_CARE": { code: "HAIR_CARE", name: "Hair Care", active: true },
        "EYE_CARE": { code: "EYE_CARE", name: "Eye Care", active: true },
        "DENTAL": { code: "DENTAL", name: "Dental Care", active: true },
        "PERSONAL_CARE": { code: "PERSONAL_CARE", name: "Personal Care", active: true },
        "FIRST_AID": { code: "FIRST_AID", name: "First Aid", active: true },
        "MEDICAL_DEVICES": { code: "MEDICAL_DEVICES", name: "Medical Devices", active: true },
        "AYURVEDA": { code: "AYURVEDA", name: "Ayurveda", active: true },
        "HOMEOPATHY": { code: "HOMEOPATHY", name: "Homeopathy", active: true },
        "NUTRITION": { code: "NUTRITION", name: "Nutrition", active: true },
        "FITNESS": { code: "FITNESS", name: "Fitness & Wellness", active: true },
        "ORTHOPEDIC": { code: "ORTHOPEDIC", name: "Orthopedic Care", active: true },
        "RESPIRATORY": { code: "RESPIRATORY", name: "Respiratory Care", active: true }
      };
      set(ref(db, "categories"), defaultCategories).then(() => {
        showToast("Initial category catalogue seeded in Database!", "success");
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
        <td colspan="4" class="p-4 text-center text-slate-400 font-medium">No operational segments found.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = filtered.map(it => {
    const statusColor = it.active 
      ? "bg-emerald-50 text-emerald-600 border border-emerald-100" 
      : "bg-rose-50 text-rose-600 border border-rose-100";
    const statusText = it.active ? "Active" : "Inactive";
    const toggleIcon = it.active ? "fa-toggle-on text-emerald-500" : "fa-toggle-off text-slate-400";
    const toggleTitle = it.active ? "Deactivate Category" : "Activate Category";

    return `
      <tr class="hover:bg-slate-50/40 transition-colors border-b border-slate-100 font-sans">
        <td class="p-3 font-mono font-black text-slate-700 text-xs">${it.code}</td>
        <td class="p-3 font-bold text-slate-800 text-xs">${it.name}</td>
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

  const formCategory = document.getElementById("form-category") as HTMLFormElement;
  if (formCategory) {
    formCategory.addEventListener("submit", (e) => {
      e.preventDefault();
      
      const codeInput = document.getElementById("category-code") as HTMLInputElement;
      const nameInput = document.getElementById("category-name") as HTMLInputElement;
      const statusSelect = document.getElementById("category-status") as HTMLSelectElement;

      const codeRaw = codeInput.value.trim().toUpperCase();
      const code = codeRaw.replace(/[^A-Z0-9_]/g, "_");
      const name = nameInput.value.trim();
      const active = statusSelect.value === "active";

      if (!code || !name) {
        showToast("Operational segment Code and Name are both mandatory.", "error");
        return;
      }

      set(ref(db, `categories/${code}`), { code, name, active })
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
    const formTitle = document.getElementById("category-form-title")!;
    const btnCancel = document.getElementById("btn-cancel-category-edit")!;
    const codeLabel = codeInput?.parentElement?.querySelector("p")!;

    if (codeInput) {
      codeInput.value = code;
      codeInput.disabled = true; 
    }
    if (nameInput) nameInput.value = name;
    if (statusSelect) statusSelect.value = active ? "active" : "inactive";
    
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

  const name = r.name || "Anonymous Partner";
  const email = r.email || "N/A";
  const mobile = r.mobile || "N/A";
  const aadhaar = r.aadhaarNumber || "Not entered";
  const dlNumber = r.licenseNumber || "Not entered";
  const vehicleType = r.vehicleType || "Not specified";
  const vehicleNumber = r.vehicleNumber || "Not specified";
  const state = r.state || "Not specified";
  const district = r.district || "Not specified";
  const status = getRiderVerificationStatus(r);
  const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleString() : "N/A";
  const profilePic = r.profilePhotoUrl || r.photoUrl || "https://img.icons8.com/color/96/delivery-man.png";

  const aadFront = r.aadhaarFrontUrl || "";
  const aadBack = r.aadhaarBackUrl || "";
  const dlImage = r.licenseImageUrl || "";

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
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5 text-left text-xs bg-slate-50 p-5 rounded-2xl border border-slate-200">
      
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
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Registration Date</span>
            <span class="font-mono text-slate-700 block">${dateStr}</span>
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
      
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        
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

        <!-- Driving License Copy -->
        <div class="bg-white border border-slate-200 rounded-xl p-3 space-y-3 shadow-xs">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Driving License</span>
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
              <i class="fa-solid fa-expand mr-1"></i> View DL Button
            </button>
            <a href="${dlImage}" target="_blank" download class="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 p-1.5 rounded-lg transition-all flex items-center justify-center cursor-pointer" title="Download License Document Copy" ${!dlImage ? "style='pointer-events:none; opacity:0.5;'" : ""}>
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

