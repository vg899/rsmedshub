import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, get, update, remove } from "firebase/database";
import { showToast, uploadToCloudinary, updateLeafletMap, calculateDistance } from "./utils";

// Core State variables
let loggedInMerchant: any = null;
let currentStoreId = "";
let currentStoreDetail: any = null;
let activeTab: "orders" | "inventory" | "profile" = "orders";

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
    window.location.href = "/index.html";
    return;
  }

  loggedInMerchant = user;
  currentStoreId = user.uid;

  // Verify Role is store
  get(ref(db, `users/${user.uid}`)).then((snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (data.role !== "store") {
        showToast("Access Denied: Redirecting to your panel...", "info");
        if (data.role === "admin") {
          window.location.href = "/admin.html";
        } else if (data.role === "user") {
          window.location.href = "/user.html";
        } else if (data.role === "delivery") {
          window.location.href = "/delivery.html";
        } else {
          signOut(auth).then(() => {
            window.location.href = "/index.html";
          });
        }
      } else {
        // Safe access confirmed
        document.getElementById("store-profile-header-name")!.innerText = data.name || "Pharmacy Merchant Node";
        syncStoreDashboard();
      }
    } else {
      signOut(auth).then(() => {
        window.location.href = "/index.html";
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
    window.location.href = "/index.html";
  }
});

// Synchronize Store dashboards and lists
function syncStoreDashboard() {
  loadDynamicCategories();
  // Subscribe store info details
  onValue(ref(db, `stores/${currentStoreId}`), (snapshot) => {
    if (snapshot.exists()) {
      currentStoreDetail = snapshot.val();
      document.getElementById("store-city-txt")!.innerText = `📍 ${currentStoreDetail.address?.split(",")[0] || "Bengaluru"}`;
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

const medFileInput = document.getElementById("med-file-input") as HTMLInputElement;
medFileInput?.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    medicineImageFile = target.files[0];
    document.getElementById("img-upload-txt")!.innerText = "Selected Gallery";
    document.getElementById("img-upload-icon")!.className = "fa-solid fa-file-circle-check text-indigo-400 mr-2";
  }
});

document.getElementById("form-add-medicine")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = (document.getElementById("med-name") as HTMLInputElement).value.trim();
  const price = parseFloat((document.getElementById("med-price") as HTMLInputElement).value);
  const stock = parseInt((document.getElementById("med-stock") as HTMLInputElement).value);
  const category = (document.getElementById("med-category") as HTMLSelectElement).value;
  const desc = (document.getElementById("med-desc") as HTMLInputElement).value.trim();

  const submitBtn = document.getElementById("btn-submit-med") as HTMLButtonElement;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Syncing image...`;

  if (!medicineImageFile) {
    showToast("Please pick a medicine label image from gallery", "error");
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
      storeName: currentStoreDetail.name || "Apothecary Outlet",
      name,
      price,
      stock,
      category,
      description: desc,
      image: labelUrl
    };

    set(ref(db, `medicines/${medId}`), payload).then(() => {
      showToast(`${name} added to medicine catalog!`, "success");
      
      // Reset form variables
      medicineImageFile = null;
      (document.getElementById("form-add-medicine") as HTMLFormElement).reset();
      document.getElementById("img-upload-txt")!.innerText = "Select Gallery";
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
            <h5 class="font-extrabold text-slate-900 truncate pr-5 leading-tight">${m.name}</h5>
            <button onclick="deleteProductFromInventory('${m.medicineId}')" class="text-rose-450 text-rose-500 absolute top-3 right-3 text-sm cursor-pointer hover:scale-110 transition-all">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
          <p class="text-[9px] text-slate-400 font-medium truncate leading-normal" title="${m.description}">${m.description || "N/A"}</p>
          
          <div class="flex items-center justify-between pt-1 flex-wrap gap-1.5">
            <div class="flex items-center gap-1">
              <span class="text-[9px] text-slate-400">Price: ₹</span>
              <input type="number" onchange="updateProductPriceValueMode('${m.medicineId}', this.value)" value="${m.price}" min="1" class="w-12 text-center p-0.5 border border-slate-200 rounded text-[10px] font-black focus:border-indigo-500 font-mono">
            </div>
            <div class="flex items-center gap-1">
              <span class="text-[9px] ${isLowStock ? "text-rose-600 animate-pulse font-extrabold" : "text-slate-450 text-slate-400"}">Stock:</span>
              <input type="number" onchange="updateProductStockValueMode('${m.medicineId}', this.value)" value="${m.stock}" min="0" class="w-12 text-center p-0.5 border border-slate-200 rounded text-[10px] font-black focus:border-indigo-500 font-mono">
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
