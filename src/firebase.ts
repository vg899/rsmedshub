import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

export const firebaseConfig = {
  apiKey: "AIzaSyAos4f3YnHa1RV014pf7LYhStTBIdKlJkY",
  authDomain: "rsmedshub.firebaseapp.com",
  databaseURL: "https://rsmedshub-default-rtdb.firebaseio.com",
  projectId: "rsmedshub",
  storageBucket: "rsmedshub.firebasestorage.app",
  messagingSenderId: "323515305996",
  appId: "1:323515305996:web:c9b195a163ca84af121e29"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
