import * as fs from "fs";
import { execSync } from "child_process";

/**
 * Détecte l'exécutable Chrome / Chromium disponible sur le système dans l'ordre :
 * 1. Variable d'env CHROME_PATH
 * 2. Chemins standards macOS / Linux / Windows
 * 3. Commande dans le PATH (which / where)
 */
export function findChromePath(): string {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const candidates = [
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Tenter de trouver dans le PATH (macOS / Linux / Windows)
  try {
    const cmd = process.platform === "win32" ? "where chrome || where chromium" : "which google-chrome || which chromium || which google-chrome-stable";
    const res = execSync(cmd, { stdio: "pipe" }).toString().trim().split(/\r?\n/)[0];
    if (res && fs.existsSync(res)) return res;
  } catch {
    // Ignorer et déclencher l'erreur ci-dessous
  }

  throw new Error(
    `❌ Chrome / Chromium introuvable. Définissez CHROME_PATH ou installez Google Chrome pour générer les PDF.`
  );
}
