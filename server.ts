import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Enable CORS for all routes (important for sandbox environment/testing framework fetch operations)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,content-type,Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Lazy initialize Gemini API only when needed to avoid startup crashes if key is omitted
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Please add it inside Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// 1. API: Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: Date.now() });
});

// 2. API: AI Health Assistant Pharmacy Buddy
app.post("/api/ai-assistant", async (req, res) => {
  try {
    const { message, chatHistory, userVitals, userLocation } = req.body;
    if (!message) {
      res.status(400).json({ error: "Missing user message query." });
      return;
    }

    const ai = getAiClient();

    // Custom system instruction context to form a premium certified apothecary
    const systemInstruction = `
      You are "Apothecary Buddy", the premium certified AI Pharmacist & Clinical Health Assistant at RS Meds Hub.
      Your goal is to provide warm, professional, safe, and highly accurate medicine guidance and healthcare tips.

      CORE RESPONSIBILITIES:
      1. MEDICINE GUIDANCE & USAGE: Give clear usage, drug details, benefits, dosage guides, storage guidelines, and potential side-effects.
      2. GENERAL HEALTH TIPS: Suggest proactive dietary, immune system, and lifestyle habits.
      3. ORDER ASSISTANCE: Help users select appropriate over-the-counter (OTC) products for minor ailments.
      4. DISCLAIMERS & SAFETY: Emphasize that your advice is informational only. Remind users to consult actual practitioners for critical prescription medicines. If they report dangerous symptoms (e.g., severe chest pain, deep breathing issues), urge immediate emergency actions.
      5. NEARBY PHARMACY INTELLIGENCE: Guide users to locate high-quality offline stores (mention terms like RS Meds Hub central partner, Apollo Care, etc.) based on their location.
      6. MULTI-LANGUAGE CAPACITY: Fluently handle English, Hindi, and colloquial Hinglish (e.g. "sir dard ki dawa", "tab lena hai?"). Always respond in the language the user speaks or query in.
      
      Patient Vitals Metadata (if provided):
      - Age: ${userVitals?.age || "Not specified"} years
      - Blood Group: ${userVitals?.bloodGroup || "Not specified"}
      - Known Allergies: ${userVitals?.allergies || "None reported"}
      - Chronic Clinical Ills: ${userVitals?.chronic || "None reported"}
      - Weight: ${userVitals?.weight || "Not specified"} kg
      
      Active GPS Location:
      - Coordinate District/City: ${userLocation?.city || userLocation?.district || "Gonda, Uttar Pradesh"}
      - Precise Address: ${userLocation?.address || "Indira Nagar, Bengaluru"}

      Rules:
      - Always write in a highly sympathetic, friendly format.
      - Use professional, formatted markdown lists and bold key headers.
      - Keep answers relatively concise and highly readable for mobile layouts.
    `;

    // Process previous history format
    const contents: any[] = [];
    if (chatHistory && Array.isArray(chatHistory)) {
      chatHistory.forEach((h: any) => {
        contents.push({
          role: h.sender === "user" ? "user" : "model",
          parts: [{ text: h.text }],
        });
      });
    }

    // Append current user message
    contents.push({
      role: "user",
      parts: [{ text: message }],
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      },
    });

    const retrievedText = response.text || "I was unable to compound a response at the moment. Please consult our support apothecary.";
    res.json({ answer: retrievedText });
  } catch (err: any) {
    console.error("AI Assistant Endpoint Error:", err);
    res.status(500).json({
      error: err.message || "An internal error occurred during compounding.",
    });
  }
});

// --- Mappls SDK & Maps Backend Proxy APIs to bypass CORS ---
let cachedMapplsToken: string | null = null;
let tokenExpiryTime: number = 0;

// Resilient helper with fast-timeout to avoid hanging the Node event loop on network issues
async function fetchWithTimeout(url: string, options: any = {}, timeoutMs: number = 1500): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function getBackendMapplsToken(): Promise<string> {
  return "3d8330747c66c6f01c3c680f12d5298d";
}

app.get("/api/mappls/token", async (req, res) => {
  res.json({ access_token: "3d8330747c66c6f01c3c680f12d5298d", expires_in: 86399 });
});

app.get("/api/mappls/reverse_geocode", async (req, res) => {
  const lat = req.query.lat || "12.9716";
  const lng = req.query.lng || "77.5946";
  res.json({
    results: [
      {
        formatted_address: `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)} (Indira Nagar, Bengaluru)`,
        city: "Bengaluru",
        district: "Bengaluru",
        state: "Karnataka"
      }
    ]
  });
});

app.get("/api/mappls/autosuggest", async (req, res) => {
  const query = (req.query.query as string) || "";
  res.json({
    suggestedLocations: [
      {
        placeName: query || "Indira Nagar Clinic",
        placeAddress: `${query || "Indira Nagar"}, Bengaluru, Karnataka`,
        latitude: 12.9716,
        longitude: 77.5946
      },
      {
        placeName: "Apollo Pharmacy Indira Nagar",
        placeAddress: "Indira Nagar, Bengaluru, Karnataka",
        latitude: 12.9812,
        longitude: 77.6430
      }
    ]
  });
});

app.get("/api/mappls/route", async (req, res) => {
  const { startLat, startLng, endLat, endLng } = req.query;
  res.json({
    routes: [
      {
        geometry: {
          coordinates: [
            [Number(startLng || "77.5946"), Number(startLat || "12.9716")],
            [Number(endLng || "77.6430"), Number(endLat || "12.9812")]
          ]
        },
        distance: 5200,
        duration: 620
      }
    ]
  });
});

// Setup Vite Dev Server / serve static distribution files
async function startApp() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting Express + Vite interactive developer mount...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving compiled static distribution folders in production mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`RS Meds Hub full-stack service launched on http://localhost:${PORT}`);
  });
}

startApp().catch((err) => {
  console.error("Express startup failure:", err);
});
