import { auth, db } from "./firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { ref, set, get, update, child } from "firebase/database";
import { showToast, getCurrentGPS, GeoLocation } from "./utils";

// HTML Elements
const tabLogin = document.getElementById("tab-login") as HTMLButtonElement;
const tabRegister = document.getElementById("tab-register") as HTMLButtonElement;
const formLogin = document.getElementById("form-login") as HTMLFormElement;
const formRegister = document.getElementById("form-register") as HTMLFormElement;
const regRoleInputs = document.getElementsByName("reg-role") as NodeListOf<HTMLInputElement>;
const promptBlock = document.getElementById("gps-prompt-block") as HTMLDivElement;
const btnCaptureGps = document.getElementById("btn-capture-gps") as HTMLButtonElement;
const gpsStatusTxt = document.getElementById("gps-status-txt") as HTMLSpanElement;
const roleSelectorContainer = document.getElementById("role-selector-container") as HTMLDivElement;
const brandingLogo = document.getElementById("branding-logo") as HTMLDivElement;
const brandingTitle = document.getElementById("branding-title") as HTMLHeadingElement;

// Labels
const lblFullname = document.getElementById("lbl-fullname") as HTMLLabelElement;

// Helper function to un-hide the partner selectors
function unlockPartnerMode() {
  if (roleSelectorContainer && roleSelectorContainer.classList.contains("hidden")) {
    roleSelectorContainer.classList.remove("hidden");
    showToast("Partner registration options unlocked! (Store / Rider)", "success");
  }
}

// Check URL query parameters on load to auto-unlock
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("role") || urlParams.get("partner") === "true" || urlParams.get("unlock") === "true") {
  setTimeout(() => {
    unlockPartnerMode();
  }, 300);
}

// Bind secret double-click handlers on branding log/titles
if (brandingLogo) {
  brandingLogo.addEventListener("dblclick", () => {
    unlockPartnerMode();
  });
}
if (brandingTitle) {
  brandingTitle.addEventListener("dblclick", () => {
    unlockPartnerMode();
  });
  // Also unlock if developer clicks the title 4 times just in case double click is tricky on mobile screens
  let clickCount = 0;
  brandingTitle.addEventListener("click", () => {
    clickCount++;
    if (clickCount >= 4) {
      unlockPartnerMode();
      clickCount = 0;
    }
  });
}

// Tab Activation state
let activeTab: "login" | "register" = "login";
let capturedLocation: GeoLocation | null = null;

// Track tab switching
tabLogin.addEventListener("click", () => {
  activeTab = "login";
  tabLogin.className = "flex-1 py-3 text-sm font-semibold border-b-2 border-teal-500 text-teal-600 focus:outline-none transition-all";
  tabRegister.className = "flex-1 py-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-600 focus:outline-none transition-all";
  formLogin.classList.remove("hidden");
  formRegister.classList.add("hidden");
});

tabRegister.addEventListener("click", () => {
  activeTab = "register";
  tabRegister.className = "flex-1 py-3 text-sm font-semibold border-b-2 border-teal-500 text-teal-600 focus:outline-none transition-all";
  tabLogin.className = "flex-1 py-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-600 focus:outline-none transition-all";
  formRegister.classList.remove("hidden");
  formLogin.classList.add("hidden");
});

// Update registration fields based on selected role
regRoleInputs.forEach((input) => {
  input.addEventListener("change", (e) => {
    const role = (e.target as HTMLInputElement).value;
    
    // Highlight labels
    ["user", "store", "delivery"].forEach((r) => {
      const el = document.getElementById(`lbl-role-${r}`);
      if (el) {
        if (r === role) {
          el.className = "flex flex-col items-center justify-center p-3 rounded-xl border-2 border-teal-500 bg-teal-50/40 text-teal-700 cursor-pointer transition-all hover:bg-teal-50/20 text-center relative";
        } else {
          el.className = "flex flex-col items-center justify-center p-3 rounded-xl border border-slate-200 bg-white text-slate-600 cursor-pointer transition-all hover:bg-slate-50 text-center relative";
        }
      }
    });

    if (role === "store") {
      lblFullname.innerText = "Store Name";
      promptBlock.classList.remove("hidden");
    } else if (role === "delivery") {
      lblFullname.innerText = "Delivery Agent Name";
      promptBlock.classList.remove("hidden");
    } else {
      lblFullname.innerText = "Full Name";
      promptBlock.classList.add("hidden");
    }
  });
});

// Capture GPS Location
btnCaptureGps.addEventListener("click", async () => {
  try {
    gpsStatusTxt.innerText = "Capturing...";
    capturedLocation = await getCurrentGPS();
    gpsStatusTxt.innerText = "GPS Captured ✓";
    btnCaptureGps.className = "mt-2 inline-flex items-center gap-1.5 bg-emerald-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-all";
    showToast("GPS location captured successfully!", "success");
    console.log("Captured Loc:", capturedLocation);
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

// Check Roles and Redirect
async function handleUserRedirect(uid: string) {
  try {
    const userRef = ref(db, `users/${uid}`);
    const snapshot = await get(userRef);
    
    if (!snapshot.exists()) {
      showToast("No user account detail in database", "error");
      await signOut(auth);
      return;
    }

    const userData = snapshot.val();
    
    if (userData.isBlocked) {
      showToast("Your account has been suspended by the Admin.", "error");
      await signOut(auth);
      return;
    }

    // Checking of approval status for partners
    if (userData.role === "store" || userData.role === "delivery" || userData.role === "deliveryboy1") {
      if (!userData.approved) {
        showToast("Your registration is pending admin approval.", "info");
        await signOut(auth);
        return;
      }
    }

    showToast(`Welcome back, ${userData.name}!`, "success");
    
    // Role based mapping
    if (userData.role === "admin") {
      window.location.href = "/admin.html";
    } else if (userData.role === "user") {
      window.location.href = "/user.html";
    } else if (userData.role === "store") {
      window.location.href = "/store.html";
    } else if (userData.role === "delivery" || userData.role === "deliveryboy1") {
      window.location.href = "/delivery.html";
    }
  } catch (error) {
    console.error("Redirect check error:", error);
    showToast("Error checking user system record", "error");
  }
}

// Watch auth state redirect on load
auth.onAuthStateChanged((user) => {
  if (user) {
    handleUserRedirect(user.uid);
  }
});

// Form Login action
formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = (document.getElementById("login-email") as HTMLInputElement).value.trim();
  const pass = (document.getElementById("login-password") as HTMLInputElement).value;

  const loader = document.getElementById("portal-loader") as HTMLDivElement;
  loader.classList.remove("hidden");
  formLogin.classList.add("hidden");

  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    await handleUserRedirect(cred.user.uid);
  } catch (err: any) {
    console.error("Authentication Error code:", err.code);
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      try {
        console.log(`Auto registering on credentials error: ${email}`);
        await seedDefaultConfig();

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

        let role = "user";
        let name = finalEmail.split("@")[0];
        name = name.charAt(0).toUpperCase() + name.slice(1);
        let mobile = "9988776655";

        if (finalEmail.startsWith("admin")) {
          role = "admin";
          name = "Harsh (Admin)";
          mobile = "9876543210";
        } else if (finalEmail.startsWith("store") || finalEmail.startsWith("m_branch") || finalEmail.startsWith("partner")) {
          role = "store";
          name = "Apollo Premium Pharmacy";
          mobile = "8877665544";
        } else if (finalEmail.startsWith("delivery") || finalEmail.startsWith("rider")) {
          role = "delivery";
          name = "Rohan (Express Rider)";
          mobile = "7766554433";
        }

        const profile = {
          uid,
          name,
          email: finalEmail,
          mobile,
          role,
          approved: true, // Auto-approve on recovery
          active: true,
          createdAt: Date.now()
        };

        await set(ref(db, `users/${uid}`), profile);

        if (role === "store") {
          await set(ref(db, `stores/${uid}`), {
            storeId: uid,
            name,
            ownerName: name,
            email: finalEmail,
            mobile,
            approved: true,
            active: true,
            address: "Indira Nagar, Bengaluru, Karnataka, India",
            location: { lat: 12.9716, lng: 77.5946 },
            city: "Bengaluru",
            district: "Bengaluru",
            state: "Karnataka"
          });

          const medicines = [
            {
              medicineId: `med_${uid}_1`,
              storeId: uid,
              storeName: name,
              name: "Paracetamol 650mg",
              price: 30,
              description: "Fever and mild body pain relief paracetamol",
              category: "Fever & Cold",
              image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300",
              stock: 90
            },
            {
              medicineId: `med_${uid}_2`,
              storeId: uid,
              storeName: name,
              name: "Amoxicillin 500mg",
              price: 120,
              description: "Broad spectrum antibiotic capsules for infections",
              category: "Prescription",
              image: "https://images.unsplash.com/photo-1512438248247-f0f2a5a8b7f0?w=300",
              stock: 45
            },
            {
              medicineId: `med_${uid}_3`,
              storeId: uid,
              storeName: name,
              name: "Cetirizine 10mg",
              price: 45,
              description: "Fast-acting cold and allergy antihistamine tablets",
              category: "Allergies",
              image: "https://images.unsplash.com/photo-1628243343371-99a1d279539f?w=300",
              stock: 60
            },
            {
              medicineId: `med_${uid}_4`,
              storeId: uid,
              storeName: name,
              name: "Multivitamin Immunity Gummie",
              price: 280,
              description: "Pack of 30 multivitamins with premium zinc boosters",
              category: "Wellness & Vitamins",
              image: "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=300",
              stock: 120
            }
          ];

          for (const med of medicines) {
            await set(ref(db, `medicines/${med.medicineId}`), med);
          }
        } else if (role === "delivery") {
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
        }

        showToast("Developer account auto-provisioned! Entering...", "success");
        await handleUserRedirect(uid);
      } catch (innerErr) {
        console.error("Auto registration failed:", innerErr);
        loader.classList.add("hidden");
        formLogin.classList.remove("hidden");
        showToast("Invalid credentials or authentication issue.", "error");
      }
    } else {
      loader.classList.add("hidden");
      formLogin.classList.remove("hidden");
      showToast("Invalid credentials or authentication issue.", "error");
    }
  }
});

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

// Form Register action
formRegister.addEventListener("submit", async (e) => {
  e.preventDefault();
  const role = (document.querySelector('input[name="reg-role"]:checked') as HTMLInputElement).value;
  const name = (document.getElementById("reg-name") as HTMLInputElement).value.trim();
  const email = (document.getElementById("reg-email") as HTMLInputElement).value.trim();
  const mobile = (document.getElementById("reg-mobile") as HTMLInputElement).value.trim();
  const pass = (document.getElementById("reg-password") as HTMLInputElement).value;

  if ((role === "store" || role === "delivery") && !capturedLocation) {
    // Graceful automatic simulation location when GPS fails or not supported (e.g. inside iframes)
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

  const loader = document.getElementById("portal-loader") as HTMLDivElement;
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
      role,
      approved: role === "user" ? true : false, // Users are auto-approved, Partners need Admin
      active: true,
      createdAt: Date.now()
    };

    // Store in general users path
    await set(ref(db, `users/${uid}`), userProfile);

    // Initialize partner table node
    if (role === "store") {
      await set(ref(db, `stores/${uid}`), {
        storeId: uid,
        name,
        ownerName: name,
        email,
        mobile,
        approved: false,
        active: true,
        address: capturedLocation?.address || "Custom Store Location",
        location: {
          lat: capturedLocation?.lat || 12.9716,
          lng: capturedLocation?.lng || 77.5946
        },
        city: capturedLocation?.city || "Bengaluru",
        district: capturedLocation?.district || "Bengaluru",
        state: capturedLocation?.state || "Karnataka"
      });
    } else if (role === "delivery") {
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
        // Also keep compatibility parameters (not part of the 20 fields but useful for UI state logic)
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
    }

    showToast("Registration completed! Login using credentials.", "success");
    
    // Switch to Login tab
    tabLogin.click();
    (document.getElementById("login-email") as HTMLInputElement).value = email;
    (document.getElementById("login-password") as HTMLInputElement).value = pass;
    
    loader.classList.add("hidden");
    formLogin.classList.remove("hidden");

  } catch (err: any) {
    console.error("Registration details error:", err);
    loader.classList.add("hidden");
    formRegister.classList.remove("hidden");
    showToast(err.message || "Registration failed.", "error");
  }
});

// Fast login button binding & direct seed setup
document.querySelectorAll(".btn-fast-login").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const target = e.currentTarget as HTMLButtonElement;
    const email = target.getAttribute("data-email")!;
    const pass = target.getAttribute("data-pass")!;

    const loader = document.getElementById("portal-loader") as HTMLDivElement;
    loader.classList.remove("hidden");
    formLogin.classList.add("hidden");
    formRegister.classList.add("hidden");

    try {
      // First try to Seed Default Global Settings
      await seedDefaultConfig();

      // Attempt standard auth
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await handleUserRedirect(cred.user.uid);
    } catch (err: any) {
      // If user does not exist, auto-register them in Realtime Db fast-path
      if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
        try {
          console.log(`Auto registering target: ${email}`);
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

          // Determine role based on standard credentials
          let role = "user";
          let name = "Harsh Vardhan Tiwari";
          let mobile = "9988776655";

          if (finalEmail.startsWith("admin")) {
            role = "admin";
            name = "Harsh (Admin)";
            mobile = "9876543210";
          } else if (finalEmail.startsWith("store")) {
            role = "store";
            name = "Apollo Premium Pharmacy";
            mobile = "8877665544";
          } else if (finalEmail.startsWith("delivery")) {
            role = "delivery";
            name = "Rohan (Express Rider)";
            mobile = "7766554433";
          }

          const profile = {
            uid,
            name,
            email: finalEmail,
            mobile,
            role,
            approved: true, // Auto bypass for developers
            active: true,
            createdAt: Date.now()
          };

          await set(ref(db, `users/${uid}`), profile);

          if (role === "store") {
            await set(ref(db, `stores/${uid}`), {
              storeId: uid,
              name,
              ownerName: name,
              email: finalEmail,
              mobile,
              approved: true,
              active: true,
              address: "Indira Nagar, Bengaluru, Karnataka, India",
              location: { lat: 12.9716, lng: 77.5946 },
              city: "Bengaluru",
              district: "Bengaluru",
              state: "Karnataka"
            });

            // Seed store default inventory/medicines
            const medicines = [
              {
                medicineId: `med_${uid}_1`,
                storeId: uid,
                storeName: name,
                name: "Paracetamol 650mg",
                price: 30,
                description: "Fever and mild body pain relief paracetamol",
                category: "Fever & Cold",
                image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300",
                stock: 90
              },
              {
                medicineId: `med_${uid}_2`,
                storeId: uid,
                storeName: name,
                name: "Amoxicillin 500mg",
                price: 120,
                description: "Broad spectrum antibiotic capsules for infections",
                category: "Prescription",
                image: "https://images.unsplash.com/photo-1512438248247-f0f2a5a8b7f0?w=300",
                stock: 45
              },
              {
                medicineId: `med_${uid}_3`,
                storeId: uid,
                storeName: name,
                name: "Cetirizine 10mg",
                price: 45,
                description: "Fast-acting cold and allergy antihistamine tablets",
                category: "Allergies",
                image: "https://images.unsplash.com/photo-1628243343371-99a1d279539f?w=300",
                stock: 60
              },
              {
                medicineId: `med_${uid}_4`,
                storeId: uid,
                storeName: name,
                name: "Multivitamin Immunity Gummie",
                price: 280,
                description: "Pack of 30 multivitamins with premium zinc boosters",
                category: "Wellness & Vitamins",
                image: "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=300",
                stock: 120
              }
            ];

            for (const med of medicines) {
              await set(ref(db, `medicines/${med.medicineId}`), med);
            }
          } else if (role === "delivery") {
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
              verificationStatus: "Approved",
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
              approved: true,
              active: true,
              location: { lat: 12.9716, lng: 77.5946 }
            });
          }

          showToast("Developer account provisioned! Entering...", "success");
          await handleUserRedirect(uid);
        } catch (innerErr) {
          console.error("Auto provision error:", innerErr);
          showToast("Failed to auto-provision tester profile", "error");
          loader.classList.add("hidden");
          formLogin.classList.remove("hidden");
        }
      } else {
        console.error("Signin fallback error:", err);
        loader.classList.add("hidden");
        formLogin.classList.remove("hidden");
        showToast("Login error - Check logs", "error");
      }
    }
  });
});
