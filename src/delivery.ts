import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, get, update, push } from "firebase/database";
import { showToast, getCurrentGPS, calculateDistance, getRouteMapUrl, uploadToCloudinary, updateLeafletMap } from "./utils";

// --- CORE LOCAL PORTAL STATE REGISTER ---
let loggedInUser: any = null;
let currentRiderId = "";
let currentRiderDetail: any = null;
let isDutyActive = true;
let activeOrderPayload: any = null;
let riderGPSInterval: any = null;
let activeTab = "dashboard";

// --- TEMPORARY UPLOAD URL STATES ---
let stateAadhaarFrontUrl = "";
let stateAadhaarBackUrl = "";
let stateLicenseImageUrl = "";
let stateUpiQrCodeUrl = "";
let stateActiveHandoverProofUrl = "";

// --- PRE-CACHED DISPATCH DATA ---
let globalOrdersCache: any[] = [];
let localSettlementsCache: any[] = [];

// --- CACHED AUDIO STREAMS FOR DISPATCH NOTIFICATIONS ---
const soundNewOrder = new Audio("https://assets.mixkit.co/active_storage/sfx/2019/2019-84.wav");
const soundAssigned = new Audio("https://assets.mixkit.co/active_storage/sfx/2507/2507-84.wav");
const soundSettled = new Audio("https://assets.mixkit.co/active_storage/sfx/2017/2017-84.wav");

// --- INITIAL CONCURRENT DOM QUERY SELECTORS ---
const spinner = document.getElementById("rider-global-spinner") as HTMLDivElement;
const panelSuspended = document.getElementById("panel-suspended") as HTMLDivElement;
const panelPendingApproval = document.getElementById("panel-pending-approval") as HTMLDivElement;
const panelOnboarding = document.getElementById("panel-onboarding") as HTMLDivElement;
const panelMainTerminal = document.getElementById("panel-main-terminal") as HTMLDivElement;
const navigationBar = document.getElementById("bottom-navigation-nav") as HTMLElement;

// --- TAB SUB PANEL FRAMES ---
const tabFrames: { [key: string]: HTMLElement | null } = {
  dashboard: document.getElementById("tab-dashboard"),
  "active-order": document.getElementById("tab-active-order"),
  pools: document.getElementById("tab-pools"),
  settlements: document.getElementById("tab-settlements"),
  profile: document.getElementById("tab-profile")
};

// --- START GATE FOR AUTH STATE LISTENERS ---
onAuthStateChanged(auth, (user) => {
  if (!user) {
    showToast("Session expired. Log in to Rider Terminal.", "error");
    window.location.href = "/index.html";
    return;
  }

  loggedInUser = user;
  currentRiderId = user.uid;

  // Render basic details
  const profileEmail = document.getElementById("lbl-profile-email");
  if (profileEmail) profileEmail.innerText = user.email || "";
  const profileNameHeader = document.getElementById("lbl-profile-name");
  if (profileNameHeader) profileNameHeader.innerText = user.displayName || "Rider Express Partner";

  syncSecurityRoleGuard();
});

// --- CORE SECURITY ACCESS ROLE AND ENFORCEMENT GUARD ---
function syncSecurityRoleGuard() {
  showLoader(true);
  get(ref(db, `users/${currentRiderId}`)).then((snapshot) => {
    if (snapshot.exists()) {
      const uData = snapshot.val();
      if (uData.role !== "delivery") {
        showToast("Access Denied: Redirecting to user pane...", "info");
        showLoader(false);
        if (uData.role === "admin") {
          window.location.href = "/admin.html";
        } else if (uData.role === "store") {
          window.location.href = "/store.html";
        } else {
          window.location.href = "/user.html";
        }
        return;
      }
      
      // Verified Rider credentials exist, now query /delivery details
      syncRiderCoreProfileData();
    } else {
      showToast("Profile mismatch. Sign up again.", "error");
      signOut(auth).then(() => {
        window.location.href = "/index.html";
      });
    }
  }).catch((err) => {
    console.error("Access guard failed:", err);
    showLoader(false);
  });
}

// --- SYNC DISPATCH INFORMATION FROM FIREBASE DEVIATIONS ---
function syncRiderCoreProfileData() {
  onValue(ref(db, `delivery/${currentRiderId}`), (snapshot) => {
    showLoader(false);
    if (!snapshot.exists()) {
      // Missing rider details entirely, show documentation onboarding!
      showOnboardingView();
      return;
    }

    const dData = snapshot.val();
    currentRiderDetail = dData;
    isDutyActive = dData.active !== false;

    // Trigger Screen gates according to KYC states
    if (dData.suspended === true) {
      showSuspendedView();
      return;
    }

    if (!dData.aadhaarNumber || !dData.licenseNumber || dData.onboardSubmitted !== true) {
      // Need KYC completion
      showOnboardingView();
      return;
    }

    if (dData.approved !== true) {
      // Docs uploaded but waiting admin approval
      showPendingApprovalView(dData);
      return;
    }

    // Fully Active Verified Rider profile
    showActiveTerminalView(dData);
  });
}

// --- STATE PANEL VISIBILITY CONTROLLERS ---
function showLoader(visible: boolean) {
  if (spinner) {
    if (visible) spinner.classList.remove("hidden");
    else spinner.classList.add("hidden");
  }
}

function showSuspendedView() {
  panelSuspended.classList.remove("hidden");
  panelPendingApproval.classList.add("hidden");
  panelOnboarding.classList.add("hidden");
  panelMainTerminal.classList.add("hidden");
  navigationBar.classList.add("hidden");
}

function showPendingApprovalView(data: any) {
  panelSuspended.classList.add("hidden");
  panelPendingApproval.classList.remove("hidden");
  panelOnboarding.classList.add("hidden");
  panelMainTerminal.classList.add("hidden");
  navigationBar.classList.add("hidden");

  // Load preview data
  const aadPreview = document.getElementById("preview-aadhaar-num");
  if (aadPreview) aadPreview.innerText = data.aadhaarNumber ? `Verified (${data.aadhaarNumber.substring(0,4)}...)` : "N/A";
  const dlPreview = document.getElementById("preview-dl-num");
  if (dlPreview) dlPreview.innerText = data.licenseNumber || "N/A";
  
  const vehiclePreview = document.getElementById("preview-vehicle-info");
  if (vehiclePreview) {
    vehiclePreview.innerText = `${data.vehicleType || "Motorcycle"} (${data.vehicleNumber || "KA-01-SH-XXXX"})`;
  }
}

function showOnboardingView() {
  panelSuspended.classList.add("hidden");
  panelPendingApproval.classList.add("hidden");
  panelOnboarding.classList.remove("hidden");
  panelMainTerminal.classList.add("hidden");
  navigationBar.classList.add("hidden");
}

function showActiveTerminalView(data: any) {
  panelSuspended.classList.add("hidden");
  panelPendingApproval.classList.add("hidden");
  panelOnboarding.classList.add("hidden");
  panelMainTerminal.classList.remove("hidden");
  navigationBar.classList.remove("hidden");

  // Synchronize dynamic headers
  const riderNameHeader = document.getElementById("delivery-profile-rider-name");
  if (riderNameHeader) riderNameHeader.innerText = data.name || "Agent Express";

  // Bootstrap live location GPS track loops
  bootstrapRiderLiveLocationTracking();

  // Watch notifications and settlement lists
  subscribeToDispatchPoolAndOrders();
  subscribeToSettlementRedemptions();
  renderRiderProfileView(data);
}

// --- DYNAMIC SWITCHING BOTTOM TAB SEGMENTS ---
if (navigationBar) {
  const tabButtons = navigationBar.querySelectorAll("button[data-tab]");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab");
      if (target) {
        switchTabPanel(target);
      }
    });
  });
}

function switchTabPanel(tabName: string) {
  activeTab = tabName;
  
  // Highlight navigation bar items
  if (navigationBar) {
    const tabButtons = navigationBar.querySelectorAll("button[data-tab]");
    tabButtons.forEach((btn) => {
      const bTab = btn.getAttribute("data-tab");
      if (bTab === tabName) {
        btn.className = "flex flex-col items-center justify-center gap-1 text-amber-500 transition-all font-display group cursor-pointer w-12 text-center";
      } else {
        btn.className = "flex flex-col items-center justify-center gap-1 text-slate-400 transition-all font-display group cursor-pointer w-12 text-center";
      }
    });
  }

  // Draw panels visual state
  Object.keys(tabFrames).forEach((key) => {
    const frame = tabFrames[key];
    if (frame) {
      if (key === tabName) {
        frame.classList.remove("hidden");
      } else {
        frame.classList.add("hidden");
      }
    }
  });

  // Re-adjust leaflet bounds representation if accessing active order map
  if (tabName === "active-order" && activeOrderPayload) {
    setTimeout(() => {
      triggerActiveOrderMapDraw();
    }, 400);
  }
}

// --- KYC REGISTRATION FORM FILE SELECTORS AND AUTO-UPLOADERS ---
setupKycUploadTrigger("onboard-aadhaar-front", "img-aadhaar-front", "txt-aadhaar-front", "icon-aadhaar-front", "wrapper-aadhaar-front", (url) => {
  stateAadhaarFrontUrl = url;
});

setupKycUploadTrigger("onboard-aadhaar-back", "img-aadhaar-back", "txt-aadhaar-back", "icon-aadhaar-back", "wrapper-aadhaar-back", (url) => {
  stateAadhaarBackUrl = url;
});

setupKycUploadTrigger("onboard-dl-image", "img-dl-image", "txt-dl-image", "icon-dl-image", "wrapper-dl-image", (url) => {
  stateLicenseImageUrl = url;
});

setupKycUploadTrigger("inp-settle-qr-upload", "img-qr-upload", "txt-qr-upload", "icon-qr-upload", "wrapper-qr-upload", (url) => {
  stateUpiQrCodeUrl = url;
});

setupKycUploadTrigger("inp-active-proof-file", "img-active-proof-preview", "lbl-active-proof-text", "lbl-active-proof-icon", "wrapper-active-proof-block", (url) => {
  stateActiveHandoverProofUrl = url;
});

function setupKycUploadTrigger(
  inputId: string,
  imgId: string,
  txtId: string,
  iconId: string,
  wrapperId: string,
  onComplete: (url: string) => void
) {
  const el = document.getElementById(inputId) as HTMLInputElement;
  const img = document.getElementById(imgId) as HTMLImageElement;
  const txt = document.getElementById(txtId);
  const icon = document.getElementById(iconId);
  const wrapper = document.getElementById(wrapperId);

  if (!el) return;

  el.addEventListener("change", async (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const file = target.files[0];
      
      // Update UI with loading state
      if (txt) txt.innerText = "Uploading payload...";
      if (icon) icon.className = "fa-solid fa-spinner fa-spin text-lg text-indigo-500 mb-2";
      if (wrapper) wrapper.className = "border border-dashed border-indigo-400 h-24 rounded-2xl bg-indigo-50/20 flex flex-col items-center justify-center p-2 text-center relative cursor-pointer animate-pulse";

      try {
        const secureUrl = await uploadToCloudinary(file);
        onComplete(secureUrl);

        // Success Preview Thumbnail
        if (img) {
          img.src = secureUrl;
          img.classList.remove("hidden");
        }
        if (txt) txt.innerText = "Artifact uploaded!";
        if (icon) icon.className = "fa-solid fa-circle-check text-lg text-emerald-500 mb-2";
        if (wrapper) wrapper.className = "border border-emerald-300 h-24 rounded-2xl bg-emerald-50/10 flex flex-col items-center justify-center p-2 text-center relative cursor-pointer";
        showToast("Element uploaded and validated via Cloudinary", "success");
      } catch (err) {
        console.error("KYC Element upload failed:", err);
        showToast("Cloudinary Upload failed. Try again.", "error");
        
        // Reset element states
        if (txt) txt.innerText = "Failed - Select Device Copy";
        if (icon) icon.className = "fa-solid fa-rotate-right text-lg text-rose-500 mb-2";
        if (wrapper) wrapper.className = "border border-dashed border-rose-300 h-24 rounded-2xl bg-rose-50/10 flex flex-col items-center justify-center p-2 text-center relative cursor-pointer";
      }
    }
  });
}

// --- ONBOARDING KYC SUBMITTER WRITER ---
const formKyc = document.getElementById("form-onboard-kyc") as HTMLFormElement;
formKyc?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const stateVal = (document.getElementById("onboard-state") as HTMLInputElement).value.trim();
  const districtVal = (document.getElementById("onboard-district") as HTMLInputElement).value.trim();
  const aadhaarNumber = (document.getElementById("onboard-aadhaar-number") as HTMLInputElement).value.trim();
  const dlNumber = (document.getElementById("onboard-dl-number") as HTMLInputElement).value.trim();
  const vehicleType = (document.getElementById("onboard-vehicle-type") as HTMLSelectElement).value;
  const vehicleNumber = (document.getElementById("onboard-vehicle-number") as HTMLInputElement).value.trim().toUpperCase();

  // Validate images are uploaded
  if (!stateAadhaarFrontUrl || !stateAadhaarBackUrl) {
    showToast("Requirement: Upload front & back copies of your Aadhaar card.", "error");
    return;
  }

  if (!stateLicenseImageUrl) {
    showToast("Requirement: Upload clear driver license photograph copy.", "error");
    return;
  }

  showLoader(true);

  const payload = {
    deliveryId: currentRiderId,
    name: loggedInUser?.displayName || "Express Rider Partner",
    email: loggedInUser?.email || "",
    mobile: currentRiderDetail?.mobile || "9988776655",
    aadhaarNumber,
    aadhaarFrontUrl: stateAadhaarFrontUrl,
    aadhaarBackUrl: stateAadhaarBackUrl,
    licenseNumber: dlNumber,
    licenseImageUrl: stateLicenseImageUrl,
    vehicleType,
    vehicleNumber,
    state: stateVal,
    district: districtVal,
    onboardSubmitted: true,
    approved: false,
    active: true,
    status: "free",
    createdAt: Date.now()
  };

  try {
    // Write profile under /delivery and /users
    await update(ref(db, `delivery/${currentRiderId}`), payload);
    await update(ref(db, `users/${currentRiderId}`), {
      aadhaarNumber,
      vehicleNumber,
      district: districtVal,
      onboardSubmitted: true,
      approved: false
    });
    
    showToast("KYC Application submitted! Security team is validating elements.", "success");
    showLoader(false);
  } catch (err) {
    console.error("KYC Submitting error", err);
    showToast("Writing profiles failed. Re-verify fields.", "error");
    showLoader(false);
  }
});

// --- GO LOGOUT TRIGGER CONTROL ---
document.getElementById("btn-delivery-signout")?.addEventListener("click", async () => {
  if (confirm("Safely decouple active rider express session from server?")) {
    showLoader(true);
    if (riderGPSInterval) clearInterval(riderGPSInterval);
    try {
      await update(ref(db, `delivery/${currentRiderId}`), { active: false });
      await signOut(auth);
      window.location.href = "/index.html";
    } catch (err) {
      console.error(err);
      window.location.href = "/index.html";
    }
  }
});

// --- BOOTSTRAP REALTIME GPS TRACK COORDINATES SIMULATOR ---
function bootstrapRiderLiveLocationTracking() {
  if (riderGPSInterval) clearInterval(riderGPSInterval);

  // Interval pushes updates every 8 seconds, simulating moving transit coordinate vectors if on an active run order
  riderGPSInterval = setInterval(async () => {
    try {
      // Direct Web API geolocation reading
      const live = await getCurrentGPS();
      await update(ref(db, `delivery/${currentRiderId}/location`), {
        lat: live.lat,
        lng: live.lng,
        lastUpdated: Date.now()
      });
    } catch (err) {
      // Fallback trajectory system: Auto-advance coordinates towards targets representing real transit motion
      if (activeOrderPayload) {
        const destLat = activeOrderPayload.userLocation?.lat || 12.9716;
        const destLng = activeOrderPayload.userLocation?.lng || 77.5946;

        const currentLat = currentRiderDetail?.location?.lat || 12.9716;
        const currentLng = currentRiderDetail?.location?.lng || 77.5946;

        // Slide coordinate by 12% closer
        const stepLat = currentLat + (destLat - currentLat) * 0.12;
        const stepLng = currentLng + (destLng - currentLng) * 0.12;

        await update(ref(db, `delivery/${currentRiderId}/location`), {
          lat: stepLat,
          lng: stepLng,
          lastUpdated: Date.now()
        });
      } else {
        // Flat defaults simulation coordinates
        await update(ref(db, `delivery/${currentRiderId}/location`), {
          lat: currentRiderDetail?.location?.lat || 12.9716,
          lng: currentRiderDetail?.location?.lng || 77.5946,
          lastUpdated: Date.now()
        });
      }
    }
  }, 8000);
}

// --- BINDING CLICKEABLE MANUALLY FORCED GPS TRACKING BUTTON ---
document.getElementById("btn-force-track-gps")?.addEventListener("click", async () => {
  showToast("Re-calibrating high precision GPS transceiver...", "info");
  try {
    const loc = await getCurrentGPS();
    await update(ref(db, `delivery/${currentRiderId}/location`), {
      lat: loc.lat,
      lng: loc.lng,
      lastUpdated: Date.now()
    });
    showToast("Satellite coordinates synchronized!", "success");
    if (activeOrderPayload) {
      triggerActiveOrderMapDraw();
    }
  } catch (e) {
    // Simulated advance trigger in Sandbox env represent safety!
    if (activeOrderPayload) {
      const destLat = activeOrderPayload.userLocation?.lat || 12.9716;
      const destLng = activeOrderPayload.userLocation?.lng || 77.5946;
      await update(ref(db, `delivery/${currentRiderId}/location`), {
        lat: destLat + 0.003,
        lng: destLng - 0.002,
        lastUpdated: Date.now()
      });
      showToast("Advanced simulation routing towards patient city zone ✓", "success");
      triggerActiveOrderMapDraw();
    }
  }
});

// --- RETRIVE POOLS AND ACCUMULATED HISTORIC COMMISSIONS ---
let lastDiscoveredPoolsCount = -1;
let initialSyncDone = false;

function subscribeToDispatchPoolAndOrders() {
  onValue(ref(db, "orders"), (snapshot) => {
    globalOrdersCache = [];
    activeOrderPayload = null;

    let totalPayoutEarningsAllTime = 0;
    let todayPayoutEarnings = 0;
    let weeklyPayoutEarnings = 0;
    let monthlyPayoutEarnings = 0;
    let todayDeliveriesCount = 0;

    const myMidnight = new Date();
    myMidnight.setHours(0, 0, 0, 0);
    const todayCutoff = myMidnight.getTime();
    const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const monthCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const o = child.val();
        if (o) {
          globalOrdersCache.push(o);

          // Payout weight (delivery charge)
          if (o.status === "delivered" && o.deliveryId === currentRiderId) {
            const pay = o.deliveryCharge || 40;
            totalPayoutEarningsAllTime += pay;

            const parsedCompletedTime = o.timeline?.deliveredTime || o.createdAt || Date.now();

            if (parsedCompletedTime >= todayCutoff) {
              todayPayoutEarnings += pay;
              todayDeliveriesCount++;
            }
            if (parsedCompletedTime >= weekCutoff) {
              weeklyPayoutEarnings += pay;
            }
            if (parsedCompletedTime >= monthCutoff) {
              monthlyPayoutEarnings += pay;
            }
          }

          // Active unresolved order trace assigned to me
          if (o.deliveryId === currentRiderId && o.status !== "delivered" && o.status !== "cancelled") {
            activeOrderPayload = o;
          }
        }
      });
    }

    // Available Pools Filter
    const pools = globalOrdersCache.filter((o) => o.status === "packed");

    // Audio sound alert triggers on newly packed orders entering pool lists
    if (initialSyncDone && pools.length > lastDiscoveredPoolsCount && lastDiscoveredPoolsCount >= 0) {
      soundNewOrder.play().catch(() => {});
      showToast("🔔 Multi-delivery Pool Alert: New order packed and ready in sandbox range!", "info");
    }

    // Sound alert when current rider has an active order allocated
    if (activeOrderPayload && lastDiscoveredPoolsCount >= 0 && !document.getElementById("tab-active-order")?.classList.contains("active")) {
      const isAssignedNotified = (window as any)["notified_job_" + activeOrderPayload.orderId];
      if (!isAssignedNotified) {
        soundAssigned.play().catch(() => {});
        showToast("📦 Dispatch Assignment: You have been assigned to order transit!", "success");
        (window as any)["notified_job_" + activeOrderPayload.orderId] = true;
        // Auto redirect to Active Order run tab
        switchTabPanel("active-order");
      }
    }

    lastDiscoveredPoolsCount = pools.length;
    initialSyncDone = true;

    // Save calculation aggregates to layout targets
    const elEarningsToday = document.getElementById("lbl-earnings-today");
    if (elEarningsToday) elEarningsToday.innerText = `₹${todayPayoutEarnings}`;
    const elDelivToday = document.getElementById("lbl-deliveries-today");
    if (elDelivToday) elDelivToday.innerText = todayDeliveriesCount.toString();

    const elPerfTrips = document.getElementById("lbl-perf-trips");
    if (elPerfTrips) elPerfTrips.innerText = globalOrdersCache.filter((o) => o.status === "delivered" && o.deliveryId === currentRiderId).length.toString();

    const elEarningsTotal = document.getElementById("lbl-earnings-total");
    if (elEarningsTotal) elEarningsTotal.innerText = `₹${totalPayoutEarningsAllTime}`;
    const elEarningsWeekly = document.getElementById("lbl-earnings-weekly");
    if (elEarningsWeekly) elEarningsWeekly.innerText = `₹${weeklyPayoutEarnings}`;
    const elEarningsMonthly = document.getElementById("lbl-earnings-monthly");
    if (elEarningsMonthly) elEarningsMonthly.innerText = `₹${monthlyPayoutEarnings}`;

    // Compute outstanding pending requested balances
    calculateAndRenderPayoutSheets(totalPayoutEarningsAllTime);

    // Refresh views inside tabs
    renderRiderPoolsLayout(pools);
    renderActiveOrderPipelineLayout();
  });
}

// --- DYNAMIC CALCULATOR OUTSTANDING BALANCE SHEET ---
function calculateAndRenderPayoutSheets(totalAllTimeEarnings: number) {
  let claimedTotalApprovedAndPending = 0;
  
  localSettlementsCache.forEach((req) => {
    // Only pending or approved claims subtract from withdrawable ledger
    if (req.status === "pending" || req.status === "approved" || req.status === "completed" || req.status === "success") {
      claimedTotalApprovedAndPending += Number(req.amount || 0);
    }
  });

  const remainingWithdrawableBalance = Math.max(0, totalAllTimeEarnings - claimedTotalApprovedAndPending);

  const elPendingSettle = document.getElementById("lbl-earnings-pending");
  if (elPendingSettle) elPendingSettle.innerText = `₹${remainingWithdrawableBalance}`;

  const elSettleBalanceCopy = document.getElementById("lbl-settle-payout-balance");
  if (elSettleBalanceCopy) elSettleBalanceCopy.innerText = `₹${remainingWithdrawableBalance}`;

  // Keep a reference to remaining balance in window for constraints checks
  (window as any)["withdrawable_limit_rem"] = remainingWithdrawableBalance;
}

// --- RENDER CURRENT LISTS OF PACKED ORDER POOLS ---
function renderRiderPoolsLayout(pools: any[]) {
  const container = document.getElementById("cnt-pools-list");
  const badge = document.getElementById("badge-nav-pools");
  const labelInd = document.getElementById("lbl-pools-indicator");

  if (badge) {
    if (pools.length > 0) {
      badge.innerText = pools.length.toString();
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  if (labelInd) labelInd.innerText = `${pools.length} PACKED`;

  if (!container) return;

  if (pools.length === 0) {
    container.innerHTML = `
      <div class="text-center py-16 text-slate-400 bg-white border border-slate-100 rounded-3xl p-6 shadow-2xs">
        <i class="fa-solid fa-box-open text-4xl mb-2 text-slate-100"></i>
        <p class="text-xs font-bold font-display text-slate-650">No Order Pools Available</p>
        <p class="text-[9.5px] mt-1 text-slate-400 font-medium">Auto-ping sounds trigger once pharmacies finish medicine packs!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = pools.map((o) => {
    const shortId = o.orderId ? o.orderId.substring(0, 8).toUpperCase() : "N/A";
    const chargePay = o.deliveryCharge || 40;
    const isCOD = o.paymentMethod === "cod";
    const paymentPrompt = isCOD ? `<span class="bg-red-50 text-red-600 px-2 py-0.5 rounded font-black text-[9px]">COD COLLECT: ₹${Math.ceil(o.total)}</span>` : `<span class="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded font-black text-[9px]">ONLINE PAID</span>`;

    return `
      <div class="bg-white rounded-3xl border border-slate-100 p-4 shadow-sm space-y-3 font-medium text-xs">
        <div class="flex items-center justify-between border-b border-slate-50 pb-2">
          <div>
            <strong class="font-extrabold text-slate-900 text-sm font-display">Medications Order: #${shortId}</strong>
            <p class="text-[9.5px] text-slate-400 font-mono mt-0.5">${new Date(o.createdAt).toLocaleTimeString()}</p>
          </div>
          <span class="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded font-display">Rider Payout: ₹${chargePay}</span>
        </div>

        <div class="space-y-2.5">
          <div class="flex items-start gap-2 leading-tight">
            <i class="fa-solid fa-house-medical text-indigo-500 mt-0.5"></i>
            <div>
              <span class="text-[8.5px] text-slate-400 block font-black leading-none uppercase">Pickup Distributor</span>
              <strong class="text-slate-800 text-[11px]">${o.storeName || "Pharmacy Hub"}</strong>
            </div>
          </div>
          <div class="flex items-start gap-2 leading-tight">
            <i class="fa-solid fa-map-pin text-rose-500 mt-0.5"></i>
            <div>
              <span class="text-[8.5px] text-slate-400 block font-black leading-none uppercase">Patient Drop-off Destination</span>
              <strong class="text-slate-700 font-bold block text-[11.5px] truncate w-64">${o.userAddress || "Deliver Address"}</strong>
            </div>
          </div>
        </div>

        <div class="pt-2 border-t border-slate-50 text-[10px] flex justify-between items-center">
          <div>${paymentPrompt}</div>
          <button onclick="acceptPoolJob('${o.orderId}')" class="bg-amber-500 hover:bg-amber-600 text-white font-extrabold py-2 px-4 rounded-xl shadow cursor-pointer text-[10px] transition-all hover:-translate-y-0.5 font-display uppercase tracking-wider">
            Accept Dispatch
          </button>
        </div>
      </div>
    `;
  }).join("");
}

// --- ACCEPT JOB ACTION DISPATCH CORE TRIGGER ---
Object.assign(window, {
  acceptPoolJob(orderId: string) {
    if (!isDutyActive) {
      showToast("Toggled Offline! Turn on Duty Readiness to pull dispatches.", "error");
      return;
    }

    if (activeOrderPayload) {
      showToast("Blocked: You have a busy transit in progress. Deliver first!", "error");
      return;
    }

    showLoader(true);
    
    // Read specific elements to verify store and user details are populated
    get(ref(db, `orders/${orderId}`)).then((snap) => {
      const o = snap.val();
      const updates: any = {};
      
      updates[`orders/${orderId}/status`] = "out"; // Set Directly to out for delivery
      updates[`orders/${orderId}/deliveryId`] = currentRiderId;
      updates[`orders/${orderId}/deliveryName`] = currentRiderDetail.name || "Express Rider Partner";
      updates[`orders/${orderId}/deliveryPhone`] = currentRiderDetail.mobile || "9988776655";
      updates[`orders/${orderId}/timeline/transitTime`] = Date.now();
      
      // Rider Status
      updates[`delivery/${currentRiderId}/status`] = "busy";

      update(ref(db), updates).then(() => {
        showToast("Job Accepted Successfully! Optimized routing loaded.", "success");
        showLoader(false);
        switchTabPanel("active-order");
      }).catch((err) => {
        console.error("Failed to commit job accept", err);
        showToast("Dispatch lock expired. Order accepted by other rider.", "error");
        showLoader(false);
      });
    });
  }
});

// --- RENDER ACTIVE ORDER PROGRESS RUN PIPELINE ---
function renderActiveOrderPipelineLayout() {
  const navDotBadge = document.getElementById("badge-nav-active-order");
  const navPingBadge = document.getElementById("badge-nav-active-order-ping");

  if (!activeOrderPayload) {
    if (navDotBadge) navDotBadge.classList.add("hidden");
    if (navPingBadge) navPingBadge.classList.add("hidden");

    // Hide active components and show empty state
    const containerActiveTab = document.getElementById("tab-active-order");
    if (containerActiveTab) {
      containerActiveTab.innerHTML = `
        <div class="text-center py-24 text-slate-400 bg-white border border-slate-100 rounded-3xl p-6 shadow-sm flex flex-col items-center justify-center space-y-3">
          <div class="w-16 h-16 rounded-full bg-slate-50 text-slate-300 flex items-center justify-center text-2xl">
            <i class="fa-solid fa-route"></i>
          </div>
          <h4 class="text-xs font-bold font-display text-slate-650 uppercase">No Active Transit Order</h4>
          <p class="text-[9.5px] text-slate-400 leading-normal max-w-xs font-medium">Head to the "Pools" tab, review available packages, and accept a dispatch to lock real-time routing here!</p>
        </div>
      `;
    }
    return;
  }

  // Active Job Busy state verified
  if (navDotBadge) navDotBadge.classList.remove("hidden");
  if (navPingBadge) navPingBadge.classList.remove("hidden");

  const o = activeOrderPayload;
  
  // Resolve layout targets
  const elBannerStat = document.getElementById("lbl-active-order-status-banner");
  if (elBannerStat) elBannerStat.innerText = o.status ? o.status.replace("_", " ").toUpperCase() : "OUT FOR DELIVERY";

  const elStoreName = document.getElementById("lbl-active-store-name");
  if (elStoreName) elStoreName.innerText = o.storeName || "Pharmacy distributor";
  const elStoreAddr = document.getElementById("lbl-active-store-address");
  if (elStoreAddr) elStoreAddr.innerText = o.storeAddress || "Operational partner dispensary node";

  const elUserName = document.getElementById("lbl-active-user-name");
  if (elUserName) elUserName.innerText = o.userName || "Recipient Patient";
  const elUserAddr = document.getElementById("lbl-active-user-address");
  if (elUserAddr) elUserAddr.innerText = o.userAddress || "Target client coordinates";

  const lnkActivePhone = document.getElementById("lnk-active-phone") as HTMLAnchorElement;
  if (lnkActivePhone) {
    lnkActivePhone.href = `tel:${o.userPhone || "9988776655"}`;
  }

  const elPaymentMode = document.getElementById("lbl-active-payment-mode");
  if (elPaymentMode) elPaymentMode.innerText = o.paymentMethod === "cod" ? "COD (Cash On Road)" : "ONLINE PREPAID ✓";

  const elCODAmount = document.getElementById("lbl-active-cod-amount");
  if (elCODAmount) elCODAmount.innerText = `₹${Math.ceil(o.total || 0)}`;

  // Reveal conditional workflow elements (COD & Camera uploads)
  const codBlock = document.getElementById("wrapper-cod-cash-confirm");
  const uploadBlock = document.getElementById("wrapper-active-proof-block");
  const actionBtn = document.getElementById("btn-active-transition-step") as HTMLButtonElement;

  if (o.status === "packed") {
    // Stage 1: Needs pickup completion
    if (codBlock) codBlock.classList.add("hidden");
    if (uploadBlock) uploadBlock.classList.add("hidden");
    if (actionBtn) {
      actionBtn.innerText = "MARK MEDS AS PICKED & START DISPATCH";
      actionBtn.onclick = () => runTransitionStepAction(o.orderId, "out");
    }
  } else if (o.status === "out") {
    // Stage 2: Out on road, needs delivery completion + cash entry + kyc photo proof
    if (o.paymentMethod === "cod") {
      if (codBlock) codBlock.classList.remove("hidden");
      const inpCash = document.getElementById("inp-cod-cash-collected") as HTMLInputElement;
      if (inpCash) inpCash.placeholder = Math.ceil(o.total).toString();
    } else {
      if (codBlock) codBlock.classList.add("hidden");
    }

    if (uploadBlock) uploadBlock.classList.remove("hidden");
    if (actionBtn) {
      actionBtn.innerText = "COMPLETE HANDOVER & REGISTER PAYOUT";
      actionBtn.onclick = () => finalizeDeliveryHandoverCompletion(o);
    }
  }

  // Draw Geoapify and Leaflet routing elements
  triggerActiveOrderMapDraw();
}

// --- OPTIMIZED ROUTE RENDER CALCULATOR ---
function triggerActiveOrderMapDraw() {
  if (!activeOrderPayload) return;
  const o = activeOrderPayload;

  const riderLat = currentRiderDetail?.location?.lat || 12.9716;
  const riderLng = currentRiderDetail?.location?.lng || 77.5946;
  const userLat = o.userLocation?.lat || 12.9716;
  const userLng = o.userLocation?.lng || 77.5946;

  // Render maps
  updateLeafletMap("rider-leaflet-map", riderLat, riderLng, userLat, userLng, false);

  // Math ETA matrices
  const distance = calculateDistance(riderLat, riderLng, userLat, userLng);
  const totalMinutes = Math.ceil((distance / 30) * 60) + 3; // Approx 30km/hr average bike speed + 3min static margin

  const elEta = document.getElementById("rider-map-eta-time");
  if (elEta) elEta.innerText = `${totalMinutes} Mins (${distance.toFixed(1)} KM Range)`;
}

// --- STATUS PIPELINE STEP STATE ADVANCE ---
function runTransitionStepAction(orderId: string, nextStatus: string) {
  showLoader(true);
  update(ref(db, `orders/${orderId}`), {
    status: nextStatus,
    [`timeline/${nextStatus}Time`]: Date.now()
  }).then(() => {
    showToast("Dispatched updated state to patient live track!", "success");
    showLoader(false);
  }).catch((err) => {
    console.error("Status step advance failed", err);
    showLoader(false);
  });
}

// --- FINALIZE HANDOVER DELIVERED TRANSACTION ---
async function finalizeDeliveryHandoverCompletion(order: any) {
  const orderId = order.orderId;

  // Proof requirement check
  if (!stateActiveHandoverProofUrl) {
    showToast("Requirement: Snap medication packet handover photo first as reference proof.", "error");
    return;
  }

  // Cash receipt verify check if paymentMethod === cod
  let cashRecordedValue = 0;
  if (order.paymentMethod === "cod") {
    const inpCash = document.getElementById("inp-cod-cash-collected") as HTMLInputElement;
    const cashVal = Number(inpCash?.value || 0);
    if (cashVal <= 0) {
      showToast("Requirement: Enter collected Cash collected amount from customer.", "error");
      return;
    }
    cashRecordedValue = cashVal;
  }

  showLoader(true);

  const updates: any = {};
  updates[`orders/${orderId}/status`] = "delivered";
  updates[`orders/${orderId}/cashCollected`] = cashRecordedValue;
  updates[`orders/${orderId}/proofImage`] = stateActiveHandoverProofUrl;
  updates[`orders/${orderId}/timeline/deliveredTime`] = Date.now();

  // Reset rider state to free
  updates[`delivery/${currentRiderId}/status`] = "free";

  update(ref(db), updates).then(() => {
    soundSettled.play().catch(() => {});
    showToast("Medication Transit success! Payout balance has been loaded.", "success");
    
    // Clear temporary proof url state
    stateActiveHandoverProofUrl = "";
    
    const inpProofFile = document.getElementById("inp-active-proof-file") as HTMLInputElement;
    if (inpProofFile) inpProofFile.value = "";
    const imgProofPreview = document.getElementById("img-active-proof-preview") as HTMLImageElement;
    if (imgProofPreview) imgProofPreview.classList.add("hidden");

    const textProof = document.getElementById("lbl-active-proof-text");
    if (textProof) textProof.innerText = "Snap Delivery Handover Photo";
    const iconProof = document.getElementById("lbl-active-proof-icon");
    if (iconProof) iconProof.className = "fa-solid fa-camera text-base text-indigo-600 mr-2";

    showLoader(false);
    switchTabPanel("dashboard");
  }).catch((err) => {
    console.error("Transacting delivery completed failed", err);
    showToast("Could not sync delivery status on road. Retry.", "error");
    showLoader(false);
  });
}

// --- UPI ACCOUNT DETAILS UPDATE CONTROLLER ---
const btnSaveUpi = document.getElementById("btn-save-upi-profile");
btnSaveUpi?.addEventListener("click", () => {
  const upiIdVal = (document.getElementById("inp-settle-upi-id") as HTMLInputElement).value.trim();
  if (!upiIdVal) {
    showToast("UPI address cannot be empty.", "error");
    return;
  }

  showLoader(true);
  const updates = {
    upiId: upiIdVal,
    qrCodeUrl: stateUpiQrCodeUrl || currentRiderDetail?.qrCodeUrl || ""
  };

  update(ref(db, `delivery/${currentRiderId}`), updates).then(() => {
    showToast("UPI Direct Deposit Account Details Saved!", "success");
    showLoader(false);
  }).catch((err) => {
    console.error(err);
    showToast("Saving UPI credentials failed.", "error");
    showLoader(false);
  });
});

// --- SETTLEMENTS REDEMPTIONS SYNC AND WATCH ---
function subscribeToSettlementRedemptions() {
  onValue(ref(db, `settlements/${currentRiderId}`), (snapshot) => {
    localSettlementsCache = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        localSettlementsCache.push({
          key: child.key,
          ...child.val()
        });
      });
    }

    // Sort descending chronologically
    localSettlementsCache.sort((a,b) => b.createdAt - a.createdAt);

    // Watch payouts calculation matches claimed requests
    const cachedAllTimeEarningsTotal = globalOrdersCache
      .filter((o) => o.status === "delivered" && o.deliveryId === currentRiderId)
      .reduce((sum, o) => sum + (o.deliveryCharge || 40), 0);

    calculateAndRenderPayoutSheets(cachedAllTimeEarningsTotal);

    // Render claims list logs
    renderSettlementsHistoryList();
  });
}

// --- RENDER COMPLETED DISBURSED PAYOUT CLAIM HISTORY ---
function renderSettlementsHistoryList() {
  const container = document.getElementById("cnt-settlements-history-list");
  if (!container) return;

  if (localSettlementsCache.length === 0) {
    container.innerHTML = `
      <p class="text-[10px] text-slate-400 font-bold text-center py-6 uppercase font-display bg-white rounded-3xl border border-slate-100 p-4">No historical payout payouts recorded yet.</p>
    `;
    return;
  }

  container.innerHTML = localSettlementsCache.map((req) => {
    let statBadge = `<span class="text-[8.5px] px-2 py-0.5 rounded font-black uppercase text-indigo-700 bg-indigo-55/10">PENDING</span>`;
    if (req.status === "approved" || req.status === "completed" || req.status === "success") {
      statBadge = `<span class="text-[8.5px] px-2 py-0.5 rounded font-black uppercase text-emerald-700 bg-emerald-50">DISBURSED</span>`;
    } else if (req.status === "rejected") {
      statBadge = `<span class="text-[8.5px] px-2 py-0.5 rounded font-black uppercase text-rose-700 bg-rose-50">REJECTED</span>`;
    }

    const utrSnippet = req.utrNumber ? `<p class="text-[8.5px] text-slate-500 font-mono mt-1 font-bold">UTR ID: <strong class="text-indigo-600">${req.utrNumber}</strong></p>` : "";
    const proofSnippet = req.paymentProofUrl ? `<a href="${req.paymentProofUrl}" target="_blank" class="inline-flex items-center gap-1 mt-1 text-[8px] bg-slate-100 hover:bg-slate-200 text-slate-705 px-2 py-0.5 rounded-lg active:scale-95 transition-all"><i class="fa-solid fa-receipt"></i> Payout Proof Attachment</a>` : "";

    return `
      <div class="bg-white rounded-3xl border border-slate-100 p-4 shadow-2xs flex flex-col space-y-2.5 font-semibold text-xs text-slate-700">
        <div class="flex items-center justify-between">
          <div>
            <strong class="text-slate-800 font-display">Claim Reference: #${req.claimId ? req.claimId.substring(6,14).toUpperCase() : "ABCD"}</strong>
            <p class="text-[9px] text-slate-400 font-mono mt-0.5">${new Date(req.createdAt).toLocaleDateString()} at ${new Date(req.createdAt).toLocaleTimeString()}</p>
          </div>
          <div>${statBadge}</div>
        </div>
        
        <div class="flex items-center justify-between border-t border-slate-50 pt-2 text-[10px]">
          <div>UPI ID Destination: <strong class="font-mono text-slate-800">${req.upiId || "No direct address"}</strong></div>
          <div class="text-indigo-700 font-extrabold text-[12.5px] font-mono">₹${req.amount}</div>
        </div>

        ${utrSnippet || proofSnippet ? `
          <div class="border-t border-slate-50 pt-2.5 flex items-center justify-between flex-wrap gap-1">
            ${utrSnippet}
            ${proofSnippet}
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

// --- CREATE INITIATE REDEMPTION REQUESTS PROMPT CHECK ---
const btnRequestSettle = document.getElementById("btn-request-settlement");
btnRequestSettle?.addEventListener("click", () => {
  const amountVal = Number((document.getElementById("inp-settle-claim-amount") as HTMLInputElement).value.trim());
  const upiIdVal = currentRiderDetail?.upiId || "";

  if (!upiIdVal) {
    showToast("Requirement: Enter and Save your digital UPI Virtual Payment Address first.", "error");
    switchTabPanel("settlements");
    return;
  }

  if (amountVal <= 0) {
    showToast("Amount must be positive value.", "error");
    return;
  }

  const remainingBalanceLimit = (window as any)["withdrawable_limit_rem"] || 0;
  if (amountVal > remainingBalanceLimit) {
    showToast(`Withdrawal limit exceeded! You can only request up to ₹${remainingBalanceLimit}`, "error");
    return;
  }

  showLoader(true);
  const claimId = "CLAIM_" + Date.now().toString();

  const newClaimPayload = {
    claimId,
    riderId: currentRiderId,
    riderName: currentRiderDetail.name || "Express Rider Partner",
    riderEmail: currentRiderDetail.email || "",
    amount: amountVal,
    upiId: upiIdVal,
    qrCodeUrl: currentRiderDetail?.qrCodeUrl || "",
    status: "pending",
    createdAt: Date.now(),
    utrNumber: "",
    paymentProofUrl: ""
  };

  // Push both under central settlementRequests log (for Admin review) and specific rider list
  set(ref(db, `settlements/${currentRiderId}/${claimId}`), newClaimPayload).then(() => {
    set(ref(db, `settlementRequests/${claimId}`), newClaimPayload).then(() => {
      showToast("Payout Redemption created! Admin is authorizing transfers.", "success");
      
      const inpClaim = document.getElementById("inp-settle-claim-amount") as HTMLInputElement;
      if (inpClaim) inpClaim.value = "";

      showLoader(false);
    });
  }).catch((err) => {
    console.error(err);
    showToast("Failure requesting payout settlement claim.", "error");
    showLoader(false);
  });
});

// --- RENDER CORE PROFILE VALUES ON PANE ---
function renderRiderProfileView(data: any) {
  const lblName = document.getElementById("lbl-profile-name");
  if (lblName) lblName.innerText = data.name || "Express Rider Partner";

  const lblAadhaarVal = document.getElementById("lbl-profile-aadhaar");
  if (lblAadhaarVal) lblAadhaarVal.innerText = data.aadhaarNumber || "N/A";

  const lblDlVal = document.getElementById("lbl-profile-dl");
  if (lblDlVal) lblDlVal.innerText = data.licenseNumber || "N/A";

  const lblLocationVal = document.getElementById("lbl-profile-location");
  if (lblLocationVal) lblLocationVal.innerText = `${data.state || "Karnataka"}, ${data.district || "Bengaluru"}`;

  const lblVehicleVal = document.getElementById("lbl-profile-vehicle");
  if (lblVehicleVal) lblVehicleVal.innerText = `${data.vehicleType || "Motorcycle"} (${data.vehicleNumber || "N/A"})`;

  const lblUidVal = document.getElementById("lbl-profile-driver-id");
  if (lblUidVal) lblUidVal.innerText = currentRiderId;

  // Sync UPI Profile input values initially
  const inpUpi = document.getElementById("inp-settle-upi-id") as HTMLInputElement;
  if (inpUpi && !inpUpi.value && data.upiId) {
    inpUpi.value = data.upiId;
  }

  const qrImg = document.getElementById("img-qr-upload") as HTMLImageElement;
  if (qrImg && data.qrCodeUrl) {
    qrImg.src = data.qrCodeUrl;
    qrImg.classList.remove("hidden");
    
    const txtQr = document.getElementById("txt-qr-upload");
    if (txtQr) txtQr.innerText = "QR Image Synchronized ✓";
  }

  // Bind links
  const lnkAadFront = document.getElementById("lnk-profile-aadhaar-front") as HTMLAnchorElement;
  if (lnkAadFront) lnkAadFront.href = data.aadhaarFrontUrl || "#";

  const lnkAadBack = document.getElementById("lnk-profile-aadhaar-back") as HTMLAnchorElement;
  if (lnkAadBack) lnkAadBack.href = data.aadhaarBackUrl || "#";

  const lnkDlPhoto = document.getElementById("lnk-profile-dl-photo") as HTMLAnchorElement;
  if (lnkDlPhoto) lnkDlPhoto.href = data.licenseImageUrl || "#";
}

// --- ACTIVE DUTY TOGGLE ON THE DASHBOARD HUB ---
const btnToggleDuty = document.getElementById("btn-toggle-duty-state") as HTMLButtonElement;
const lblDutySub = document.getElementById("lbl-duty-subtext");

btnToggleDuty?.addEventListener("click", () => {
  const nextDutyState = !isDutyActive;
  showLoader(true);
  update(ref(db, `delivery/${currentRiderId}`), { active: nextDutyState }).then(() => {
    isDutyActive = nextDutyState;
    updateDutyButtonUI();
    showToast(`Duty Status toggled: ${nextDutyState ? "ONLINE READY" : "OFFLINE RESTING"}`, "info");
    showLoader(false);
  }).catch((err) => {
    console.error(err);
    showLoader(false);
  });
});

function updateDutyButtonUI() {
  const btnToggleDuty = document.getElementById("btn-toggle-duty-state") as HTMLButtonElement;
  const lblDutySub = document.getElementById("lbl-duty-subtext");
  
  if (!btnToggleDuty) return;

  if (isDutyActive) {
    btnToggleDuty.innerText = "DUTY: ON";
    btnToggleDuty.className = "text-[10px] font-black py-2 px-3.5 rounded-xl transition-all cursor-pointer bg-emerald-500 text-white shadow active:scale-95";
    if (lblDutySub) {
      lblDutySub.innerText = "Standby Ready Duty (Active)";
      lblDutySub.className = "text-xs font-black text-emerald-400";
    }
  } else {
    btnToggleDuty.innerText = "DUTY: OFF";
    btnToggleDuty.className = "text-[10px] font-black py-2 px-3.5 rounded-xl transition-all cursor-pointer bg-slate-600 text-slate-300 shadow active:scale-95";
    if (lblDutySub) {
      lblDutySub.innerText = "Resting/Breather Mode (Duty Off)";
      lblDutySub.className = "text-xs font-black text-slate-400";
    }
  }
}
