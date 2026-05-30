import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, update, remove, get } from "firebase/database";
import { showToast, uploadToCloudinary, getRouteMapUrl, getStaticMapUrl } from "./utils";

// Core Variables
let activeSection = "panel-overview";
let systemTimeInterval: any = null;

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
    let clients = 0;
    let total = 0;
    const items: any[] = [];
    snapshot.forEach((child) => {
      total++;
      const u = child.val();
      if (u.role === "user") {
        clients++;
        items.push(u);
      }
    });

    document.getElementById("stat-users")!.innerText = clients.toString();
    renderCustomersTable(items);
  });

  onValue(ref(db, "stores"), (snapshot) => {
    let active = 0;
    let total = 0;
    const items: any[] = [];

    snapshot.forEach((child) => {
      total++;
      const s = child.val();
      if (s.active) active++;
      items.push(s);
    });

    document.getElementById("stat-stores")!.innerText = total.toString();
    document.getElementById("stat-stores-active")!.innerText = `${active} Active Nodes`;
    document.getElementById("cnt-stores")!.innerText = `${total} Stores`;
    renderStoresTable(items);
    updateGeoapifyAdminMap(items);
  });

  onValue(ref(db, "delivery"), (snapshot) => {
    let active = 0;
    let total = 0;
    const items: any[] = [];

    snapshot.forEach((child) => {
      total++;
      const d = child.val();
      if (d.active) active++;
      items.push(d);
    });

    document.getElementById("stat-delivery")!.innerText = total.toString();
    document.getElementById("stat-delivery-active")!.innerText = `${active} Active Riders`;
    document.getElementById("cnt-riders")!.innerText = `${total} Riders`;
    renderRidersTable(items);
  });
}

// 2. PARTNERS TABLES RENDERING
function renderStoresTable(stores: any[]) {
  const tbody = document.getElementById("tbody-stores")!;
  if (stores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400 font-medium">No pharmacy nodes registered yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = stores.map((s) => `
    <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-all font-medium">
      <td class="px-5 py-3">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded bg-sky-50 text-sky-600 flex items-center justify-center text-xs font-bold border border-sky-100">
            <i class="fa-solid fa-mortar-pestle"></i>
          </div>
          <div>
            <h4 class="font-bold text-slate-900">${s.name}</h4>
            <span class="text-[10px] text-slate-400 font-mono">${s.storeId.substring(0,6)}...</span>
          </div>
        </div>
      </td>
      <td class="px-5 py-3">
        <div class="text-xs font-semibold">${s.ownerName || "No Owner"}</div>
        <div class="text-[11px] text-slate-400 font-mono">${s.email} | ${s.mobile}</div>
      </td>
      <td class="px-5 py-3">
        <span class="bg-indigo-50 text-indigo-700 text-[10px] px-2 py-0.5 rounded font-black uppercase">${s.city || "Bengaluru"}</span>
      </td>
      <td class="px-5 py-3">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${s.approved ? "bg-emerald-50 text-emerald-700" : "bg-yellow-50 text-yellow-700"}">
            ${s.approved ? "Approved" : "Pending Approval"}
          </span>
          <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${s.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}">
            ${s.active ? "Active" : "Deactivated"}
          </span>
        </div>
      </td>
      <td class="px-5 py-3 text-right space-x-1.5">
        ${!s.approved ? `
          <button onclick="approveStore('${s.storeId}')" class="bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all">Approve</button>
          <button onclick="rejectStore('${s.storeId}')" class="bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all">Reject</button>
        `: `
          <button onclick="toggleStoreActive('${s.storeId}', ${s.active})" class="text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all border ${s.active ? "border-slate-200 text-slate-600 bg-white hover:bg-slate-50" : "bg-emerald-500 text-white border-transparent hover:bg-emerald-600"}">
            ${s.active ? "Deactivate" : "Activate"}
          </button>
        `}
      </td>
    </tr>
  `).join("");
}

function renderRidersTable(riders: any[]) {
  const tbody = document.getElementById("tbody-riders")!;
  if (riders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400 font-medium">No riders registered yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = riders.map((r) => `
    <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-all font-medium">
      <td class="px-5 py-3 flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center text-xs border border-amber-100">
          <i class="fa-solid fa-user-ninja"></i>
        </div>
        <div>
          <h4 class="font-bold text-slate-900">${r.name}</h4>
          <span class="text-[10px] text-slate-400 font-mono">Rider ID: ${r.deliveryId.substring(0,6)}</span>
        </div>
      </td>
      <td class="px-5 py-3">
        <div class="text-xs font-semibold">${r.mobile}</div>
        <div class="text-[10px] text-slate-400 font-mono">${r.email}</div>
      </td>
      <td class="px-5 py-3">
        <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${r.status === "busy" ? "bg-rose-50 text-rose-700 animate-pulse" : "bg-emerald-50 text-emerald-700"}">
          ${r.status === "busy" ? "On Duty" : "Standby/Free"}
        </span>
      </td>
      <td class="px-5 py-3">
        <div class="flex gap-1.5 flex-wrap">
          <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${r.approved ? "bg-emerald-100 text-emerald-800" : "bg-yellow-50 text-yellow-700"}">
            ${r.approved ? "Approved" : "Pending"}
          </span>
          <span class="text-[10px] px-2 py-0.5 rounded font-black uppercase ${r.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-50 text-slate-500"}">
            ${r.active ? "Active" : "Suspended"}
          </span>
        </div>
      </td>
      <td class="px-5 py-3 text-right space-x-1.5">
        ${!r.approved ? `
          <button onclick="approveRider('${r.deliveryId}')" class="bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all">Approve</button>
          <button onclick="rejectRider('${r.deliveryId}')" class="bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all">Reject</button>
        `: `
          <button onclick="toggleRiderActive('${r.deliveryId}', ${r.active})" class="text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all border ${r.active ? "border-slate-200 text-slate-600 bg-white hover:bg-slate-50" : "bg-emerald-500 text-white border-transparent hover:bg-emerald-600"}">
            ${r.active ? "Disable" : "Enable"}
          </button>
        `}
      </td>
    </tr>
  `).join("");
}

function renderCustomersTable(customers: any[]) {
  const tbody = document.getElementById("tbody-customers")!;
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
    update(ref(db, `delivery/${id}`), { approved: true });
    showToast("Rider approved!", "success");
  },
  rejectRider(id: string) {
    if (confirm("Reject and remove this rider profile?")) {
      remove(ref(db, `users/${id}`));
      remove(ref(db, `delivery/${id}`));
      showToast("Rider application deleted.", "info");
    }
  },
  toggleRiderActive(id: string, current: boolean) {
    update(ref(db, `delivery/${id}`), { active: !current });
    showToast(`Rider ${!current ? "enabled" : "disabled"}!`, "success");
  },
  toggleBlockCustomer(id: string, current: boolean) {
    update(ref(db, `users/${id}`), { isBlocked: !current });
    showToast(`User ${!current ? "blocked" : "unblocked"} successfully!`, "success");
  }
});

// 3. ORDERS REAL-TIME MONITORING
let ordersCache: OrderDetails[] = [];
let ordersFilter = "all";

function subscribeToOrders() {
  onValue(ref(db, "orders"), (snapshot) => {
    ordersCache = [];
    let completedEarnings = 0;
    let pendingCount = 0;
    
    snapshot.forEach((child) => {
      const order = child.val() as OrderDetails;
      ordersCache.push(order);

      if (order.status === "delivered") {
        // Earnings = platformFee (₹) + (subtotal * commissionRate / 100)
        completedEarnings += (order.platformFee || 5) + (order.subtotal * 0.10); // 10% standard admin fee
      } else {
        pendingCount++;
      }
    });

    document.getElementById("stat-orders")!.innerText = ordersCache.length.toString();
    document.getElementById("stat-orders-pending")!.innerText = `${pendingCount} Processing Deliveries`;
    document.getElementById("stat-earnings")!.innerText = `₹${Math.ceil(completedEarnings)}`;

    applyOrdersFilter();
    renderSettlementFinance();
    buildAnalyticsChart(ordersCache, completedEarnings);
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
  const container = document.getElementById("admin-orders-list")!;
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

    const modal = document.getElementById("invoice-modal")!;
    const content = document.getElementById("invoice-modal-content")!;
    
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
  document.getElementById("invoice-modal")!.classList.add("hidden");
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
  const tbody = document.getElementById("tbody-settlement-cod")!;
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
    const listEl = document.getElementById("warehouse-list-container")!;
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

Object.assign(window, {
  removeWarehouseNode(id: string) {
    if (confirm("Remove this warehouse profile?")) {
      remove(ref(db, `warehouses/${id}`))
        .then(() => showToast("Warehouse hub scrubbed.", "info"));
    }
  }
});

// 11. MAPS SYSTEM (Geoapify static tracker representation)
function updateGeoapifyAdminMap(stores: any[]) {
  const mapImg = document.getElementById("geoapify-admin-map") as HTMLImageElement;
  if (!mapImg) return;

  if (stores.length === 0) {
    mapImg.src = `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=800&height=320&center=lonlat:77.5946,12.9716&zoom=11&apiKey=a2f093c8994441179a2c1599f08f7386`;
    return;
  }

  // Draw pins representation on static maps for Geoapify
  const pins = stores.map((s, idx) => {
    const lat = s.location?.lat || 12.9716;
    const lng = s.location?.lng || 77.5946;
    return `lonlat:${lng},${lat};color:%233b82f6;size:medium;text:${idx+1}`;
  }).join("|");

  const centerStore = stores[0];
  const cLat = centerStore.location?.lat || 12.9716;
  const cLng = centerStore.location?.lng || 77.5946;

  document.getElementById("map-coordinates")!.innerText = `${centerStore.name} Area (${cLat.toFixed(4)}, ${cLng.toFixed(4)})`;
  mapImg.src = `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=800&height=320&center=lonlat:${cLng},${cLat}&zoom=12&marker=${pins}&apiKey=a2f093c8994441179a2c1599f08f7386`;
}
