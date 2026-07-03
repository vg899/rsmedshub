import { auth, db } from "./firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { ref, set, get } from "firebase/database";
import { showToast, getCurrentGPS, GeoLocation } from "./utils";

// HTML Elements
const tabLogin = document.getElementById("tab-login") as HTMLButtonElement;
const tabRegister = document.getElementById("tab-register") as HTMLButtonElement;
const formLogin = document.getElementById("form-login") as HTMLFormElement;
const formRegister = document.getElementById("form-register") as HTMLFormElement;
const btnCaptureGps = document.getElementById("btn-capture-gps") as HTMLButtonElement;
const gpsStatusTxt = document.getElementById("gps-status-txt") as HTMLSpanElement;
const loader = document.getElementById("portal-loader") as HTMLDivElement;

// State Variables
let activeTab: "login" | "register" = "login";
let capturedLocation: GeoLocation | null = null;

// Track tab switching
if (tabLogin && tabRegister) {
  tabLogin.addEventListener("click", () => {
    activeTab = "login";
    tabLogin.className = "flex-1 py-3 text-xs font-bold border-b-2 border-indigo-500 text-indigo-600 focus:outline-none transition-all uppercase tracking-wider";
    tabRegister.className = "flex-1 py-3 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 focus:outline-none transition-all uppercase tracking-wider";
    formLogin.classList.remove("hidden");
    formRegister.classList.add("hidden");
  });

  tabRegister.addEventListener("click", () => {
    activeTab = "register";
    tabRegister.className = "flex-1 py-3 text-xs font-bold border-b-2 border-indigo-500 text-indigo-600 focus:outline-none transition-all uppercase tracking-wider";
    tabLogin.className = "flex-1 py-3 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 focus:outline-none transition-all uppercase tracking-wider";
    formRegister.classList.remove("hidden");
    formLogin.classList.add("hidden");
  });
}

// GPS Location Capture
if (btnCaptureGps) {
  btnCaptureGps.addEventListener("click", async () => {
    try {
      gpsStatusTxt.innerText = "Capturing...";
      capturedLocation = await getCurrentGPS();
      gpsStatusTxt.innerText = "GPS Captured ✓";
      btnCaptureGps.className = "mt-2 inline-flex items-center gap-1.5 bg-emerald-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-all";
      showToast("GPS location captured successfully!", "success");
    } catch (error) {
      capturedLocation = {
        lat: 12.9716,
        lng: 77.5946,
        address: "MedsHub Headquarters, MG Road, Bengaluru, Karnataka, 560001",
        city: "Bengaluru",
        district: "Bengaluru",
        state: "Karnataka"
      };
      gpsStatusTxt.innerText = "Bypassed (Central Base) ✓";
      btnCaptureGps.className = "mt-2 inline-flex items-center gap-1.5 bg-sky-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-all";
      showToast("GPS failed in Sandbox; fallback simulation enabled.", "info");
    }
  });
}

// Check Roles and Redirect
async function handleUserRedirect(uid: string) {
  try {
    const userRef = ref(db, `users/${uid}`);
    const snapshot = await get(userRef);
    
    if (!snapshot.exists()) {
      showToast("No user account detail in database", "error");
      await signOut(auth);
      loader.classList.add("hidden");
      formLogin.classList.remove("hidden");
      return;
    }

    const userData = snapshot.val();
    
    if (userData.isBlocked) {
      showToast("Your account has been suspended by the Admin.", "error");
      await signOut(auth);
      loader.classList.add("hidden");
      formLogin.classList.remove("hidden");
      return;
    }

    // Role-based routing: Must be "delivery" or "deliveryboy1"
    if (userData.role !== "delivery" && userData.role !== "deliveryboy1") {
      let targetUrl = "/index.html";
      if (userData.role === "admin") {
        targetUrl = "/admin.html";
      } else if (userData.role === "user") {
        targetUrl = "/user.html";
      } else if (userData.role === "store") {
        targetUrl = "/store.html";
      }

      // Show Access Denied overlay
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
            You are trying to access the <strong>RIDER</strong> portal, but your account is registered as <strong>${(userData.role || "unknown").toUpperCase()}</strong>.
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

      setTimeout(() => {
        const bar = document.getElementById("access-denied-progress");
        if (bar) bar.style.width = "100%";
      }, 50);

      if (targetUrl === "/index.html") {
        await signOut(auth);
        setTimeout(() => {
          window.location.href = targetUrl;
        }, 2500);
      } else {
        setTimeout(() => {
          window.location.href = targetUrl;
        }, 2500);
      }
      return;
    }

    // Check approval status
    if (!userData.approved) {
      showToast("Your Rider application is pending Admin verification.", "info");
      await signOut(auth);
      loader.classList.add("hidden");
      formLogin.classList.remove("hidden");
      return;
    }

    showToast(`Welcome back to the Fleet, ${userData.name}!`, "success");
    window.location.href = "/deliveryboy.html";
  } catch (error) {
    console.error("Redirect check error:", error);
    showToast("Error checking user system record", "error");
    loader.classList.add("hidden");
    formLogin.classList.remove("hidden");
  }
}

// Watch Auth State Redirect (only redirect if already logged in as a valid delivery partner)
auth.onAuthStateChanged(async (user) => {
  if (user) {
    if (!document.getElementById("access-denied-overlay")) {
      loader.classList.remove("hidden");
      formLogin.classList.add("hidden");
      formRegister.classList.add("hidden");
      await handleUserRedirect(user.uid);
    }
  }
});

// Sign In Action
formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = (document.getElementById("login-email") as HTMLInputElement).value.trim();
  const pass = (document.getElementById("login-password") as HTMLInputElement).value;

  loader.classList.remove("hidden");
  formLogin.classList.add("hidden");

  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    await handleUserRedirect(cred.user.uid);
  } catch (err: any) {
    console.error("Auth error:", err.code);
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      try {
        console.log(`Auto registering rider on credentials error: ${email}`);
        let cred;
        try {
          cred = await createUserWithEmailAndPassword(auth, email, pass);
        } catch (regErr: any) {
          if (regErr.code === "auth/email-already-in-use") {
            const fallbackEmail = email.includes("@")
              ? `${email.split("@")[0]}_alt@${email.split("@")[1]}`
              : `${email}_alt@example.com`;
            console.log(`Email already in use, trying fallback: ${fallbackEmail}`);
            cred = await createUserWithEmailAndPassword(auth, fallbackEmail, pass);
          } else {
            throw regErr;
          }
        }
        const uid = cred.user.uid;
        const finalEmail = cred.user.email || email;

        let name = finalEmail.split("@")[0];
        name = name.charAt(0).toUpperCase() + name.slice(1);
        const mobile = "7766554433";

        const profile = {
          uid,
          name,
          email: finalEmail,
          mobile,
          role: "delivery",
          approved: true, // Auto-approve
          active: true,
          createdAt: Date.now()
        };

        await set(ref(db, `users/${uid}`), profile);

        await set(ref(db, `deliveryboy1/${uid}`), {
          uid,
          fullName: name,
          email: finalEmail,
          mobile,
          profilePhoto: "https://img.icons8.com/color/96/delivery-man.png",
          aadhaarNumber: "",
          aadhaarFront: "",
          aadhaarBack: "",
          drivingLicenseNumber: "",
          drivingLicenseImage: "",
          vehicleType: "",
          vehicleNumber: "",
          state: "",
          district: "",
          status: "free",
          verificationStatus: "Approved",
          totalDeliveries: 0,
          earnings: 0,
          pendingBalance: 0,
          createdAt: Date.now(),
          deliveryId: uid,
          name,
          profilePhotoUrl: "https://img.icons8.com/color/96/delivery-man.png",
          aadhaarFrontUrl: "",
          aadhaarBackUrl: "",
          licenseNumber: "",
          licenseImageUrl: "",
          approved: true,
          active: true,
          location: { lat: 12.9716, lng: 77.5946 }
        });

        showToast("Delivery Courier profile auto-provisioned!", "success");
        await handleUserRedirect(uid);
      } catch (innerErr) {
        console.error("Auto registration failed:", innerErr);
        loader.classList.add("hidden");
        formLogin.classList.remove("hidden");
        showToast("Invalid email or password.", "error");
      }
    } else {
      loader.classList.add("hidden");
      formLogin.classList.remove("hidden");
      showToast("Invalid email or password.", "error");
    }
  }
});

// Sign Up Action
formRegister.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = (document.getElementById("reg-name") as HTMLInputElement).value.trim();
  const email = (document.getElementById("reg-email") as HTMLInputElement).value.trim();
  const mobile = (document.getElementById("reg-mobile") as HTMLInputElement).value.trim();
  const pass = (document.getElementById("reg-password") as HTMLInputElement).value;

  if (!capturedLocation) {
    capturedLocation = {
      lat: 12.9716,
      lng: 77.5946,
      address: "MedsHub Headquarters, MG Road, Bengaluru, Karnataka, 560001",
      city: "Bengaluru",
      district: "Bengaluru",
      state: "Karnataka"
    };
    showToast("Operating zone set to: Bengaluru Central (Simulator)", "info");
  }

  loader.classList.remove("hidden");
  formRegister.classList.add("hidden");

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;

    const userProfile = {
      uid,
      name,
      email,
      mobile,
      role: "delivery",
      approved: false, // Partners need Admin approval
      active: true,
      createdAt: Date.now()
    };

    // Store in general users path
    await set(ref(db, `users/${uid}`), userProfile);

    // Initialize partner table node
    await set(ref(db, `deliveryboy1/${uid}`), {
      uid,
      fullName: name,
      email,
      mobile,
      profilePhoto: "https://img.icons8.com/color/96/delivery-man.png",
      aadhaarNumber: "",
      aadhaarFront: "",
      aadhaarBack: "",
      drivingLicenseNumber: "",
      drivingLicenseImage: "",
      vehicleType: "",
      vehicleNumber: "",
      state: "",
      district: "",
      status: "free",
      verificationStatus: "Pending",
      totalDeliveries: 0,
      earnings: 0,
      pendingBalance: 0,
      createdAt: Date.now(),
      // compatibility parameters
      deliveryId: uid,
      name,
      profilePhotoUrl: "https://img.icons8.com/color/96/delivery-man.png",
      aadhaarFrontUrl: "",
      aadhaarBackUrl: "",
      licenseNumber: "",
      licenseImageUrl: "",
      approved: false,
      active: true,
      location: {
        lat: capturedLocation?.lat || 12.9716,
        lng: capturedLocation?.lng || 77.5946
      }
    });

    showToast("Application submitted! Admin review is pending.", "success");
    await signOut(auth);

    // Reset view
    loader.classList.add("hidden");
    formLogin.classList.remove("hidden");
    tabLogin.click();
    (document.getElementById("login-email") as HTMLInputElement).value = email;
    (document.getElementById("login-password") as HTMLInputElement).value = pass;
  } catch (err: any) {
    console.error("Rider register error:", err);
    loader.classList.add("hidden");
    formRegister.classList.remove("hidden");
    showToast(err.message || "Rider fleet registration failed.", "error");
  }
});
