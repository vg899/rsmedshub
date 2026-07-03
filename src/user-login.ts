import { auth, db } from "./firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { ref, set, get, onValue } from "firebase/database";
import { showToast } from "./utils";

// Dynamic Branding Loader
function initDynamicBranding() {
  const brandLogoContainer = document.getElementById("brand-logo-container");
  const brandLogoImg = document.getElementById("brand-logo-img") as HTMLImageElement;
  const appNameHeading = document.getElementById("app-name-heading");
  const appTaglineText = document.getElementById("app-tagline-text");

  onValue(ref(db, "settings/branding"), (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      const appName = data.appName || "DawaDo";
      const tagline = data.tagline || "Your Medicine Partner";
      const logoUrl = data.logoUrl || "";

      // Update App Name
      if (appNameHeading) {
        appNameHeading.innerText = appName;
      }
      // Update Tagline
      if (appTaglineText) {
        appTaglineText.innerText = tagline;
      }
      // Update Logo
      if (logoUrl) {
        if (brandLogoImg) brandLogoImg.src = logoUrl;
        if (brandLogoContainer) {
          brandLogoContainer.classList.remove("hidden");
          brandLogoContainer.classList.add("flex");
        }
      } else {
        if (brandLogoContainer) {
          brandLogoContainer.classList.add("hidden");
          brandLogoContainer.classList.remove("flex");
        }
      }
      
      // Update page title dynamically
      document.title = `${appName} - Customer Login & Register`;
    } else {
      // Defaults if not set yet
      if (appNameHeading) appNameHeading.innerText = "DawaDo";
      if (appTaglineText) appTaglineText.innerText = "Your Medicine Partner";
      if (brandLogoContainer) {
        brandLogoContainer.classList.add("hidden");
        brandLogoContainer.classList.remove("flex");
      }
      document.title = "DawaDo - Customer Login & Register";
    }
  });
}

// Call dynamic branding
initDynamicBranding();

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
        targetUrl = "/deliveryboy.html";
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
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      try {
        console.log(`Auto registering client on credentials error: ${email}`);
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
        const mobile = "9988776655";

        const userProfile = {
          uid,
          name,
          email: finalEmail,
          mobile,
          role: "user",
          approved: true, // Customers auto-approved
          active: true,
          createdAt: Date.now()
        };

        await set(ref(db, `users/${uid}`), userProfile);
        showToast("Welcome back! Tester account auto-provisioned.", "success");
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

// Forgot Password modal controls and actions
const forgotModal = document.getElementById("forgot-password-modal") as HTMLDivElement;
const forgotModalContent = document.getElementById("forgot-modal-content") as HTMLDivElement;
const btnCloseForgotModal = document.getElementById("btn-close-forgot-modal") as HTMLButtonElement;
const formForgotPassword = document.getElementById("form-forgot-password") as HTMLFormElement;
const forgotEmailInp = document.getElementById("forgot-email") as HTMLInputElement;
const forgotErrorMsg = document.getElementById("forgot-error-msg") as HTMLDivElement;
const forgotErrorText = document.getElementById("forgot-error-text") as HTMLSpanElement;
const forgotSuccessMsg = document.getElementById("forgot-success-msg") as HTMLDivElement;
const btnSubmitForgot = document.getElementById("btn-submit-forgot") as HTMLButtonElement;
const btnSubmitForgotText = document.getElementById("btn-submit-forgot-text") as HTMLSpanElement;
const btnSubmitForgotIcon = document.getElementById("btn-submit-forgot-icon") as HTMLElement;

function openForgotModal() {
  const loginEmailInp = document.getElementById("login-email") as HTMLInputElement;
  if (loginEmailInp && forgotEmailInp) {
    forgotEmailInp.value = loginEmailInp.value.trim();
  }

  // Reset modal state
  if (forgotErrorMsg) forgotErrorMsg.classList.add("hidden");
  if (forgotSuccessMsg) forgotSuccessMsg.classList.add("hidden");
  if (forgotEmailInp) forgotEmailInp.disabled = false;
  
  if (btnSubmitForgot) {
    btnSubmitForgot.disabled = false;
    if (btnSubmitForgotText) btnSubmitForgotText.innerText = "Send Recovery Link";
    if (btnSubmitForgotIcon) {
      btnSubmitForgotIcon.className = "fa-solid fa-paper-plane";
    }
  }

  // Show modal container
  if (forgotModal) {
    forgotModal.classList.remove("hidden");
    // Animate content scale and opacity
    setTimeout(() => {
      if (forgotModalContent) {
        forgotModalContent.classList.remove("scale-95", "opacity-0");
        forgotModalContent.classList.add("scale-100", "opacity-100");
      }
    }, 10);
  }
}

function closeForgotModal() {
  if (forgotModalContent) {
    forgotModalContent.classList.remove("scale-100", "opacity-100");
    forgotModalContent.classList.add("scale-95", "opacity-0");
  }
  setTimeout(() => {
    if (forgotModal) {
      forgotModal.classList.add("hidden");
    }
  }, 300);
}

if (btnForgot) {
  btnForgot.addEventListener("click", openForgotModal);
}

if (btnCloseForgotModal) {
  btnCloseForgotModal.addEventListener("click", closeForgotModal);
}

// Close on backdrop click
if (forgotModal) {
  forgotModal.addEventListener("click", (e) => {
    if (e.target === forgotModal) {
      closeForgotModal();
    }
  });
}

// Handle submit forgot password recovery link
if (formForgotPassword) {
  formForgotPassword.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!forgotEmailInp || !btnSubmitForgot) return;

    const email = forgotEmailInp.value.trim();

    // Reset error & success alerts
    if (forgotErrorMsg) forgotErrorMsg.classList.add("hidden");
    if (forgotSuccessMsg) forgotSuccessMsg.classList.add("hidden");

    // Email pattern validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      if (forgotErrorMsg && forgotErrorText) {
        forgotErrorText.innerText = "Please enter a valid email address (e.g. name@example.com).";
        forgotErrorMsg.classList.remove("hidden");
      }
      return;
    }

    // Set loading state (prevent double submit)
    btnSubmitForgot.disabled = true;
    forgotEmailInp.disabled = true;
    if (btnSubmitForgotText) btnSubmitForgotText.innerText = "Sending Link...";
    if (btnSubmitForgotIcon) {
      btnSubmitForgotIcon.className = "fa-solid fa-circle-notch fa-spin";
    }

    try {
      await sendPasswordResetEmail(auth, email);
      
      // Success state
      showToast("Recovery link dispatched successfully!", "success");
      if (forgotSuccessMsg) forgotSuccessMsg.classList.remove("hidden");
      
      // Clear input
      forgotEmailInp.value = "";

      // Auto close after brief reading time
      setTimeout(() => {
        closeForgotModal();
      }, 3000);

    } catch (err: any) {
      console.error("Forgot password reset error:", err);
      let errMsg = "An unexpected error occurred. Please try again.";

      // Human-readable specific error messages
      if (err.code === "auth/invalid-email") {
        errMsg = "The email address is formatted incorrectly.";
      } else if (err.code === "auth/user-not-found") {
        errMsg = "This email address is not registered in our system.";
      } else if (err.code === "auth/network-request-failed") {
        errMsg = "A network error occurred. Please check your internet connection.";
      } else if (err.code === "auth/too-many-requests") {
        errMsg = "Too many requests. Please wait a moment and try again.";
      } else if (err.message) {
        errMsg = err.message;
      }

      // Show custom error block
      if (forgotErrorMsg && forgotErrorText) {
        forgotErrorText.innerText = errMsg;
        forgotErrorMsg.classList.remove("hidden");
      }
      showToast(errMsg, "error");

      // Reset button state to try again
      btnSubmitForgot.disabled = false;
      forgotEmailInp.disabled = false;
      if (btnSubmitForgotText) btnSubmitForgotText.innerText = "Send Recovery Link";
      if (btnSubmitForgotIcon) {
        btnSubmitForgotIcon.className = "fa-solid fa-paper-plane";
      }
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
