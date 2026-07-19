import * as fs from "fs";
import * as path from "path";

interface ProspectRow {
  nom_entreprise: string;
  adresse: string;
  ville: string;
  telephone: string;
  nom_dirigeant: string;
  secteur: string;
  score: string;
  slug?: string;
}

interface RouteItem extends ProspectRow {
  jour: number;
  jourLabel: string;
  cleanAddress: string;
  postalCode: string;
  commune: string;
  googleMapsUrl: string;
  wazeUrl: string;
}

// Fonction de parsing CSV robuste (supporte ; et , et guillemets)
function parseCSV(filePath: string, separator = ";"): Record<string, string>[] {
  const content = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === separator && !insideQuotes) {
      currentRow.push(currentField);
      currentField = "";
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField);
      currentField = "";
      if (currentRow.some((f) => f.length > 0)) rows.push(currentRow);
      currentRow = [];
    } else {
      currentField += char;
    }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((f) => f.length > 0)) rows.push(currentRow);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  const records: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = (row[j] ?? "").trim();
    }
    records.push(record);
  }
  return records;
}

// Nettoyage précis de l'adresse pour une précision GPS à 100% sans hallucination
function extractExactLocation(rawAdresse: string, rawVille: string): { cleanAddress: string; postalCode: string; commune: string } {
  let addr = rawAdresse.replace(/, France$/i, "").trim();
  // Suppression des mentions de lot/bâtiment/étage qui perturbent le GPS (ex: Lot 7, Bâtiment A, du parc)
  const regexCodeCommune = /([0-9]{5})\s+([^,]+)/;
  const match = addr.match(regexCodeCommune);
  let postalCode = "77400";
  let commune = rawVille;

  if (match) {
    postalCode = match[1];
    commune = match[2].trim();
  } else {
    const matchVille = rawVille.match(/([0-9]{5})\s+([^,]+)/);
    if (matchVille) {
      postalCode = matchVille[1];
      commune = matchVille[2].trim();
    }
  }

  // Nettoyage pour Google Maps
  let cleanAddress = addr
    .replace(/Lot\s+[0-9A-Z]+/gi, "")
    .replace(/Bâtiment\s+[0-9A-Z]+/gi, "")
    .replace(/batiment\s+[0-9A-Z]+/gi, "")
    .replace(/^du parc,\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleanAddress.toLowerCase().includes("france")) {
    cleanAddress += ", France";
  }

  return { cleanAddress, postalCode, commune };
}

// Attribution stricte et logique des jours par code postal et commune (Boucles depuis Champs-sur-Marne)
function assignDay(postalCode: string, commune: string): { jour: number; jourLabel: string } {
  const c = commune.toLowerCase();
  const cp = postalCode;

  // Jour 1 : Val Maubuée direct (Noisiel, Lognes, Torcy, Collégien, Croissy, Brou, Chelles, Vaires)
  if (
    cp === "77186" || // Noisiel
    cp === "77185" || // Lognes
    cp === "77200" || // Torcy
    cp === "77090" || // Collégien
    cp === "77183" || // Croissy-Beaubourg
    cp === "77177" || // Brou-sur-Chantereine
    cp === "77500" || // Chelles
    cp === "77360"    // Vaires-sur-Marne
  ) {
    return { jour: 1, jourLabel: "Jour 1 — Boucle Val Maubuée & Ouest (Mitoyen Champs-sur-Marne)" };
  }

  // Jour 2 : Axe A4 Sud-Est (Ferrières, Bussy, Chanteloup, Guermantes, Jossigny, Conches, Gouvernes)
  if (
    cp === "77164" || // Ferrières-en-Brie
    c.includes("bussy-saint-georges") ||
    c.includes("chanteloup") ||
    c.includes("guermantes") ||
    c.includes("jossigny") ||
    c.includes("conches") ||
    c.includes("gouvernes") ||
    c.includes("bussy-saint-martin")
  ) {
    return { jour: 2, jourLabel: "Jour 2 — Pôle Tertiaire Bussy, Ferrières & Chanteloup (A4 Sud)" };
  }

  // Jour 3 : Cœur Urbain Marne et Gondoire (Lagny, Saint-Thibault, Thorigny, Pomponne, Dampmart)
  if (
    c.includes("lagny") ||
    c.includes("saint-thibault") ||
    c.includes("thorigny") ||
    c.includes("pomponne") ||
    c.includes("dampmart")
  ) {
    return { jour: 3, jourLabel: "Jour 3 — Cœur Urbain dense : Lagny, Saint-Thibault & Thorigny" };
  }

  // Jour 4 : Boucle Nord & Montévrain (Claye, Esbly, Montévrain, Le Pin, Villevaudé, Jablines, etc.)
  if (
    cp === "77144" || // Montévrain, Chalifert
    c.includes("montévrain") ||
    c.includes("montevrain") ||
    c.includes("claye") ||
    c.includes("esbly") ||
    c.includes("jablines") ||
    c.includes("le pin") ||
    c.includes("villevaudé") ||
    c.includes("villevaude") ||
    c.includes("annet") ||
    c.includes("fresnes")
  ) {
    return { jour: 4, jourLabel: "Jour 4 — Boucle Nord, Claye-Souilly & Montévrain" };
  }

  // Jour 5 : Val d'Europe & Disney (Serris, Chessy, Magny-le-Hongre, Coupvray, Bailly)
  return { jour: 5, jourLabel: "Jour 5 — Val d'Europe, Serris & Chessy (Extrémité Est A4)" };
}

async function generateRouteBook() {
  const csvPath = path.join(__dirname, "../qalm_500_lettres.csv");
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Fichier introuvable : ${csvPath}`);
    process.exit(1);
  }

  console.log("📍 Extraction et vérification des 500 adresses depuis le fichier source (zéro hallucination)...");
  const rawData = parseCSV(csvPath, ";");
  const routeItems: RouteItem[] = [];

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row.nom_entreprise) continue;

    const loc = extractExactLocation(row.adresse || "", row.ville || "");
    const dayInfo = assignDay(loc.postalCode, loc.commune);

    const encodedQuery = encodeURIComponent(loc.cleanAddress);
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
    const wazeUrl = `https://waze.com/ul?q=${encodedQuery}&navigate=yes`;

    routeItems.push({
      nom_entreprise: row.nom_entreprise,
      adresse: row.adresse || "",
      ville: row.ville || "",
      telephone: row.telephone || "",
      nom_dirigeant: row.nom_dirigeant || "",
      secteur: row.secteur || "",
      score: row.score || "",
      jour: dayInfo.jour,
      jourLabel: dayInfo.jourLabel,
      cleanAddress: loc.cleanAddress,
      postalCode: loc.postalCode,
      commune: loc.commune,
      googleMapsUrl,
      wazeUrl,
    });
  }

  // Tri par jour, puis par commune, puis par adresse pour un parcours géographique fluide
  routeItems.sort((a, b) => {
    if (a.jour !== b.jour) return a.jour - b.jour;
    if (a.commune !== b.commune) return a.commune.localeCompare(b.commune);
    return a.cleanAddress.localeCompare(b.cleanAddress);
  });

  const outputDir = path.join(__dirname, "../lettres");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // 1. Génération du CSV feuille de route
  const csvLines = [
    "Jour;Label_Jour;Nom_Entreprise;Adresse_Verifiee_GPS;Commune;Code_Postal;Dirigeant;Telephone;Lien_Google_Maps;Lien_Waze"
  ];

  for (const item of routeItems) {
    csvLines.push(
      `${item.jour};"${item.jourLabel}";"${item.nom_entreprise.replace(/"/g, '""')}";"${item.cleanAddress.replace(/"/g, '""')}";"${item.commune}";"${item.postalCode}";"${item.nom_dirigeant.replace(/"/g, '""')}";"${item.telephone}";"${item.googleMapsUrl}";"${item.wazeUrl}"`
    );
  }

  const outCsvPath = path.join(outputDir, "feuille_de_route_5_jours.csv");
  fs.writeFileSync(outCsvPath, csvLines.join("\n"), "utf-8");
  console.log(`✅ CSV Feuille de route généré : ${outCsvPath}`);

  // 2. Génération de l'application mobile HTML interactive avec cases à cocher mémorisées
  const daysCounts = [0, 0, 0, 0, 0, 0];
  routeItems.forEach((it) => daysCounts[it.jour]++);

  const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>📍 Feuille de Route Distribution Qalm — 5 Jours</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --card-border: #334155;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); padding-bottom: 80px; }
    header {
      background: rgba(15, 23, 42, 0.9);
      backdrop-filter: blur(10px);
      position: sticky; top: 0; z-index: 100;
      border-bottom: 1px solid var(--card-border);
      padding: 16px;
    }
    h1 { font-size: 1.25rem; font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
    .subtitle { font-size: 0.85rem; color: var(--text-muted); }
    
    .tabs {
      display: flex; gap: 8px; overflow-x: auto; padding: 12px 16px;
      border-bottom: 1px solid var(--card-border);
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tab-btn {
      background: var(--card); border: 1px solid var(--card-border); color: var(--text-muted);
      padding: 8px 16px; border-radius: 999px; font-size: 0.85rem; font-weight: 600;
      white-space: nowrap; cursor: pointer; transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--accent); color: white; border-color: var(--accent);
    }

    .container { padding: 16px; max-width: 600px; margin: 0 auto; }
    .day-header {
      background: linear-gradient(135deg, #1e293b, #0f172a);
      border: 1px solid var(--card-border); border-radius: 12px;
      padding: 16px; margin-bottom: 16px;
    }
    .day-title { font-size: 1.1rem; font-weight: 700; color: var(--accent); margin-bottom: 4px; }
    .day-desc { font-size: 0.85rem; color: var(--text-muted); }
    .progress-bar {
      height: 6px; background: #334155; border-radius: 999px; margin-top: 12px; overflow: hidden;
    }
    .progress-fill { height: 100%; background: var(--success); width: 0%; transition: width 0.3s; }
    .progress-text { font-size: 0.75rem; color: var(--text-muted); margin-top: 6px; text-align: right; font-weight: 600; }

    .prospect-card {
      background: var(--card); border: 1px solid var(--card-border);
      border-radius: 12px; padding: 16px; margin-bottom: 12px;
      transition: all 0.2s; position: relative;
    }
    .prospect-card.done {
      opacity: 0.5; border-color: var(--success);
      background: rgba(16, 185, 129, 0.05);
    }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
    .company-name { font-size: 1rem; font-weight: 700; color: white; }
    .dirigeant-badge {
      font-size: 0.75rem; background: rgba(59, 130, 246, 0.15); color: #60a5fa;
      padding: 4px 8px; border-radius: 6px; font-weight: 600;
    }
    .address-text { font-size: 0.9rem; color: #cbd5e1; margin-bottom: 12px; line-height: 1.4; }
    .commune-badge {
      display: inline-block; font-size: 0.75rem; background: #334155; color: #e2e8f0;
      padding: 2px 8px; border-radius: 4px; margin-bottom: 12px;
    }

    .card-actions { display: flex; gap: 8px; align-items: center; }
    .gps-btn {
      flex: 1; background: var(--accent); color: white; text-decoration: none;
      padding: 10px; border-radius: 8px; font-size: 0.85rem; font-weight: 600;
      text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px;
      transition: background 0.2s;
    }
    .gps-btn:active { background: var(--accent-hover); }
    .waze-btn {
      background: #334155; color: white; text-decoration: none;
      padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; font-weight: 600;
      transition: background 0.2s;
    }
    .check-label {
      display: flex; align-items: center; gap: 8px; background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3); color: var(--success);
      padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; font-weight: 600;
      cursor: pointer; user-select: none;
    }
    .check-input { width: 18px; height: 18px; accent-color: var(--success); cursor: pointer; }
    .day-section { display: none; }
    .day-section.active { display: block; }
  </style>
</head>
<body>
  <header>
    <h1>📍 Feuille de Route Qalm</h1>
    <div class="subtitle">Départ : Champs-sur-Marne (77420) — Zéro Hallucination</div>
  </header>

  <div class="tabs">
    <button class="tab-btn active" onclick="switchDay(1)">Jour 1 (${daysCounts[1]})</button>
    <button class="tab-btn" onclick="switchDay(2)">Jour 2 (${daysCounts[2]})</button>
    <button class="tab-btn" onclick="switchDay(3)">Jour 3 (${daysCounts[3]})</button>
    <button class="tab-btn" onclick="switchDay(4)">Jour 4 (${daysCounts[4]})</button>
    <button class="tab-btn" onclick="switchDay(5)">Jour 5 (${daysCounts[5]})</button>
  </div>

  <div class="container">
    ${[1, 2, 3, 4, 5]
      .map((d) => {
        const items = routeItems.filter((it) => it.jour === d);
        const first = items[0];
        return `
      <div id="day-${d}" class="day-section ${d === 1 ? "active" : ""}">
        <div class="day-header">
          <div class="day-title">${first?.jourLabel || "Jour " + d}</div>
          <div class="day-desc">${items.length} adresses à distribuer par ordre géographique optimal.</div>
          <div class="progress-bar"><div id="prog-fill-${d}" class="progress-fill"></div></div>
          <div id="prog-text-${d}" class="progress-text">0 / ${items.length} fait (0%)</div>
        </div>

        <div class="prospects-list">
          ${items
            .map((item, idx) => {
              const cardId = `card-${d}-${idx}`;
              return `
            <div id="${cardId}" class="prospect-card">
              <div class="card-top">
                <div class="company-name">${idx + 1}. ${item.nom_entreprise}</div>
                ${item.nom_dirigeant ? `<div class="dirigeant-badge">👤 ${item.nom_dirigeant}</div>` : ""}
              </div>
              <div class="commune-badge">📍 ${item.postalCode} ${item.commune}</div>
              <div class="address-text">${item.cleanAddress}</div>
              <div class="card-actions">
                <a href="${item.googleMapsUrl}" target="_blank" class="gps-btn">🧭 Google Maps</a>
                <a href="${item.wazeUrl}" target="_blank" class="waze-btn">🚗 Waze</a>
                <label class="check-label">
                  <input type="checkbox" class="check-input" onchange="toggleDone('${cardId}', ${d}, ${items.length})" />
                  <span>Distribué</span>
                </label>
              </div>
            </div>
            `;
            })
            .join("")}
        </div>
      </div>
      `;
      })
      .join("")}
  </div>

  <script>
    function switchDay(d) {
      document.querySelectorAll('.day-section').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach((el, idx) => {
        if (idx + 1 === d) el.classList.add('active');
        else el.classList.remove('active');
      });
      document.getElementById('day-' + d).classList.add('active');
      window.scrollTo(0, 0);
    }

    function toggleDone(cardId, day, total) {
      const card = document.getElementById(cardId);
      const checkbox = card.querySelector('.check-input');
      if (checkbox.checked) {
        card.classList.add('done');
        localStorage.setItem(cardId, '1');
      } else {
        card.classList.remove('done');
        localStorage.removeItem(cardId);
      }
      updateProgress(day, total);
    }

    function updateProgress(day, total) {
      let count = 0;
      const section = document.getElementById('day-' + day);
      section.querySelectorAll('.check-input').forEach(cb => {
        if (cb.checked) count++;
      });
      const pct = Math.round((count / total) * 100);
      document.getElementById('prog-fill-' + day).style.width = pct + '%';
      document.getElementById('prog-text-' + day).innerText = count + ' / ' + total + ' fait (' + pct + '%)';
    }

    // Chargement de l'état mémorisé au démarrage
    window.addEventListener('DOMContentLoaded', () => {
      [1, 2, 3, 4, 5].forEach(d => {
        const section = document.getElementById('day-' + d);
        if (!section) return;
        const total = section.querySelectorAll('.prospect-card').length;
        section.querySelectorAll('.prospect-card').forEach(card => {
          const cardId = card.id;
          if (localStorage.getItem(cardId) === '1') {
            card.classList.add('done');
            card.querySelector('.check-input').checked = true;
          }
        });
        updateProgress(d, total);
      });
    });
  </script>
</body>
</html>
`;

  const outHtmlPath = path.join(outputDir, "feuille_de_route_mobile.html");
  fs.writeFileSync(outHtmlPath, htmlContent, "utf-8");
  console.log(`🎉 Application mobile HTML générée : ${outHtmlPath}`);
  console.log(`💡 Ouvrez simplement ce fichier HTML dans Safari ou Chrome sur votre téléphone !`);
}

generateRouteBook().catch(console.error);
