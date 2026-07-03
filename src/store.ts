import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, get, update, remove } from "firebase/database";
import { showToast, uploadToCloudinary, updateLeafletMap, calculateDistance } from "./utils";

// Core State variables
let loggedInMerchant: any = null;
let currentStoreId = "";
let currentStoreDetail: any = null;
let activeTab: "orders" | "inventory" | "profile" = "orders";
let currentStorePaymentsDetail: any = null;

// UI Buttons & Tabs references
const tabOrders = document.getElementById("tab-store-orders") as HTMLButtonElement;
const tabInventory = document.getElementById("tab-store-inventory") as HTMLButtonElement;
const tabProfile = document.getElementById("tab-store-profile") as HTMLButtonElement;

const sectionOrders = document.getElementById("section-store-orders") as HTMLDivElement;
const sectionInventory = document.getElementById("section-store-inventory") as HTMLDivElement;
const sectionProfile = document.getElementById("section-store-profile") as HTMLDivElement;

let logoFile: File | null = null;
let bannerFile: File | null = null;
let licenseFile: File | null = null;

// Authentication lock
onAuthStateChanged(auth, (user) => {
  if (!user) {
    showToast("Session expired. Log in to merchant portal.", "error");
    window.location.href = "/store-login.html";
    return;
  }

  loggedInMerchant = user;
  currentStoreId = user.uid;

  // Verify Role is store
  get(ref(db, `users/${user.uid}`)).then((snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (data.role !== "store") {
        let targetUrl = "/index.html";
        if (data.role === "admin") {
          targetUrl = "/admin.html";
        } else if (data.role === "user") {
          targetUrl = "/user.html";
        } else if (data.role === "delivery" || data.role === "deliveryboy1") {
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
              This is an isolated portal. You are trying to access the <strong>STORE</strong> panel, but your account is registered as <strong>${(data.role || "unknown").toUpperCase()}</strong>.
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
        // Safe access confirmed
        document.getElementById("store-profile-header-name")!.innerText = data.name || "Pharmacy Merchant Node";
        syncStoreDashboard();
      }
    } else {
      signOut(auth).then(() => {
        window.location.href = "/store-login.html";
      });
    }
  });
});

// Operations Tab Toggle
tabOrders.addEventListener("click", () => {
  activeTab = "orders";
  tabOrders.className = "flex-1 py-2 text-xs rounded-lg bg-indigo-600 text-white font-bold transition-all cursor-pointer";
  tabInventory.className = "flex-1 py-2 text-xs rounded-lg text-slate-500 font-semibold transition-all hover:text-indigo-700 cursor-pointer";
  tabProfile.className = "flex-1 py-2 text-xs rounded-lg text-slate-500 font-semibold transition-all hover:text-indigo-700 cursor-pointer";
  sectionOrders.classList.remove("hidden");
  sectionInventory.classList.add("hidden");
  sectionProfile.classList.add("hidden");
});

tabInventory.addEventListener("click", () => {
  activeTab = "inventory";
  tabInventory.className = "flex-1 py-2 text-xs rounded-lg bg-indigo-600 text-white font-bold transition-all cursor-pointer";
  tabOrders.className = "flex-1 py-2 text-xs rounded-lg text-slate-500 font-semibold transition-all hover:text-indigo-700 cursor-pointer";
  tabProfile.className = "flex-1 py-2 text-xs rounded-lg text-slate-500 font-semibold transition-all hover:text-indigo-700 cursor-pointer";
  sectionInventory.classList.remove("hidden");
  sectionOrders.classList.add("hidden");
  sectionProfile.classList.add("hidden");
});

tabProfile.addEventListener("click", () => {
  activeTab = "profile";
  tabProfile.className = "flex-1 py-2 text-xs rounded-lg bg-indigo-600 text-white font-bold transition-all cursor-pointer";
  tabOrders.className = "flex-1 py-2 text-xs rounded-lg text-slate-500 font-semibold transition-all hover:text-indigo-700 cursor-pointer";
  tabInventory.className = "flex-1 py-2 text-xs rounded-lg text-slate-500 font-semibold transition-all hover:text-indigo-700 cursor-pointer";
  sectionProfile.classList.remove("hidden");
  sectionOrders.classList.add("hidden");
  sectionInventory.classList.add("hidden");
  populateProfileFieldsFromCache();
});

// File previews for profile
document.getElementById("inp-store-logo")?.addEventListener("change", (e: any) => {
  const file = e.target.files?.[0];
  if (file) {
    logoFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const el = document.getElementById("store-logo-preview") as HTMLImageElement;
      if (el) el.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  }
});

document.getElementById("inp-store-banner")?.addEventListener("change", (e: any) => {
  const file = e.target.files?.[0];
  if (file) {
    bannerFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const el = document.getElementById("store-banner-preview") as HTMLImageElement;
      if (el) el.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  }
});

document.getElementById("inp-store-license")?.addEventListener("change", (e: any) => {
  const file = e.target.files?.[0];
  if (file) {
    licenseFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const licPreview = document.getElementById("store-license-preview") as HTMLImageElement;
      if (licPreview) {
        licPreview.src = ev.target?.result as string;
        licPreview.classList.remove("hidden");
      }
      const licIcon = document.getElementById("license-icon");
      if (licIcon) licIcon.classList.add("hidden");
    };
    reader.readAsDataURL(file);
  }
});

// Submit Form action
document.getElementById("form-store-profile")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = (document.getElementById("store-profile-name") as HTMLInputElement).value.trim();
  const ownerName = (document.getElementById("store-profile-owner") as HTMLInputElement).value.trim();
  const mobile = (document.getElementById("store-profile-mobile") as HTMLInputElement).value.trim();
  const licenseNumber = (document.getElementById("store-profile-license") as HTMLInputElement).value.trim();
  const state = (document.getElementById("store-profile-state") as HTMLSelectElement).value;
  const district = (document.getElementById("store-profile-district") as HTMLInputElement).value.trim();
  const address = (document.getElementById("store-profile-address") as HTMLTextAreaElement).value.trim();

  const saveBtn = document.getElementById("btn-save-store-profile") as HTMLButtonElement;
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Syncing assets with Cloudinary...`;

  try {
    let logoUrl = currentStoreDetail?.logo || "https://images.unsplash.com/photo-1586015555751-63bb77f4322a?auto=format&fit=crop&q=80&w=200";
    let bannerUrl = currentStoreDetail?.banner || "https://images.unsplash.com/photo-1628771065518-0d82f1938462?auto=format&fit=crop&q=80&w=400";
    let licenseUrl = currentStoreDetail?.drugLicenseImage || "https://images.unsplash.com/photo-1586015555751-63bb77f4322a?auto=format&fit=crop&q=80&w=200";

    if (logoFile) {
      showToast("Uploading store brand logo...", "info");
      logoUrl = await uploadToCloudinary(logoFile);
    }
    if (bannerFile) {
      showToast("Uploading store billboard banner...", "info");
      bannerUrl = await uploadToCloudinary(bannerFile);
    }
    if (licenseFile) {
      showToast("Uploading drug regulatory license copy...", "info");
      licenseUrl = await uploadToCloudinary(licenseFile);
    }

    const payload = {
      ...currentStoreDetail,
      storeId: currentStoreId,
      name,
      ownerName,
      mobile,
      licenseNumber,
      drugLicenseNumber: licenseNumber,
      state,
      district,
      address,
      logo: logoUrl,
      banner: bannerUrl,
      drugLicenseImage: licenseUrl
    };

    await update(ref(db, `stores/${currentStoreId}`), payload);
    await update(ref(db, `users/${currentStoreId}`), {
      name,
      mobile,
      state,
      district,
      address
    });

    showToast("Profile credentials synchronized globally!", "success");
    logoFile = null;
    bannerFile = null;
    licenseFile = null;
  } catch (err) {
    console.error(err);
    showToast("Operation failed to sync assets.", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> <span>Save & Publish Profile Details</span>`;
  }
});

function populateProfileFieldsFromCache() {
  if (!currentStoreDetail) return;
  const nameInp = document.getElementById("store-profile-name") as HTMLInputElement;
  if (!nameInp) return;

  nameInp.value = currentStoreDetail.name || "";
  (document.getElementById("store-profile-owner") as HTMLInputElement).value = currentStoreDetail.ownerName || "";
  (document.getElementById("store-profile-mobile") as HTMLInputElement).value = currentStoreDetail.mobile || "";
  (document.getElementById("store-profile-license") as HTMLInputElement).value = currentStoreDetail.licenseNumber || currentStoreDetail.drugLicenseNumber || "";
  (document.getElementById("store-profile-state") as HTMLSelectElement).value = currentStoreDetail.state || "Karnataka";
  (document.getElementById("store-profile-district") as HTMLInputElement).value = currentStoreDetail.district || "";
  (document.getElementById("store-profile-address") as HTMLTextAreaElement).value = currentStoreDetail.address || "";

  if (currentStoreDetail.logo) {
    (document.getElementById("store-logo-preview") as HTMLImageElement).src = currentStoreDetail.logo;
  }
  if (currentStoreDetail.banner) {
    (document.getElementById("store-banner-preview") as HTMLImageElement).src = currentStoreDetail.banner;
  }
  if (currentStoreDetail.drugLicenseImage) {
    const licImg = document.getElementById("store-license-preview") as HTMLImageElement;
    if (licImg) {
      licImg.src = currentStoreDetail.drugLicenseImage;
      licImg.classList.remove("hidden");
    }
    const licIcon = document.getElementById("license-icon");
    if (licIcon) licIcon.classList.add("hidden");
  }
}

// Sign out trigger
document.getElementById("btn-store-signout")?.addEventListener("click", async () => {
  if (confirm("Disconnect pharmacy session from platform?")) {
    await signOut(auth);
    window.location.href = "/store-login.html";
  }
});

// Synchronize Store dashboards and lists
function syncStoreDashboard() {
  loadDynamicCategories();
  
  // Subscribe to dynamic delivery radius
  onValue(ref(db, "platform_settings"), (snap) => {
    let radius = 10;
    if (snap.exists()) {
      const s = snap.val();
      radius = parseFloat(s.deliveryRadius) || 10;
    }
    const covEl = document.getElementById("store-stat-coverage");
    if (covEl) covEl.innerText = `${radius} KM`;
  });

  // Subscribe store info details
  onValue(ref(db, `stores/${currentStoreId}`), (snapshot) => {
    if (snapshot.exists()) {
      currentStoreDetail = snapshot.val();
      document.getElementById("store-city-txt")!.innerText = `📍 ${currentStoreDetail.address?.split(",")[0] || "Bengaluru"}`;
    }
  });

  // Subscribe store payment details
  onValue(ref(db, `storePayments/${currentStoreId}`), (snap) => {
    if (snap.exists()) {
      const pData = snap.val();
      currentStorePaymentsDetail = pData;

      const inpUpi = document.getElementById("store-settle-upi-id") as HTMLInputElement;
      if (inpUpi) inpUpi.value = pData.storeUpiId || "";

      const inpUpiHolder = document.getElementById("store-settle-upi-holder") as HTMLInputElement;
      if (inpUpiHolder) inpUpiHolder.value = pData.upiHolderName || "";

      const inpBankName = document.getElementById("store-settle-bank-name") as HTMLInputElement;
      if (inpBankName) inpBankName.value = pData.bankName || "";

      const inpBankIfsc = document.getElementById("store-settle-bank-ifsc") as HTMLInputElement;
      if (inpBankIfsc) inpBankIfsc.value = pData.bankIfsc || "";

      const inpBankAccount = document.getElementById("store-settle-bank-account") as HTMLInputElement;
      if (inpBankAccount) inpBankAccount.value = pData.bankAccountNumber || "";

      // Show verification status
      const lblStatus = document.getElementById("lbl-store-payment-status");
      const badgeStatus = document.getElementById("badge-store-payment-status");
      const status = pData.status || "unverified";

      if (lblStatus && badgeStatus) {
        if (status === "unverified") {
          lblStatus.innerText = "No Credentials Configured";
          badgeStatus.innerText = "Unverified";
          badgeStatus.className = "bg-slate-100 text-slate-500 px-2 py-0.5 rounded-lg font-black text-[8px] uppercase border border-slate-200";
        } else if (status === "pending_approval") {
          lblStatus.innerText = "Verification Pending";
          badgeStatus.innerText = "Pending";
          badgeStatus.className = "bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg font-black text-[8px] uppercase border border-amber-250 animate-pulse";
        } else if (status === "verified") {
          lblStatus.innerText = "Verified by Admin";
          badgeStatus.innerText = "Verified";
          badgeStatus.className = "bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg font-black text-[8px] uppercase border border-emerald-250";
        } else if (status === "locked") {
          lblStatus.innerText = "Bank Details Locked";
          badgeStatus.innerText = "Locked";
          badgeStatus.className = "bg-rose-100 text-rose-750 px-2 py-0.5 rounded-lg font-black text-[8px] uppercase border border-rose-250 font-black";
        }
      }

      // Lock input fields if locked
      const isLocked = status === "locked";
      const fields = [
        "store-settle-upi-id",
        "store-settle-upi-holder",
        "store-settle-bank-name",
        "store-settle-bank-ifsc",
        "store-settle-bank-account"
      ];
      fields.forEach((id) => {
        const el = document.getElementById(id) as HTMLInputElement;
        if (el) el.disabled = isLocked;
      });

      const btnSave = document.getElementById("btn-save-store-settlement") as HTMLButtonElement;
      if (btnSave) {
        if (isLocked) {
          btnSave.disabled = true;
          btnSave.innerHTML = `<span>🔒 PROFILE LOCKED BY ADMIN</span>`;
          btnSave.className = "w-full bg-slate-400 text-slate-100 font-bold py-3 rounded-xl transition-all cursor-not-allowed select-none";
        } else {
          btnSave.disabled = false;
          btnSave.innerHTML = `<span>Save Settlement Details</span>`;
          btnSave.className = "w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow flex items-center justify-center gap-1.5 cursor-pointer";
        }
      }
    }
  });

  // Bind Form save for store settlement
  document.getElementById("form-store-settlement")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (currentStorePaymentsDetail?.status === "locked") {
      showToast("Store payment details are currently locked by the Admin.", "error");
      return;
    }

    const upiIdVal = (document.getElementById("store-settle-upi-id") as HTMLInputElement).value.trim();
    const upiHolderVal = (document.getElementById("store-settle-upi-holder") as HTMLInputElement).value.trim();
    const bankNameVal = (document.getElementById("store-settle-bank-name") as HTMLInputElement).value.trim();
    const bankIfscVal = (document.getElementById("store-settle-bank-ifsc") as HTMLInputElement).value.trim().toUpperCase();
    const bankAccountVal = (document.getElementById("store-settle-bank-account") as HTMLInputElement).value.trim();

    if (!upiIdVal || !upiHolderVal || !bankNameVal || !bankIfscVal || !bankAccountVal) {
      showToast("Please provide all required settlement fields.", "error");
      return;
    }

    const btnSubmit = document.getElementById("btn-save-store-settlement") as HTMLButtonElement;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving credentials...`;

    try {
      const payload = {
        storeId: currentStoreId,
        storeName: currentStoreDetail?.name || "Connected Partner",
        storeUpiId: upiIdVal,
        upiHolderName: upiHolderVal,
        bankName: bankNameVal,
        bankIfsc: bankIfscVal,
        bankAccountNumber: bankAccountVal,
        status: currentStorePaymentsDetail?.status === "verified" ? "verified" : "pending_approval",
        updatedAt: Date.now()
      };

      await update(ref(db, `storePayments/${currentStoreId}`), payload);
      showToast("Store settlement credentials synchronized successfully!", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to save store settlement details.", "error");
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<span>Save Settlement Details</span>`;
    }
  });

  // Subscribes notifications for live toast feedback!
  onValue(ref(db, `notifications/${currentStoreId}`), (snapshot) => {
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const payload = child.val();
        if (payload && !payload.notified) {
          showToast(`🔔 ${payload.title}: ${payload.body}`, "info");
          // Marker
          update(ref(db, `notifications/${currentStoreId}/${child.key}`), { notified: true });
        }
      });
    }
  });

  // Subscribes store specific orders
  subscribeStoreOrders();

  // Subscribes medicines inventory catalog
  subscribeStoreInventory();
}

// 1. ORDER REQUESTS PROCESS CODES
let storeOrdersCache: any[] = [];

function subscribeStoreOrders() {
  onValue(ref(db, "orders"), (snapshot) => {
    storeOrdersCache = [];
    let grossShare = 0;
    let pendingCount = 0;

    snapshot.forEach((child) => {
      const o = child.val();
      if (o.storeId === currentStoreId) {
        storeOrdersCache.push(o);

        if (o.status === "delivered") {
          // Calculate gross payouts = Subtotal + GST - 10% Comms Fees
          const comms = o.subtotal * 0.10;
          grossShare += (o.subtotal + o.gst - comms);
        } else {
          pendingCount++;
        }
      }
    });

    // Update Stats indicators
    document.getElementById("store-stat-earnings")!.innerText = `₹${Math.round(grossShare)}`;
    document.getElementById("store-stat-pending")!.innerText = pendingCount.toString();
    document.getElementById("cnt-st-orders")!.innerText = `${storeOrdersCache.length} Operations`;

    renderStoreOrdersList();
  });
}

function renderStoreOrdersList() {
  const container = document.getElementById("store-orders-list")!;
  if (storeOrdersCache.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-400 font-medium text-xs bg-white rounded-2xl border border-slate-100 p-6">
        <i class="fa-solid fa-clipboard-check text-4xl mb-2 text-slate-200"></i>
        <p>No active patient orders registered inside system.</p>
      </div>
    `;
    return;
  }

  // Sort recently descending
  storeOrdersCache.sort((a,b) => b.createdAt - a.createdAt);

  container.innerHTML = storeOrdersCache.map((o) => {
    let buttonActionMarkup = "";
    let stepDescription = "";

    if (o.status === "pending") {
      stepDescription = "Awaiting store verification review";
      buttonActionMarkup = `
        <button onclick="approveStoreOrder('${o.orderId}')" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl cursor-pointer shadow text-center hover:-translate-y-0.5 transition-all">
          <i class="fa-solid fa-file-signature"></i> Accept Order & Confirm Stocks
        </button>
      `;
    } else if (o.status === "accepted") {
      stepDescription = "Accepted - Please pack medicine capsule sets";
      buttonActionMarkup = `
        <button onclick="packStoreOrder('${o.orderId}')" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 rounded-xl cursor-pointer shadow text-center hover:-translate-y-0.5 transition-all">
          <i class="fa-solid fa-boxes-packing"></i> Mark Medicines Packed & Call Rider
        </button>
      `;
    } else if (o.status === "packed") {
      stepDescription = "Packed & Ready - Paging delivery boy networks";
      buttonActionMarkup = `
        <div class="p-2 bg-indigo-50 border border-indigo-100 text-indigo-800 text-[10px] rounded-lg font-black uppercase text-center pulse-glow">
          Awaiting Rider Acceptance... <i class="fa-solid fa-satellite-dish"></i>
        </div>
      `;
    } else if (o.status === "out") {
      stepDescription = "Rider in route with delivery";
      buttonActionMarkup = `
        <div class="space-y-2">
          <div class="p-2 border border-sky-100 text-sky-850 bg-sky-50 text-[10px] rounded-lg font-black uppercase text-center font-bold">
            In Transit - Out For Delivery <i class="fa-solid fa-truck-fast"></i>
          </div>
          <button onclick="trackAssignedRider('${o.orderId}')" class="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 rounded-xl cursor-pointer shadow text-center text-xs transition-all flex items-center justify-center gap-1.5">
            <i class="fa-solid fa-location-crosshairs animate-bounce"></i> Track Assigned Rider
          </button>
        </div>
      `;
    } else if (o.status === "delivered") {
      stepDescription = "Transaction completed check handovers";
      buttonActionMarkup = `
        <div class="p-2 bg-emerald-50 border border-emerald-100 text-emerald-800 text-[10px] rounded-lg font-black uppercase text-center">
          Delivered / Paid Cash ₹${Math.round(o.total)} <i class="fa-solid fa-thumbs-up"></i>
        </div>
      `;
    }

    return `
      <div class="bg-white rounded-3xl border border-slate-100 p-4 shadow-xs space-y-3 font-medium text-xs">
        <div class="flex items-center justify-between border-b border-slate-50 pb-2">
          <div>
            <strong class="font-extrabold text-slate-900 text-sm block">Order ID: #${o.orderId.substring(0,8).toUpperCase()}</strong>
            <span class="text-[9px] text-slate-400 font-mono">${new Date(o.createdAt).toLocaleString()}</span>
          </div>
          <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded ${o.status === "delivered" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"}">
            ${o.status}
          </span>
        </div>

        <div class="space-y-1 pb-1">
          ${o.items?.map((it: any) => `
            <div class="flex justify-between text-[11px] text-slate-600">
              <span>${it.name} <strong class="text-indigo-600">x${it.qty}</strong></span>
              <span class="font-mono text-slate-900">₹${it.price * it.qty}</span>
            </div>
          `).join("")}
        </div>

        <div class="p-2.5 bg-slate-50 border border-slate-100 rounded-xl space-y-1">
          <p class="text-[9px] text-slate-400 font-bold uppercase tracking-wide">Patient Address</p>
          <span class="text-slate-700 block leading-normal leading-relaxed truncate" title="${o.userAddress}">${o.userAddress}</span>
        </div>

        <div class="flex justify-between items-center text-[10px]">
          <span class="text-slate-450 text-slate-400 font-bold uppercase">Cash Collect total:</span>
          <strong class="text-indigo-700 text-sm font-mono font-black">₹${Math.round(o.total)}</strong>
        </div>

        <div class="pt-2 border-t border-slate-50 space-y-2">
          ${buttonActionMarkup}
        </div>
      </div>
    `;
  }).join("");
}

// Order Actions mapping
Object.assign(window, {
  approveStoreOrder(id: string) {
    update(ref(db, `orders/${id}`), {
      status: "accepted",
      "timeline/acceptedTime": Date.now()
    }).then(() => {
      showToast("Order accepted. Preparing products catalog...", "success");
    });
  },
  packStoreOrder(id: string) {
    update(ref(db, `orders/${id}`), {
      status: "packed",
      "timeline/packedTime": Date.now()
    }).then(() => {
      showToast("Meds packed! Paging delivery riders network.", "success");
      
      // Dispatch alert to operational riders
      get(ref(db, "delivery")).then((snapshot) => {
        if (snapshot.exists()) {
          snapshot.forEach((child) => {
            const rider = child.val();
            if (rider.approved && rider.active && rider.status === "free") {
              // Push notification
              const targetRiderId = rider.deliveryId;
              const nKey = `rider_not_${Date.now()}`;
              set(ref(db, `notifications/${targetRiderId}/${nKey}`), {
                id: nKey,
                title: "Core available delivery",
                body: `New packed order handover ready at ${currentStoreDetail.name || "Pharmacy"}. Accept now!`,
                timestamp: Date.now()
              });
            }
          });
        }
      });
    });
  }
});

// 2. APOTHECARY INVENTORY & FILE UPLOAD
let uploadedMedicinesCache: any[] = [];
let medicineImageFile: File | null = null;
let addMedicineSliderImages: string[] = [];

const medFileInput = document.getElementById("med-file-input") as HTMLInputElement;
medFileInput?.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    medicineImageFile = target.files[0];
    document.getElementById("img-upload-txt")!.innerText = "Selected Cover";
    document.getElementById("img-upload-icon")!.className = "fa-solid fa-file-circle-check text-indigo-400 mr-2";
  }
});

// Handles secondary multi image selection (Up to 10 images)
const medMultiImagesInput = document.getElementById("med-multi-images-input") as HTMLInputElement;
medMultiImagesInput?.addEventListener("change", async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  if (addMedicineSliderImages.length >= 10) {
    showToast("Maximum of 10 presentation images allowed per product", "error");
    return;
  }

  showToast("Uploading slide photo to Cloudinary...", "info");
  for (let i = 0; i < files.length; i++) {
    if (addMedicineSliderImages.length >= 10) break;
    try {
      const url = await uploadToCloudinary(files[i]);
      addMedicineSliderImages.push(url);
    } catch {
      showToast(`Failed uploading slide ${i+1}`, "error");
    }
  }
  renderAddMedicineThumbs();
  showToast("Slide photos loaded successfully!", "success");
});

function renderAddMedicineThumbs() {
  const container = document.getElementById("add-med-thumbs-container");
  const countSpan = document.getElementById("txt-slider-pics-cnt");
  if (!container || !countSpan) return;

  countSpan.innerText = `${addMedicineSliderImages.length} / 10 Upl`;
  
  if (addMedicineSliderImages.length > 0) {
    container.classList.remove("hidden");
    container.innerHTML = addMedicineSliderImages.map((url, i) => `
      <div class="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-200 shrink-0">
        <img src="${url}" class="w-full h-full object-cover">
        <button type="button" onclick="removeAddMedicineSliderImage(${i})" class="absolute -top-1 -right-1 w-4 h-4 bg-rose-600 text-white rounded-full flex items-center justify-center text-[8px] border-none cursor-pointer hover:bg-rose-700 transition-all shadow-xs"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `).join("");
  } else {
    container.classList.add("hidden");
    container.innerHTML = "";
  }
}

// Collapsible advanced specifications
const toggleAddAdvancedBtn = document.getElementById("btn-toggle-add-advanced-sections");
const addAdvancedPanel = document.getElementById("add-advanced-specs-collapsed");
const addAdvancedChev = document.getElementById("icon-add-advanced-chev");

toggleAddAdvancedBtn?.addEventListener("click", () => {
  if (addAdvancedPanel) {
    const isHidden = addAdvancedPanel.classList.contains("hidden");
    if (isHidden) {
      addAdvancedPanel.classList.remove("hidden");
      addAdvancedChev?.classList.replace("fa-chevron-down", "fa-chevron-up");
    } else {
      addAdvancedPanel.classList.add("hidden");
      addAdvancedChev?.classList.replace("fa-chevron-up", "fa-chevron-down");
    }
  }
});

document.getElementById("form-add-medicine")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = (document.getElementById("med-name") as HTMLInputElement).value.trim();
  const price = parseFloat((document.getElementById("med-price") as HTMLInputElement).value);
  const stock = parseInt((document.getElementById("med-stock") as HTMLInputElement).value);
  const category = (document.getElementById("med-category") as HTMLSelectElement).value;
  const desc = (document.getElementById("med-desc") as HTMLInputElement).value.trim();

  // Advanced clinical fields
  const brand = (document.getElementById("med-brand") as HTMLInputElement).value.trim();
  const genericName = (document.getElementById("med-generic") as HTMLInputElement).value.trim();
  const manufacturer = (document.getElementById("med-manufacturer") as HTMLInputElement).value.trim();
  const dosage = (document.getElementById("med-dosage") as HTMLInputElement).value.trim();
  const packSize = (document.getElementById("med-pack-size") as HTMLInputElement).value.trim();
  const discount = parseInt((document.getElementById("med-discount") as HTMLInputElement).value) || 0;
  const uses = (document.getElementById("med-uses") as HTMLTextAreaElement).value.trim();
  const benefits = (document.getElementById("med-benefits") as HTMLTextAreaElement).value.trim();
  const sideEffects = (document.getElementById("med-side-effects") as HTMLTextAreaElement).value.trim();
  const warnings = (document.getElementById("med-warnings") as HTMLTextAreaElement).value.trim();
  const storage = (document.getElementById("med-storage") as HTMLInputElement).value.trim();

  // New Clinical & Metadata fields
  const composition = (document.getElementById("med-composition") as HTMLTextAreaElement).value.trim();
  const strength = (document.getElementById("med-strength") as HTMLInputElement).value.trim();
  const dosageForm = (document.getElementById("med-dosage-form") as HTMLInputElement).value.trim();
  const prescriptionRequired = (document.getElementById("med-prescription-req") as HTMLSelectElement).value;
  const directionsForUse = (document.getElementById("med-directions") as HTMLTextAreaElement).value.trim();
  const dosageInstructions = (document.getElementById("med-dosage-inst") as HTMLTextAreaElement).value.trim();
  const safetyAdvice = (document.getElementById("med-safety-advice") as HTMLTextAreaElement).value.trim();
  const drugInteractions = (document.getElementById("med-drug-interactions") as HTMLTextAreaElement).value.trim();
  const contraindications = (document.getElementById("med-contraindications") as HTMLTextAreaElement).value.trim();
  const ageGroup = (document.getElementById("med-age-group") as HTMLInputElement).value.trim();
  const pregnancySafety = (document.getElementById("med-pregnancy-safety") as HTMLInputElement).value.trim();
  const breastfeedingSafety = (document.getElementById("med-breastfeeding-safety") as HTMLInputElement).value.trim();
  const drivingSafety = (document.getElementById("med-driving-safety") as HTMLInputElement).value.trim();
  const alcoholWarning = (document.getElementById("med-alcohol-warning") as HTMLInputElement).value.trim();
  const foodInteraction = (document.getElementById("med-food-interaction") as HTMLInputElement).value.trim();
  const mrp = parseFloat((document.getElementById("med-mrp") as HTMLInputElement).value) || 0;
  const gstRate = parseFloat((document.getElementById("med-gst-rate") as HTMLInputElement).value) || 0;
  const hsnCode = (document.getElementById("med-hsn-code") as HTMLInputElement).value.trim();
  const medicineTags = (document.getElementById("med-tags") as HTMLInputElement).value.trim();
  const searchKeywords = (document.getElementById("med-keywords") as HTMLInputElement).value.trim();
  const seoMetaTitle = (document.getElementById("med-seo-title") as HTMLInputElement).value.trim();
  const seoMetaDescription = (document.getElementById("med-seo-desc") as HTMLTextAreaElement).value.trim();

  const submitBtn = document.getElementById("btn-submit-med") as HTMLButtonElement;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Syncing Cover Image...`;

  if (!medicineImageFile) {
    showToast("Please pick a main cover image from your camera or gallery", "error");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-save"></i> <span>Inject into Medicine Matrix</span>`;
    return;
  }

  try {
    showToast("Uploading medicine graphic...", "info");
    const labelUrl = await uploadToCloudinary(medicineImageFile);
    
    const medId = `med_${currentStoreId}_${Date.now()}`;
    const payload = {
      medicineId: medId,
      storeId: currentStoreId,
      storeName: currentStoreDetail?.name || "Apothecary Outlet",
      name,
      price,
      stock,
      category,
      description: desc,
      image: labelUrl,
      images: [labelUrl, ...addMedicineSliderImages],
      brand: brand || "Generic",
      genericName: genericName || name,
      manufacturer: manufacturer || "General Pharma",
      dosage: dosage || "Standard Strength",
      packSize: packSize || "Package Pack",
      discount: discount,
      uses: uses || "Temporary relief of mild discomfort.",
      benefits: benefits || "Addresses targeted symptoms safely.",
      sideEffects: sideEffects || "Minor nausea or dry mouth if any.",
      warnings: warnings || "Take under supervision and store carefully.",
      storage: storage || "Store below 30°C in dry dark space.",
      composition,
      strength,
      dosageForm,
      prescriptionRequired,
      directionsForUse,
      dosageInstructions,
      safetyAdvice,
      drugInteractions,
      contraindications,
      ageGroup,
      pregnancySafety,
      breastfeedingSafety,
      drivingSafety,
      alcoholWarning,
      foodInteraction,
      mrp,
      gstRate,
      hsnCode,
      medicineTags,
      searchKeywords,
      seoMetaTitle,
      seoMetaDescription,
      createdAt: Date.now()
    };

    set(ref(db, `medicines/${medId}`), payload).then(() => {
      showToast(`${name} added to medicine catalog!`, "success");
      
      // Reset form variables
      medicineImageFile = null;
      addMedicineSliderImages = [];
      renderAddMedicineThumbs();
      
      (document.getElementById("form-add-medicine") as HTMLFormElement).reset();
      document.getElementById("img-upload-txt")!.innerText = "Select Cover";
      document.getElementById("img-upload-icon")!.className = "fa-solid fa-camera mr-2 text-slate-400";
      
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-save"></i> <span>Inject into Medicine Matrix</span>`;
    });
  } catch (error) {
    showToast("Failed uploading label graphic to Cloudinary.", "error");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-save"></i> <span>Inject into Medicine Matrix</span>`;
  }
});


// State variables for Product Editing
let editMedicineCoverFile: File | null = null;
let editMedicineSliderImages: string[] = [];

// Edit cover select trigger
const editMedFileInput = document.getElementById("edit-med-file-input") as HTMLInputElement;
editMedFileInput?.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    editMedicineCoverFile = target.files[0];
    document.getElementById("edit-img-upload-txt")!.innerText = "Ready to Replace";
    document.getElementById("edit-img-upload-icon")!.className = "fa-solid fa-file-circle-check text-green-500 mr-2";
  }
});

// Edit Slider Multi-select trigger
const editMedMultiImagesInput = document.getElementById("edit-med-multi-images-input") as HTMLInputElement;
editMedMultiImagesInput?.addEventListener("change", async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  if (editMedicineSliderImages.length >= 10) {
    showToast("Upto 10 presentation photos permitted", "error");
    return;
  }

  showToast("Uploading slide photo...", "info");
  for (let i = 0; i < files.length; i++) {
    if (editMedicineSliderImages.length >= 10) break;
    try {
      const url = await uploadToCloudinary(files[i]);
      editMedicineSliderImages.push(url);
    } catch {
      showToast(`Failed uploading slide photo`, "error");
    }
  }
  renderEditMedicineThumbs();
  showToast("Slide photos loaded successfully", "success");
});

function renderEditMedicineThumbs() {
  const container = document.getElementById("edit-med-thumbs-container");
  const countSpan = document.getElementById("edit-txt-slider-pics-cnt");
  if (!container || !countSpan) return;

  countSpan.innerText = `${editMedicineSliderImages.length} / 10 Upl`;
  
  if (editMedicineSliderImages.length > 0) {
    container.classList.remove("hidden");
    container.innerHTML = editMedicineSliderImages.map((url, i) => `
      <div class="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-200 shrink-0">
        <img src="${url}" class="w-full h-full object-cover">
        <button type="button" onclick="removeEditMedicineSliderImage(${i})" class="absolute -top-1 -right-1 w-4 h-4 bg-rose-600 text-white rounded-full flex items-center justify-center text-[8px] border-none cursor-pointer hover:bg-rose-705 transition-all shadow-xs"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `).join("");
  } else {
    container.classList.add("hidden");
    container.innerHTML = "";
  }
}

// Edit Form submit
document.getElementById("form-edit-medicine")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const medId = (document.getElementById("edit-med-id") as HTMLInputElement).value;
  if (!medId) return;

  const name = (document.getElementById("edit-med-name") as HTMLInputElement).value.trim();
  const price = parseFloat((document.getElementById("edit-med-price") as HTMLInputElement).value);
  const stock = parseInt((document.getElementById("edit-med-stock") as HTMLInputElement).value);
  const category = (document.getElementById("edit-med-category") as HTMLSelectElement).value;
  const desc = (document.getElementById("edit-med-desc") as HTMLInputElement).value.trim();
  
  const brand = (document.getElementById("edit-med-brand") as HTMLInputElement).value.trim();
  const genericName = (document.getElementById("edit-med-generic") as HTMLInputElement).value.trim();
  const manufacturer = (document.getElementById("edit-med-manufacturer") as HTMLInputElement).value.trim();
  const dosage = (document.getElementById("edit-med-dosage") as HTMLInputElement).value.trim();
  const packSize = (document.getElementById("edit-med-pack-size") as HTMLInputElement).value.trim();
  const discount = parseInt((document.getElementById("edit-med-discount") as HTMLInputElement).value) || 0;
  
  const uses = (document.getElementById("edit-med-uses") as HTMLTextAreaElement).value.trim();
  const benefits = (document.getElementById("edit-med-benefits") as HTMLTextAreaElement).value.trim();
  const sideEffects = (document.getElementById("edit-med-side-effects") as HTMLTextAreaElement).value.trim();
  const warnings = (document.getElementById("edit-med-warnings") as HTMLTextAreaElement).value.trim();
  const storage = (document.getElementById("edit-med-storage") as HTMLInputElement).value.trim();

  // New Clinical & Metadata fields for Edit Form
  const composition = (document.getElementById("edit-med-composition") as HTMLTextAreaElement).value.trim();
  const strength = (document.getElementById("edit-med-strength") as HTMLInputElement).value.trim();
  const dosageForm = (document.getElementById("edit-med-dosage-form") as HTMLInputElement).value.trim();
  const prescriptionRequired = (document.getElementById("edit-med-prescription-req") as HTMLSelectElement).value;
  const directionsForUse = (document.getElementById("edit-med-directions") as HTMLTextAreaElement).value.trim();
  const dosageInstructions = (document.getElementById("edit-med-dosage-inst") as HTMLTextAreaElement).value.trim();
  const safetyAdvice = (document.getElementById("edit-med-safety-advice") as HTMLTextAreaElement).value.trim();
  const drugInteractions = (document.getElementById("edit-med-drug-interactions") as HTMLTextAreaElement).value.trim();
  const contraindications = (document.getElementById("edit-med-contraindications") as HTMLTextAreaElement).value.trim();
  const ageGroup = (document.getElementById("edit-med-age-group") as HTMLInputElement).value.trim();
  const pregnancySafety = (document.getElementById("edit-med-pregnancy-safety") as HTMLInputElement).value.trim();
  const breastfeedingSafety = (document.getElementById("edit-med-breastfeeding-safety") as HTMLInputElement).value.trim();
  const drivingSafety = (document.getElementById("edit-med-driving-safety") as HTMLInputElement).value.trim();
  const alcoholWarning = (document.getElementById("edit-med-alcohol-warning") as HTMLInputElement).value.trim();
  const foodInteraction = (document.getElementById("edit-med-food-interaction") as HTMLInputElement).value.trim();
  const mrp = parseFloat((document.getElementById("edit-med-mrp") as HTMLInputElement).value) || 0;
  const gstRate = parseFloat((document.getElementById("edit-med-gst-rate") as HTMLInputElement).value) || 0;
  const hsnCode = (document.getElementById("edit-med-hsn-code") as HTMLInputElement).value.trim();
  const medicineTags = (document.getElementById("edit-med-tags") as HTMLInputElement).value.trim();
  const searchKeywords = (document.getElementById("edit-med-keywords") as HTMLInputElement).value.trim();
  const seoMetaTitle = (document.getElementById("edit-med-seo-title") as HTMLInputElement).value.trim();
  const seoMetaDescription = (document.getElementById("edit-med-seo-desc") as HTMLTextAreaElement).value.trim();

  const submitBtn = document.getElementById("btn-save-edited-med") as HTMLButtonElement;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Syncing update parameters...`;

  try {
    let coverUrl = "";
    if (editMedicineCoverFile) {
      showToast("Uploading new cover image...", "info");
      coverUrl = await uploadToCloudinary(editMedicineCoverFile);
    }

    const updates: any = {
      name,
      price,
      stock,
      category,
      description: desc,
      brand,
      genericName,
      manufacturer,
      dosage,
      packSize,
      discount,
      uses,
      benefits,
      sideEffects,
      warnings,
      storage,
      composition,
      strength,
      dosageForm,
      prescriptionRequired,
      directionsForUse,
      dosageInstructions,
      safetyAdvice,
      drugInteractions,
      contraindications,
      ageGroup,
      pregnancySafety,
      breastfeedingSafety,
      drivingSafety,
      alcoholWarning,
      foodInteraction,
      mrp,
      gstRate,
      hsnCode,
      medicineTags,
      searchKeywords,
      seoMetaTitle,
      seoMetaDescription
    };

    if (coverUrl) {
      updates.image = coverUrl;
      // Also update slider images' index 0 if it exists
      if (editMedicineSliderImages.length > 0) {
        editMedicineSliderImages[0] = coverUrl;
      } else {
        editMedicineSliderImages.push(coverUrl);
      }
    }
    
    // Always store the updated list of images
    updates.images = editMedicineSliderImages;

    update(ref(db, `medicines/${medId}`), updates).then(() => {
      showToast("Apothecary specifications synced completely!", "success");
      
      // Close Modal and reset variables
      editMedicineCoverFile = null;
      document.getElementById("edit-img-upload-txt")!.innerText = "Replace Cover";
      document.getElementById("edit-img-upload-icon")!.className = "fa-solid fa-camera mr-2 text-slate-400";
      
      document.getElementById("store-edit-medicine-modal")?.classList.add("hidden");
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Modify Public Medication Specs`;
    });
  } catch (err) {
    showToast("Error updating medicine profile specifications", "error");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Modify Public Medication Specs`;
  }
});

// Close edit medicine modal listener
document.getElementById("btn-close-store-edit-med")?.addEventListener("click", () => {
  document.getElementById("store-edit-medicine-modal")?.classList.add("hidden");
});


function subscribeStoreInventory() {
  onValue(ref(db, "medicines"), (snapshot) => {
    uploadedMedicinesCache = [];
    let lowStockCount = 0;

    snapshot.forEach((child) => {
      const med = child.val();
      if (med.storeId === currentStoreId) {
        uploadedMedicinesCache.push(med);
        if (med.stock < 10) {
          lowStockCount++;
        }
      }
    });

    // Update Stats
    document.getElementById("store-stat-invent")!.innerText = uploadedMedicinesCache.length.toString();
    const alertLabel = document.getElementById("lbl-low-stock-count")!;
    alertLabel.innerText = `${lowStockCount} Low stock alerts`;
    if (lowStockCount > 0) {
      alertLabel.className = "text-[8px] text-rose-500 font-extrabold animate-pulse uppercase";
    } else {
      alertLabel.className = "text-[8px] text-slate-400 font-bold";
    }

    renderStoreMedicineList();
  });
}

function renderStoreMedicineList() {
  const container = document.getElementById("store-medicine-list")!;
  if (uploadedMedicinesCache.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-400 bg-white border border-slate-100 rounded-2xl font-medium">
        Your catalog apothecary is clean. Add medicines!
      </div>
    `;
    return;
  }

  container.innerHTML = uploadedMedicinesCache.map((m) => {
    const isLowStock = m.stock < 10;
    return `
      <div id="card_${m.medicineId}" class="bg-white p-3 border rounded-2xl ${isLowStock ? "border-rose-200 bg-rose-50/5" : "border-slate-100"} shadow-xs flex gap-3 text-xs font-semibold relative">
        <img class="w-16 h-16 object-cover rounded-xl shrink-0" src="${m.image}" alt="">
        <div class="flex-1 min-w-0 space-y-1">
          <div class="flex items-center justify-between">
            <h5 class="font-extrabold text-slate-900 truncate pr-16 leading-tight">${m.name}</h5>
            <div class="absolute top-3 right-3 flex items-center gap-1.5 shadow-xs bg-slate-50 border border-slate-100 p-0.5 rounded-lg text-slate-800">
              <button onclick="openEditMedicineModal('${m.medicineId}')" class="text-indigo-605 text-indigo-600 hover:text-indigo-850 text-[11px] cursor-pointer hover:scale-115 transition-all w-6 h-6 rounded flex items-center justify-center border-none bg-white">
                <i class="fa-solid fa-pencil"></i>
              </button>
              <button onclick="deleteProductFromInventory('${m.medicineId}')" class="text-rose-505 text-rose-500 hover:text-rose-705 text-[11px] cursor-pointer hover:scale-115 transition-all w-6 h-6 rounded flex items-center justify-center border-none bg-white">
                <i class="fa-regular fa-trash-can"></i>
              </button>
            </div>
          </div>
          <p class="text-[9px] text-slate-450 text-slate-400 font-medium truncate pr-16 leading-normal" title="${m.description}">${m.description || "N/A"}</p>
          
          <div class="flex items-center justify-between pt-1 flex-wrap gap-1.5">
            <div class="flex items-center gap-1">
              <span class="text-[9px] text-slate-400">Price: ₹</span>
              <input type="number" onchange="updateProductPriceValueMode('${m.medicineId}', this.value)" value="${m.price}" min="1" class="w-12 text-center p-0.5 border border-slate-200 rounded text-[10px] font-black focus:border-indigo-505 focus:border-indigo-500 font-mono text-slate-800 bg-slate-50">
            </div>
            <div class="flex items-center gap-1">
              <span class="text-[9px] ${isLowStock ? "text-rose-600 animate-pulse font-extrabold" : "text-slate-450 text-slate-400"}">Stock:</span>
              <input type="number" onchange="updateProductStockValueMode('${m.medicineId}', this.value)" value="${m.stock}" min="0" class="w-12 text-center p-0.5 border border-slate-200 rounded text-[10px] font-black focus:border-indigo-505 focus:border-indigo-500 font-mono text-slate-800 bg-slate-50">
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// Inventory operational callbacks
Object.assign(window, {
  deleteProductFromInventory(medId: string) {
    if (confirm("Permanently delete this medicine item from operational catalog?")) {
      remove(ref(db, `medicines/${medId}`))
        .then(() => showToast("Product removed from inventory Catalog", "info"));
    }
  },
  updateProductStockValueMode(medId: string, valStr: string) {
    const nextStock = parseInt(valStr);
    if (isNaN(nextStock) || nextStock < 0) {
      showToast("Invalid stock value entry", "error");
      return;
    }

    update(ref(db, `medicines/${medId}`), { stock: nextStock })
      .then(() => {
        showToast("Stock volume synced", "success");
      });
  },
  updateProductPriceValueMode(medId: string, valStr: string) {
    const nextPrice = parseFloat(valStr);
    if (isNaN(nextPrice) || nextPrice <= 0) {
      showToast("Invalid price value entry", "error");
      return;
    }

    update(ref(db, `medicines/${medId}`), { price: nextPrice })
      .then(() => {
        showToast("Price point synced", "success");
      });
  },
  openEditMedicineModal(medId: string) {
    const med = uploadedMedicinesCache.find(m => m.medicineId === medId);
    if (!med) return;

    (document.getElementById("edit-med-id") as HTMLInputElement).value = med.medicineId;
    (document.getElementById("edit-med-name") as HTMLInputElement).value = med.name || "";
    (document.getElementById("edit-med-price") as HTMLInputElement).value = med.price || "";
    (document.getElementById("edit-med-stock") as HTMLInputElement).value = med.stock || "";
    (document.getElementById("edit-med-category") as HTMLSelectElement).value = med.category || "Fever & Cold";
    (document.getElementById("edit-med-desc") as HTMLInputElement).value = med.description || "";
    
    (document.getElementById("edit-med-brand") as HTMLInputElement).value = med.brand || "";
    (document.getElementById("edit-med-generic") as HTMLInputElement).value = med.genericName || "";
    (document.getElementById("edit-med-manufacturer") as HTMLInputElement).value = med.manufacturer || "";
    (document.getElementById("edit-med-dosage") as HTMLInputElement).value = med.dosage || "";
    (document.getElementById("edit-med-pack-size") as HTMLInputElement).value = med.packSize || "";
    (document.getElementById("edit-med-discount") as HTMLInputElement).value = med.discount || "0";
    
    (document.getElementById("edit-med-uses") as HTMLTextAreaElement).value = med.uses || "";
    (document.getElementById("edit-med-benefits") as HTMLTextAreaElement).value = med.benefits || "";
    (document.getElementById("edit-med-side-effects") as HTMLTextAreaElement).value = med.sideEffects || "";
    (document.getElementById("edit-med-warnings") as HTMLTextAreaElement).value = med.warnings || "";
    (document.getElementById("edit-med-storage") as HTMLInputElement).value = med.storage || "";

    // New Clinical & Metadata fields for Edit Form
    (document.getElementById("edit-med-composition") as HTMLTextAreaElement).value = med.composition || "";
    (document.getElementById("edit-med-strength") as HTMLInputElement).value = med.strength || "";
    (document.getElementById("edit-med-dosage-form") as HTMLInputElement).value = med.dosageForm || "";
    (document.getElementById("edit-med-prescription-req") as HTMLSelectElement).value = med.prescriptionRequired || "No";
    (document.getElementById("edit-med-directions") as HTMLTextAreaElement).value = med.directionsForUse || "";
    (document.getElementById("edit-med-dosage-inst") as HTMLTextAreaElement).value = med.dosageInstructions || "";
    (document.getElementById("edit-med-safety-advice") as HTMLTextAreaElement).value = med.safetyAdvice || "";
    (document.getElementById("edit-med-drug-interactions") as HTMLTextAreaElement).value = med.drugInteractions || "";
    (document.getElementById("edit-med-contraindications") as HTMLTextAreaElement).value = med.contraindications || "";
    (document.getElementById("edit-med-age-group") as HTMLInputElement).value = med.ageGroup || "";
    (document.getElementById("edit-med-pregnancy-safety") as HTMLInputElement).value = med.pregnancySafety || "";
    (document.getElementById("edit-med-breastfeeding-safety") as HTMLInputElement).value = med.breastfeedingSafety || "";
    (document.getElementById("edit-med-driving-safety") as HTMLInputElement).value = med.drivingSafety || "";
    (document.getElementById("edit-med-alcohol-warning") as HTMLInputElement).value = med.alcoholWarning || "";
    (document.getElementById("edit-med-food-interaction") as HTMLInputElement).value = med.foodInteraction || "";
    (document.getElementById("edit-med-mrp") as HTMLInputElement).value = med.mrp || "";
    (document.getElementById("edit-med-gst-rate") as HTMLInputElement).value = med.gstRate || "";
    (document.getElementById("edit-med-hsn-code") as HTMLInputElement).value = med.hsnCode || "";
    (document.getElementById("edit-med-tags") as HTMLInputElement).value = med.medicineTags || "";
    (document.getElementById("edit-med-keywords") as HTMLInputElement).value = med.searchKeywords || "";
    (document.getElementById("edit-med-seo-title") as HTMLInputElement).value = med.seoMetaTitle || "";
    (document.getElementById("edit-med-seo-desc") as HTMLTextAreaElement).value = med.seoMetaDescription || "";

    // Load slider images
    editMedicineSliderImages = med.images ? [...med.images] : (med.image ? [med.image] : []);
    renderEditMedicineThumbs();

    // Show Edit popup
    const editModal = document.getElementById("store-edit-medicine-modal");
    editModal?.classList.remove("hidden");
  },
  removeAddMedicineSliderImage(index: number) {
    addMedicineSliderImages.splice(index, 1);
    renderAddMedicineThumbs();
  },
  removeEditMedicineSliderImage(index: number) {
    editMedicineSliderImages.splice(index, 1);
    renderEditMedicineThumbs();
  }
});

function loadDynamicCategories() {
  const selectEl = document.getElementById("med-category") as HTMLSelectElement;
  if (!selectEl) return;

  onValue(ref(db, "categories"), (snapshot) => {
    if (snapshot.exists()) {
      let optionsHtml = "";
      snapshot.forEach((child) => {
        const cat = child.val();
        if (cat.active && cat.code !== "ALL") {
          optionsHtml += `<option value="${cat.name}">${cat.name}</option>`;
        }
      });
      if (optionsHtml) {
        selectEl.innerHTML = optionsHtml;
      }
    }
  });
}

// === REAL-TIME MERCHANT RIDER TRACKING PIPELINE ===
let activeStoreTrackingUnsubscribe: any = null;
let activeRiderTrackingUnsubscribe: any = null;

function closeRiderTracking() {
  const modal = document.getElementById("store-tracking-modal");
  const content = document.getElementById("store-tracking-modal-content");
  if (content) content.classList.add("translate-y-full");
  setTimeout(() => {
    if (modal) modal.classList.add("hidden");
  }, 300);

  if (activeStoreTrackingUnsubscribe) {
    activeStoreTrackingUnsubscribe();
    activeStoreTrackingUnsubscribe = null;
  }
  if (activeRiderTrackingUnsubscribe) {
    activeRiderTrackingUnsubscribe();
    activeRiderTrackingUnsubscribe = null;
  }
}

document.getElementById("btn-close-store-tracking")?.addEventListener("click", closeRiderTracking);

Object.assign(window, {
  trackAssignedRider(orderId: string) {
    const modal = document.getElementById("store-tracking-modal");
    const content = document.getElementById("store-tracking-modal-content");
    if (modal) modal.classList.remove("hidden");
    setTimeout(() => {
      if (content) content.classList.remove("translate-y-full");
    }, 50);

    const trackerOrderId = document.getElementById("store-track-order-id");
    if (trackerOrderId) trackerOrderId.innerText = `Order ID: #${orderId.substring(0, 8).toUpperCase()}`;

    // Clean previous subscriptions
    if (activeStoreTrackingUnsubscribe) activeStoreTrackingUnsubscribe();
    if (activeRiderTrackingUnsubscribe) activeRiderTrackingUnsubscribe();

    activeStoreTrackingUnsubscribe = onValue(ref(db, `orders/${orderId}`), (orderSnap) => {
      if (!orderSnap.exists()) return;
      const o = orderSnap.val();

      const userLat = o.userLocation?.lat || 12.9716;
      const userLng = o.userLocation?.lng || 77.5946;

      if (o.deliveryId) {
        activeRiderTrackingUnsubscribe = onValue(ref(db, `deliveryboy1/${o.deliveryId}`), (riderSnap) => {
          if (!riderSnap.exists()) return;
          const r = riderSnap.val();

          const riderName = document.getElementById("store-track-rider-name");
          if (riderName) riderName.innerText = r.name || r.fullName || "Express Courier Rider";

          const riderLat = r.location?.lat || 12.9716;
          const riderLng = r.location?.lng || 77.5946;

          // Standard distance estimation
          const dist = calculateDistance(riderLat, riderLng, userLat, userLng);
          const eta = Math.ceil((dist / 35) * 60) + 5;

          const trackEta = document.getElementById("store-track-eta");
          if (trackEta) trackEta.innerText = `ETA: ${eta} MINS (${dist.toFixed(1)} KM)`;

          const trackStatus = document.getElementById("store-track-rider-status");
          if (trackStatus) trackStatus.innerText = "Rider dispatch is active, heading towards patient house!";

          // Trigger dynamic Mappls drawing on modal map container
          updateLeafletMap("store-tracking-map", riderLat, riderLng, userLat, userLng, false);
        });
      } else {
        const trackEta = document.getElementById("store-track-eta");
        if (trackEta) trackEta.innerText = "STANDBY";
        const trackStatus = document.getElementById("store-track-rider-status");
        if (trackStatus) trackStatus.innerText = "Standby order acceptance queue...";
        updateLeafletMap("store-tracking-map", userLat, userLng, userLat, userLng, true);
      }
    });
  }
});

// === AI MEDICINE AUTO-FILL SYSTEM ===
const addFormFieldsMap = {
  "med-brand": "brand",
  "med-generic": "genericName",
  "med-manufacturer": "manufacturer",
  "med-dosage": "strength",
  "med-pack-size": "packSize",
  "med-uses": "uses",
  "med-benefits": "benefits",
  "med-side-effects": "sideEffects",
  "med-warnings": "warnings",
  "med-storage": "storage",
  "med-composition": "composition",
  "med-strength": "strength",
  "med-dosage-form": "dosageForm",
  "med-prescription-req": "prescriptionRequired",
  "med-directions": "directionsForUse",
  "med-dosage-inst": "dosageInstructions",
  "med-safety-advice": "safetyAdvice",
  "med-drug-interactions": "drugInteractions",
  "med-contraindications": "contraindications",
  "med-age-group": "ageGroup",
  "med-pregnancy-safety": "pregnancySafety",
  "med-breastfeeding-safety": "breastfeedingSafety",
  "med-driving-safety": "drivingSafety",
  "med-alcohol-warning": "alcoholWarning",
  "med-food-interaction": "foodInteraction",
  "med-mrp": "mrp",
  "med-gst-rate": "gstRate",
  "med-hsn-code": "hsnCode",
  "med-tags": "medicineTags",
  "med-keywords": "searchKeywords",
  "med-seo-title": "seoMetaTitle",
  "med-seo-desc": "seoMetaDescription",
  "med-desc": "description",
  "med-category": "category"
};

const editFormFieldsMap = {
  "edit-med-brand": "brand",
  "edit-med-generic": "genericName",
  "edit-med-manufacturer": "manufacturer",
  "edit-med-dosage": "strength",
  "edit-med-pack-size": "packSize",
  "edit-med-uses": "uses",
  "edit-med-benefits": "benefits",
  "edit-med-side-effects": "sideEffects",
  "edit-med-warnings": "warnings",
  "edit-med-storage": "storage",
  "edit-med-composition": "composition",
  "edit-med-strength": "strength",
  "edit-med-dosage-form": "dosageForm",
  "edit-med-prescription-req": "prescriptionRequired",
  "edit-med-directions": "directionsForUse",
  "edit-med-dosage-inst": "dosageInstructions",
  "edit-med-safety-advice": "safetyAdvice",
  "edit-med-drug-interactions": "drugInteractions",
  "edit-med-contraindications": "contraindications",
  "edit-med-age-group": "ageGroup",
  "edit-med-pregnancy-safety": "pregnancySafety",
  "edit-med-breastfeeding-safety": "breastfeedingSafety",
  "edit-med-driving-safety": "drivingSafety",
  "edit-med-alcohol-warning": "alcoholWarning",
  "edit-med-food-interaction": "foodInteraction",
  "edit-med-mrp": "mrp",
  "edit-med-gst-rate": "gstRate",
  "edit-med-hsn-code": "hsnCode",
  "edit-med-tags": "medicineTags",
  "edit-med-keywords": "searchKeywords",
  "edit-med-seo-title": "seoMetaTitle",
  "edit-med-seo-desc": "seoMetaDescription",
  "edit-med-desc": "description",
  "edit-med-category": "category"
};

async function runMedicineAutofill(nameInputId: string, fieldsMap: Record<string, string>, statusId: string, btnId: string) {
  const nameInput = document.getElementById(nameInputId) as HTMLInputElement;
  const nameVal = nameInput?.value.trim();
  if (!nameVal) {
    showToast("Please enter a medicine name first to trigger AI auto-fill!", "error");
    return;
  }

  const statusEl = document.getElementById(statusId);
  const btnEl = document.getElementById(btnId) as HTMLButtonElement;

  if (statusEl) statusEl.classList.remove("hidden");
  if (btnEl) btnEl.disabled = true;

  try {
    const res = await fetch("/api/medicine-autofill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameVal })
    });

    if (!res.ok) {
      throw new Error("Could not fetch clinical auto-fill specifications.");
    }

    const data = await res.json();
    let fillCount = 0;

    for (const [elementId, jsonKey] of Object.entries(fieldsMap)) {
      const inputEl = document.getElementById(elementId) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (!inputEl) continue;

      const aiVal = data[jsonKey];
      if (aiVal === undefined || aiVal === null || aiVal === "") {
        continue; // Confidence check: keep blank if AI isn't confident
      }

      // Check if value is already populated manually
      let isDefaultOrEmpty = false;
      if (inputEl.tagName === "SELECT") {
        isDefaultOrEmpty = inputEl.value === "" || inputEl.value === "No";
      } else {
        const valTrimmed = inputEl.value.trim();
        isDefaultOrEmpty = !valTrimmed || valTrimmed === "0";
      }

      if (isDefaultOrEmpty) {
        inputEl.value = aiVal.toString();
        fillCount++;

        // Clearly highlight auto-filled fields
        inputEl.classList.add("border-indigo-400", "bg-indigo-50/20", "ring-1", "ring-indigo-400");

        // Clear highlight upon focus/change/input
        const clearHighlight = () => {
          inputEl.classList.remove("border-indigo-400", "bg-indigo-50/20", "ring-1", "ring-indigo-400");
        };
        inputEl.addEventListener("focus", clearHighlight, { once: true });
        inputEl.addEventListener("input", clearHighlight, { once: true });
        inputEl.addEventListener("change", clearHighlight, { once: true });
      }
    }

    if (fillCount > 0) {
      showToast(`AI auto-filled ${fillCount} empty fields with clinical data!`, "success");

      // Auto-expand advanced panel for Add Medicine form if collapsed
      if (nameInputId === "med-name") {
        const advancedPanel = document.getElementById("add-advanced-specs-collapsed");
        if (advancedPanel && advancedPanel.classList.contains("hidden")) {
          advancedPanel.classList.remove("hidden");
          document.getElementById("icon-add-advanced-chev")?.classList.replace("fa-chevron-down", "fa-chevron-up");
        }
      }
    } else {
      showToast("No empty fields were available or no confidence clinical data found.", "info");
    }
  } catch (err: any) {
    showToast(err.message || "Auto-fill failed.", "error");
  } finally {
    if (statusEl) statusEl.classList.add("hidden");
    if (btnEl) btnEl.disabled = false;
  }
}

document.getElementById("btn-add-ai-autofill")?.addEventListener("click", () => {
  runMedicineAutofill("med-name", addFormFieldsMap, "add-ai-status", "btn-add-ai-autofill");
});

document.getElementById("btn-edit-ai-autofill")?.addEventListener("click", () => {
  runMedicineAutofill("edit-med-name", editFormFieldsMap, "edit-ai-status", "btn-edit-ai-autofill");
});
