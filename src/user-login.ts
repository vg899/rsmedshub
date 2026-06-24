import { auth, db } from "./firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { ref, set, get } from "firebase/database";
import { showToast } from "./utils";

// HTML Elements
const tabLogin = document.getElementById("tab-login") as HTMLButtonElement;
const tabRegister = document.getElementById("tab-register") as HTMLButtonElement;
const formLogin = document.getElementById("form-login") as HTMLFormElement;
const formRegister = document.getElementById("form-register") as HTMLFormElement;
const btnForgot = document.getElementById("btn-forgot-password") as HTMLButtonElement;
const loader = document.getElementById("portal-loader") as HTMLDivElement;

// Tab Activation state
let activeTab: "login" | "register" = "login";

// Track tab switching
if (tabLogin && tabRegister) {
  tabLogin.addEventListener("click", () => {
    activeTab = "login";
    tabLogin.className = "flex-1 py-3 text-xs font-bold border-b-2 border-teal-500 text-teal-600 focus:outline-none transition-all uppercase tracking-wider";
    tabRegister.className = "flex-1 py-3 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 focus:outline-none transition-all uppercase tracking-wider";
    formLogin.classList.remove("hidden");
    formRegister.classList.add("hidden");
  });

  tabRegister.addEventListener("click", () => {
    activeTab = "register";
    tabRegister.className = "flex-1 py-3 text-xs font-bold border-b-2 border-teal-500 text-teal-600 focus:outline-none transition-all uppercase tracking-wider";
    tabLogin.className = "flex-1 py-3 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 focus:outline-none transition-all uppercase tracking-wider";
    formRegister.classList.remove("hidden");
    formLogin.classList.add("hidden");
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

    // Customer Portal allows only "user" role
    if (userData.role !== "user") {
      let targetUrl = "/index.html";
      if (userData.role === "admin") {
        targetUrl = "/admin.html";
      } else if (userData.role === "store") {
        targetUrl = "/store.html";
      } else if (userData.role === "delivery" || userData.role === "deliveryboy1") {
        targetUrl = "/delivery.html";
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
            You are trying to access the <strong>CUSTOMER</strong> portal, but your account is registered as <strong>${(userData.role || "unknown").toUpperCase()}</strong>.
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

    showToast(`Welcome back, ${userData.name}!`, "success");
    window.location.href = "/user.html";
  } catch (error) {
    console.error("Redirect check error:", error);
    showToast("Error checking user system record", "error");
    loader.classList.add("hidden");
    formLogin.classList.remove("hidden");
  }
}

// Watch Auth State Redirect (only redirect if already logged in as a valid customer)
auth.onAuthStateChanged(async (user) => {
  if (user) {
    // Only auto-redirect if we don't already have an access-denied overlay showing
    if (!document.getElementById("access-denied-overlay")) {
      loader.classList.remove("hidden");
      formLogin.classList.add("hidden");
      formRegister.classList.add("hidden");
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
    loader.classList.add("hidden");
    formLogin.classList.remove("hidden");
    showToast("Invalid email or password.", "error");
  }
});

// Forgot Password action
if (btnForgot) {
  btnForgot.addEventListener("click", async () => {
    const emailInput = document.getElementById("login-email") as HTMLInputElement;
    const email = emailInput.value.trim();
    if (!email) {
      showToast("Please enter your email in the email field first.", "info");
      emailInput.focus();
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      showToast(`Password reset link sent to ${email}!`, "success");
    } catch (err: any) {
      showToast(err.message || "Failed to send reset email.", "error");
    }
  });
}

// Sign Up action
formRegister.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = (document.getElementById("reg-name") as HTMLInputElement).value.trim();
  const email = (document.getElementById("reg-email") as HTMLInputElement).value.trim();
  const mobile = (document.getElementById("reg-mobile") as HTMLInputElement).value.trim();
  const pass = (document.getElementById("reg-password") as HTMLInputElement).value;

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
      role: "user",
      approved: true, // Customers auto-approved
      active: true,
      createdAt: Date.now()
    };

    await set(ref(db, `users/${uid}`), userProfile);
    showToast("Registration successful! Logging in...", "success");
    await handleUserRedirect(uid);
  } catch (err: any) {
    console.error("Registration error:", err);
    loader.classList.add("hidden");
    formRegister.classList.remove("hidden");
    showToast(err.message || "Registration failed.", "error");
  }
});
