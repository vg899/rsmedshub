import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, get, update } from "firebase/database";
import { showToast, getCurrentGPS, calculateDistance, getRouteMapUrl, uploadToCloudinary } from "./utils";

// Core State variables
let loggedInRider: any = null;
let currentRiderId = "";
let currentRiderDetail: any = null;
let isDutyActive = true;
let activeOrderPayload: any = null;
let riderGPSInterval: any = null;

// HTML Elements
const btnDuty = document.getElementById("btn-toggle-pacing-status") as HTMLButtonElement;
const dutyTxt = document.getElementById("tracker-duty-txt")!;
const activeWorkspace = document.getElementById("rider-active-delivery-workspace") as HTMLDivElement;
const poolsSegment = document.getElementById("rider-pools-segment") as HTMLDivElement;
const poolsContainer = document.getElementById("rider-pools-container") as HTMLDivElement;

const proofBlock = document.getElementById("proof-delivery-camera-block") as HTMLDivElement;
const proofFileInput = document.getElementById("proof-file-input") as HTMLInputElement;
const actionBtn = document.getElementById("btn-delivery-progress-action") as HTMLButtonElement;

// Authentication Gates lock
onAuthStateChanged(auth, (user) => {
  if (!user) {
    showToast("Session expired. Log in to Rider Terminal.", "error");
    window.location.href = "/index.html";
    return;
  }

  loggedInRider = user;
  currentRiderId = user.uid;

  // Verify Role is delivery boy
  get(ref(db, `users/${user.uid}`)).then((snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (data.role !== "delivery") {
        signOut(auth).then(() => {
          window.location.href = "/index.html";
        });
      } else {
        // Safe access confirmed
        document.getElementById("delivery-profile-rider-name")!.innerText = data.name || "Delivery Express Agent";
        syncRiderBase();
      }
    } else {
      signOut(auth).then(() => {
        window.location.href = "/index.html";
      });
    }
  });
});

// Duty status toggle
btnDuty?.addEventListener("click", () => {
  isDutyActive = !isDutyActive;
  update(ref(db, `delivery/${currentRiderId}`), { active: isDutyActive }).then(() => {
    updateDutyButtonUI();
    showToast(`Rider duty toggled ${isDutyActive ? "Online" : "Offline"} successfully!`, "info");
  });
});

function updateDutyButtonUI() {
  if (isDutyActive) {
    btnDuty.innerText = "ACTIVE ON";
    btnDuty.className = "mt-2 text-[10px] font-black py-1 px-2.5 bg-emerald-500 text-white rounded-lg block cursor-pointer text-center hover:scale-95 transition-all";
    dutyTxt.innerText = "Standby Ready duty";
    dutyTxt.className = "text-xs font-black tracking-tight flex items-center gap-1 text-emerald-600";
  } else {
    btnDuty.innerText = "OFFLINE OFF";
    btnDuty.className = "mt-2 text-[10px] font-black py-1 px-2.5 bg-slate-400 text-white rounded-lg block cursor-pointer text-center hover:scale-95 transition-all";
    dutyTxt.innerText = "Rest Mode / Duty Off";
    dutyTxt.className = "text-xs font-black tracking-tight flex items-center gap-1 text-slate-400";
  }
}

// Sign out trigger
document.getElementById("btn-delivery-signout")?.addEventListener("click", async () => {
  if (confirm("Disconnect rider session from platform?")) {
    if (riderGPSInterval) clearInterval(riderGPSInterval);
    await signOut(auth);
    window.location.href = "/index.html";
  }
});

// Synchronize Rider dashboard
function syncRiderBase() {
  // Subscribe agent details
  onValue(ref(db, `delivery/${currentRiderId}`), (snapshot) => {
    if (snapshot.exists()) {
      currentRiderDetail = snapshot.val();
      isDutyActive = currentRiderDetail.active !== false;
      updateDutyButtonUI();
    }
  });

  // Watch notifications for live toast feedback!
  onValue(ref(db, `notifications/${currentRiderId}`), (snapshot) => {
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const payload = child.val();
        if (payload && !payload.notified) {
          showToast(`🔔 Alert: ${payload.body}`, "info");
          update(ref(db, `notifications/${currentRiderId}/${child.key}`), { notified: true });
        }
      });
    }
  });

  // Start background periodic mock simulation of GPS locations
  boostrapRiderGPSUpdates();

  // Watch and sync list changes
  subscribeTaskPools();
}

// Map parameters tracking simulator
function boostrapRiderGPSUpdates() {
  if (riderGPSInterval) clearInterval(riderGPSInterval);

  // Every 12 seconds, get location or slightly adjust mocks coordinates to represent pacing movement!
  riderGPSInterval = setInterval(async () => {
    try {
      const live = await getCurrentGPS();
      // Write coordinates under delivery boy node profile
      update(ref(db, `delivery/${currentRiderId}/location`), {
        lat: live.lat,
        lng: live.lng
      });
    } catch (e) {
      // Mock tracking adjustments representing delivery transit motion towards target coordinate cities (Bengaluru Indigo)
      if (activeOrderPayload) {
        // Stepwise coordinate adjust simulation
        const targetLat = activeOrderPayload.userLocation?.lat || 12.9716;
        const targetLng = activeOrderPayload.userLocation?.lng || 77.5946;
        
        const currentLat = currentRiderDetail?.location?.lat || 12.9716;
        const currentLng = currentRiderDetail?.location?.lng || 77.5946;

        const nextLat = currentLat + (targetLat - currentLat) * 0.15;
        const nextLng = currentLng + (targetLng - currentLng) * 0.15;

        update(ref(db, `delivery/${currentRiderId}/location`), {
          lat: nextLat,
          lng: nextLng
        });
      }
    }
  }, 12000);
}

// Subscribe task lists and operations
let globalOrdersCache: any[] = [];

function subscribeTaskPools() {
  onValue(ref(db, "orders"), (snapshot) => {
    globalOrdersCache = [];
    activeOrderPayload = null;
    let accumulatedShares = 0;

    snapshot.forEach((child) => {
      const o = child.val();
      globalOrdersCache.push(o);

      if (o.status === "delivered" && o.deliveryId === currentRiderId) {
        accumulatedShares += (o.deliveryCharge || 40);
      }

      if (o.deliveryId === currentRiderId && o.status !== "delivered") {
        activeOrderPayload = o;
      }
    });

    // Update Stats indicators
    document.getElementById("rider-stat-earnings")!.innerText = `₹${accumulatedShares}`;
    renderRiderDashboardViews();
  });
}

function renderRiderDashboardViews() {
  const cntPools = document.getElementById("cnt-pools-indicator")!;
  const countsStats = document.getElementById("rider-stat-pools")!;

  if (activeOrderPayload) {
    // Rider is busy finishing a job! Let's show navigation map and hide job pool listings to keep focus on road safety!
    poolsSegment.classList.add("hidden");
    activeWorkspace.classList.remove("hidden");
    countsStats.innerText = "0";
    cntPools.innerText = "0 Busy Duty";

    renderRiderActiveWorkspace(activeOrderPayload);
  } else {
    // Rider is ready to accept a job! Let's list available packed pools.
    activeWorkspace.classList.add("hidden");
    poolsSegment.classList.remove("remove");
    poolsSegment.classList.remove("hidden");

    // Filter orders in "packed" stage without assigned delivery boy
    const pools = globalOrdersCache.filter((o) => o.status === "packed");
    cntPools.innerText = `${pools.length} Pools Available`;
    countsStats.innerText = pools.length.toString();

    renderRiderPoolList(pools);
  }

  // Render past collections
  renderCompletedSettlementsList();
}

// 1. RENDER ACTIVE JOB PROGRESS NAVIGATION BOARD
let selectedProofImageFile: File | null = null;

function renderRiderActiveWorkspace(o: any) {
  const mapImg = document.getElementById("rider-map-img") as HTMLImageElement;
  const mapEta = document.getElementById("rider-map-eta")!;
  const pickupStoreName = document.getElementById("active-pickup-store-name")!;
  const pickupStoreAddr = document.getElementById("active-pickup-store-addr")!;
  const dropoffUser = document.getElementById("active-dropoff-user")!;
  const dropoffAddr = document.getElementById("active-dropoff-addr")!;

  pickupStoreName.innerText = o.storeName || "Pharmacy Outlet";
  pickupStoreAddr.innerText = "Operational partner dispensary node";
  dropoffUser.innerText = o.userName || "Recipient Patient";
  dropoffAddr.innerText = o.userAddress || "Target client coordinates";

  // Coordinates data resolution
  const riderLat = currentRiderDetail?.location?.lat || 12.9716;
  const riderLng = currentRiderDetail?.location?.lng || 77.5946;
  const userLat = o.userLocation?.lat || 12.9716;
  const userLng = o.userLocation?.lng || 77.5946;

  const distance = calculateDistance(riderLat, riderLng, userLat, userLng);
  const eta = Math.ceil((distance / 35) * 60) + 2;

  mapEta.innerText = `ETA: ${eta} Mins (${distance} KM)`;
  mapImg.src = getRouteMapUrl(riderLat, riderLng, userLat, userLng);

  // Status controls progressions mapping
  actionBtn.disabled = false;
  actionBtn.className = "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow transition-all cursor-pointer text-center text-xs hover:-translate-y-0.5";

  if (o.status === "packed") {
    actionBtn.innerText = "MARK MEDS PICKED & OUT FOR DELIVERY";
    actionBtn.onclick = () => updateRiderProgressionState(o.orderId, "out");
    proofBlock.classList.add("hidden");
  } else if (o.status === "out") {
    actionBtn.innerText = "DELIVER MEDICINES & COLLECT CASH";
    actionBtn.onclick = () => confirmHandoverFinalStep(o.orderId);
    proofBlock.classList.remove("hidden");
    actionBtn.className = "w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl shadow transition-all cursor-pointer text-center text-xs hover:-translate-y-0.5";
  }
}

// Camera proof trigger file tracker mapping
proofFileInput?.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    selectedProofImageFile = target.files[0];
    document.getElementById("proof-txt")!.innerText = "Receipt Snapped!";
    document.getElementById("proof-icon")!.className = "fa-solid fa-file-image text-[16px] text-indigo-400 mr-2";
  }
});

async function confirmHandoverFinalStep(orderId: string) {
  if (!selectedProofImageFile) {
    showToast("Requirement: Snap camera proof image of delivered medicine handovers.", "error");
    return;
  }

  actionBtn.disabled = true;
  actionBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Completing payout...`;

  try {
    showToast("Uploading delivery proof artifact...", "info");
    const proofUrl = await uploadToCloudinary(selectedProofImageFile);
    
    // Complete Order status in database
    await update(ref(db, `orders/${orderId}`), {
      status: "delivered",
      proofImage: proofUrl,
      "timeline/deliveredTime": Date.now()
    });

    // Reset rider status
    await update(ref(db, `delivery/${currentRiderId}`), {
      status: "free"
    });

    showToast("Delivery verified! Payout recorded successfully.", "success");
    selectedProofImageFile = null;
    document.getElementById("proof-txt")!.innerText = "Snap Camera Photo";
    document.getElementById("proof-icon")!.className = "fa-solid fa-plus-circle text-lg text-indigo-500 mr-2";
    proofBlock.classList.add("hidden");

  } catch (error) {
    showToast("Checkout proof uploading failed. Please retry.", "error");
    actionBtn.disabled = false;
    actionBtn.innerHTML = "DELIVER MEDICINES & COLLECT CASH";
  }
}

function updateRiderProgressionState(orderId: string, nextStatus: string) {
  update(ref(db, `orders/${orderId}`), {
    status: nextStatus,
    [`timeline/${nextStatus}Time`]: Date.now()
  }).then(() => {
    showToast("Delivery progress updated securely!", "success");
  });
}

// 2. RENDER PACKED JOBS POOL LIST
function renderRiderPoolList(pools: any[]) {
  if (pools.length === 0) {
    poolsContainer.innerHTML = `
      <div class="text-center py-12 text-slate-400 bg-white border border-slate-100 rounded-3xl p-6">
        <i class="fa-solid fa-box-open text-4xl mb-2 text-slate-200"></i>
        <p class="text-xs font-semibold">No operational packed med orders ready for pickups currently.</p>
      </div>
    `;
    return;
  }

  poolsContainer.innerHTML = pools.map((o) => `
    <div class="bg-white rounded-3xl border border-slate-100 p-4 shadow-xs space-y-3 font-medium text-xs">
      <div class="flex items-center justify-between border-b border-slate-50 pb-2">
        <div>
          <strong class="font-extrabold text-slate-900 text-sm">Order: #${o.orderId.substring(0,8).toUpperCase()}</strong>
          <p class="text-[9px] text-slate-450 text-slate-400 font-mono mt-0.5">${new Date(o.createdAt).toLocaleTimeString()}</p>
        </div>
        <span class="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">RIDER PAYOUT: ₹${o.deliveryCharge || 40}</span>
      </div>

      <div class="space-y-2">
        <div class="flex items-start gap-1.5 leading-normal">
          <i class="fa-solid fa-house-medical text-indigo-500 mt-0.5"></i>
          <div>
            <span class="text-[9px] text-slate-400 block font-bold leading-none">PICKUP DISPENSARY</span>
            <strong class="text-slate-800">${o.storeName}</strong>
          </div>
        </div>
        <div class="flex items-start gap-1.5 leading-normal">
          <i class="fa-solid fa-map-pin text-rose-500 mt-0.5"></i>
          <div>
            <span class="text-[9px] text-slate-400 block font-bold leading-none">PATIENT DESTINATION</span>
            <strong class="text-slate-700 font-bold block truncate w-64" title="${o.userAddress}">${o.userAddress}</strong>
          </div>
        </div>
      </div>

      <div class="pt-2 border-t border-slate-50 text-[10px] flex justify-between items-center">
        <span>COD Cash Collect: <strong class="font-mono text-indigo-700">₹${Math.round(o.total)}</strong></span>
        <button onclick="acceptPoolDeliveryJob('${o.orderId}')" class="bg-amber-500 hover:bg-amber-600 text-white font-bold py-1.5 px-4 rounded-xl shadow cursor-pointer text-[10px] hover:-translate-y-0.5 transition-all">
          Accept Job Dispatch
        </button>
      </div>
    </div>
  `).join("");
}

Object.assign(window, {
  acceptPoolDeliveryJob(orderId: string) {
    if (!isDutyActive) {
      showToast("Toggled Offline. Turn on duty to operate pool dispatches.", "error");
      return;
    }

    showToast("Verifying slot...", "info");
    
    // Assign delivery details elements under profile
    update(ref(db, `orders/${orderId}`), {
      status: "out",
      deliveryId: currentRiderId,
      deliveryName: currentRiderDetail.name || "Express Partner",
      deliveryPhone: currentRiderDetail.mobile || "9988776655",
      "timeline/transitTime": Date.now()
    }).then(() => {
      // Mark rider busy
      update(ref(db, `delivery/${currentRiderId}`), {
        status: "busy"
      }).then(() => {
        showToast("Job accepted. Dispatched navigation maps!", "success");
      });
    });
  }
});

// 3. COMPLETED SETTLEMENT REPORTS DISPLAY
function renderCompletedSettlementsList() {
  const container = document.getElementById("rider-settlements-history-list")!;
  const completed = globalOrdersCache.filter((o) => o.status === "delivered" && o.deliveryId === currentRiderId);

  if (completed.length === 0) {
    container.innerHTML = `<p class="text-[10px] text-slate-400 py-4 text-center font-semibold">Ready to ride? Standby job dispatch lists.</p>`;
    return;
  }

  // Sort descending
  completed.sort((a,b) => b.createdAt - a.createdAt);

  container.innerHTML = completed.map((o) => `
    <div class="bg-white rounded-xl border border-dashed border-slate-150 p-3 flex justify-between items-center text-[10px] font-semibold text-slate-700">
      <div>
        <strong class="text-slate-800">Job Order #${o.orderId.substring(0,8).toUpperCase()}</strong>
        <p class="text-[9px] text-slate-400 font-mono mt-0.5">${new Date(o.createdAt).toLocaleDateString()} completed</p>
      </div>
      <div class="text-right">
        <span class="text-emerald-600 block font-black">+₹${o.deliveryCharge || 40}</span>
        <span class="text-[8px] text-slate-400 font-bold uppercase">Settled</span>
      </div>
    </div>
  `).join("");
}
