import { auth, db } from "./firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { ref, get, set } from "firebase/database";
import { showToast } from "./utils";

// HTML Elements
const formLogin = document.getElementById("form-login") as HTMLFormElement;
const loader = document.getElementById("portal-loader") as HTMLDivElement;

// Helper: Seed Default Settings & Initial Core Data if empty (charges & coupons)
async function seedDefaultConfig() {
  try {
    const chargeRef = ref(db, "charges");
    const chargeSnap = await get(chargeRef);
    if (!chargeSnap.exists()) {
      await set(chargeRef, {
        deliveryCharge: 40,
        platformFee: 5,
        gst: 12, // 12% GST standard
        storeCommission: 10, // 10% store commission
      });
    }

    const areaRef = ref(db, "service_areas");
    const areaSnap = await get(areaRef);
    if (!areaSnap.exists()) {
      await set(areaRef, {
        "Karnataka": {
          "Bengaluru": { active: true },
          "Mysuru": { active: true }
        },
        "Maharashtra": {
          "Mumbai": { active: true },
          "Pune": { active: true }
        }
      });
    }

    const couponRef = ref(db, "coupons");
    const couponSnap = await get(couponRef);
    if (!couponSnap.exists()) {
      await set(couponRef, {
        "MEDS20": {
          code: "MEDS20",
          discountPercent: 20,
          maxDiscount: 100,
          minOrder: 300,
          active: true
        },
        "WELCOME50": {
          code: "WELCOME50",
          discountPercent: 50,
          maxDiscount: 150,
          minOrder: 200,
          active: true
        }
      });
    }

    const bannerRef = ref(db, "banners");
    const bannerSnap = await get(bannerRef);
    if (!bannerSnap.exists()) {
      await set(bannerRef, {
        "b1": {
          bannerId: "b1",
          imageUrl: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800",
          redirectUrl: "/user.html?category=Wellness",
          priority: 1,
          active: true
        },
        "b2": {
          bannerId: "b2",
          imageUrl: "https://images.unsplash.com/photo-1631549916768-4119b2e55c06?w=800",
          priority: 2,
          active: true
        }
      });
    }
  } catch (error) {
    console.warn("Bootstrap Seeding failed:", error);
  }
}

// Check Roles and Redirect
async function handleUserRedirect(uid: string) {
  try {
    const userRef = ref(db, `users/${uid}`);
    const snapshot = await get(userRef);
    
    if (!snapshot.exists()) {
      showToast("No admin account details found", "error");
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

    // Role-based routing: Must be "admin"
    if (userData.role !== "admin") {
      let targetUrl = "/index.html";
      if (userData.role === "user") {
        targetUrl = "/user.html";
      } else if (userData.role === "store") {
        targetUrl = "/store.html";
      } else if (userData.role === "delivery" || userData.role === "deliveryboy1") {
        targetUrl = "/deliveryboy.html";
      }

      // Show beautiful Access Denied overlay
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
            You are trying to access the restricted <strong>ADMIN</strong> terminal, but your account is registered as <strong>${(userData.role || "unknown").toUpperCase()}</strong>.
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

    // Attempt configuration seed since we are logged in as admin safely
    await seedDefaultConfig();

    showToast(`Access Authorized. Welcome back Administrator!`, "success");
    window.location.href = "/admin.html";
  } catch (error) {
    console.error("Redirect check error:", error);
    showToast("Error checking administrative credentials", "error");
    loader.classList.add("hidden");
    formLogin.classList.remove("hidden");
  }
}

// Watch Auth State Redirect (only redirect if already logged in as a valid admin)
auth.onAuthStateChanged(async (user) => {
  if (user) {
    if (!document.getElementById("access-denied-overlay")) {
      loader.classList.remove("hidden");
      formLogin.classList.add("hidden");
      await handleUserRedirect(user.uid);
    }
  }
});

// Sign In action
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
        console.log(`Auto registering admin on credentials error: ${email}`);
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

        const profile = {
          uid,
          name: "Harsh (Admin)",
          email: finalEmail,
          mobile: "9876543210",
          role: "admin",
          approved: true,
          active: true,
          createdAt: Date.now()
        };

        await set(ref(db, `users/${uid}`), profile);
        showToast("Access Authorized. Administrator profile auto-provisioned!", "success");
        await handleUserRedirect(uid);
      } catch (innerErr) {
        console.error("Auto registration failed:", innerErr);
        loader.classList.add("hidden");
        formLogin.classList.remove("hidden");
        showToast("Invalid admin credentials or authorization key.", "error");
      }
    } else {
      loader.classList.add("hidden");
      formLogin.classList.remove("hidden");
      showToast("Invalid admin credentials or authorization key.", "error");
    }
  }
});
