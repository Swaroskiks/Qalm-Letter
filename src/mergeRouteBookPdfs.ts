import * as fs from "fs";
import * as path from "path";
import { PDFDocument } from "pdf-lib";

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

interface RouteItem {
  nom_entreprise: string;
  adresse: string;
  ville: string;
  telephone: string;
  nom_dirigeant: string;
  slug: string;
  jour: number;
  jourLabel: string;
  cleanAddress: string;
  postalCode: string;
  commune: string;
}

// Fonction de parsing CSV
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

function extractExactLocation(rawAdresse: string, rawVille: string): { cleanAddress: string; postalCode: string; commune: string } {
  let addr = rawAdresse.replace(/, France$/i, "").trim();
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

function assignDay(postalCode: string, commune: string): { jour: number; jourLabel: string } {
  const c = commune.toLowerCase();
  const cp = postalCode;

  if (
    cp === "77186" || cp === "77185" || cp === "77200" || cp === "77090" ||
    cp === "77183" || cp === "77177" || cp === "77500" || cp === "77360"
  ) {
    return { jour: 1, jourLabel: "Jour_1_Val_Maubuee_et_Ouest" };
  }

  if (
    cp === "77164" || c.includes("bussy-saint-georges") || c.includes("chanteloup") ||
    c.includes("guermantes") || c.includes("jossigny") || c.includes("conches") ||
    c.includes("gouvernes") || c.includes("bussy-saint-martin")
  ) {
    return { jour: 2, jourLabel: "Jour_2_Pole_Tertiaire_Bussy_Ferrieres" };
  }

  if (
    c.includes("lagny") || c.includes("saint-thibault") || c.includes("thorigny") ||
    c.includes("pomponne") || c.includes("dampmart")
  ) {
    return { jour: 3, jourLabel: "Jour_3_Coeur_Urbain_Lagny_Thorigny" };
  }

  if (
    cp === "77144" || c.includes("montévrain") || c.includes("montevrain") ||
    c.includes("claye") || c.includes("esbly") || c.includes("jablines") ||
    c.includes("le pin") || c.includes("villevaudé") || c.includes("villevaude") ||
    c.includes("annet") || c.includes("fresnes")
  ) {
    return { jour: 4, jourLabel: "Jour_4_Boucle_Nord_Claye_Montevrain" };
  }

  return { jour: 5, jourLabel: "Jour_5_Val_d_Europe_Serris_Chessy" };
}

async function mergeRouteBookPdfs() {
  const csvPath = path.join(process.cwd(), "qalm_500_lettres.csv");
  const lettresDir = path.join(process.cwd(), "lettres");
  const pdfDir = path.join(lettresDir, "pdf");
  const outDir = path.join(lettresDir, "impression_par_jour");

  if (!fs.existsSync(pdfDir)) {
    console.error(`❌ Erreur : le dossier "${pdfDir}" n'existe pas.`);
    process.exit(1);
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log("📍 Calcul de l'itinéraire et chargement des 500 prospects dans l'ordre géographique...");
  const rawData = parseCSV(csvPath, ";");
  const routeItems: RouteItem[] = [];

  for (const row of rawData) {
    if (!row.nom_entreprise) continue;
    const loc = extractExactLocation(row.adresse || "", row.ville || "");
    const dayInfo = assignDay(loc.postalCode, loc.commune);
    const slug = slugify(row.nom_entreprise);

    routeItems.push({
      nom_entreprise: row.nom_entreprise,
      adresse: row.adresse || "",
      ville: row.ville || "",
      telephone: row.telephone || "",
      nom_dirigeant: row.nom_dirigeant || "",
      slug,
      jour: dayInfo.jour,
      jourLabel: dayInfo.jourLabel,
      cleanAddress: loc.cleanAddress,
      postalCode: loc.postalCode,
      commune: loc.commune,
    });
  }

  // Tri géographique exact (Ordre de la feuille de route mobile)
  routeItems.sort((a, b) => {
    if (a.jour !== b.jour) return a.jour - b.jour;
    if (a.commune !== b.commune) return a.commune.localeCompare(b.commune);
    return a.cleanAddress.localeCompare(b.cleanAddress);
  });

  console.log(`\n======================================================`);
  console.log(`📑 FUSION DES PDF DANS L'ORDRE EXACT DU ROUTE BOOK`);
  console.log(`======================================================\n`);

  const masterPdf = await PDFDocument.create();
  let totalMasterPages = 0;

  for (let d = 1; d <= 5; d++) {
    const dayItems = routeItems.filter((it) => it.jour === d);
    if (dayItems.length === 0) continue;

    const dayLabel = dayItems[0].jourLabel;
    console.log(`\n--- Génération du PDF pour le Jour ${d} (${dayItems.length} lettres) ---`);

    const dayPdf = await PDFDocument.create();
    let dayPages = 0;

    for (let i = 0; i < dayItems.length; i++) {
      const item = dayItems[i];
      const fileName = `${item.slug}.pdf`;
      const filePath = path.join(pdfDir, fileName);

      process.stdout.write(`  [Jour ${d} - ${i + 1}/${dayItems.length}] ${item.nom_entreprise} ... `);

      if (!fs.existsSync(filePath)) {
        console.log(`❌ FICHIER PDF INTROUVABLE (${fileName})`);
        continue;
      }

      try {
        const pdfBytes = fs.readFileSync(filePath);
        const pdf = await PDFDocument.load(pdfBytes);
        const pageIndices = pdf.getPageIndices();

        // Ajout au PDF du jour
        const copiedDayPages = await dayPdf.copyPages(pdf, pageIndices);
        for (const page of copiedDayPages) {
          dayPdf.addPage(page);
          dayPages++;
        }

        // Ajout au PDF master global
        const copiedMasterPages = await masterPdf.copyPages(pdf, pageIndices);
        for (const page of copiedMasterPages) {
          masterPdf.addPage(page);
          totalMasterPages++;
        }

        console.log(`✅ OK`);
      } catch (err: any) {
        console.log(`❌ ERREUR : ${err.message}`);
      }
    }

    const dayOutPath = path.join(outDir, `${dayLabel}.pdf`);
    const dayBytes = await dayPdf.save();
    fs.writeFileSync(dayOutPath, dayBytes);
    console.log(`🎉 Fichier généré pour le Jour ${d} : ${dayOutPath} (${dayPages} pages)`);
  }

  // Sauvegarde du Master PDF (les 5 jours dans l'ordre)
  const masterOutPath = path.join(outDir, `00_TOUTES_LES_500_LETTRES_ORDRE_ROUTE_BOOK.pdf`);
  const masterBytes = await masterPdf.save();
  fs.writeFileSync(masterOutPath, masterBytes);

  console.log(`\n======================================================`);
  console.log(`🎉 TOUTES LES FUSIONS SONT TERMINÉES AVEC SUCCÈS !`);
  console.log(`======================================================`);
  console.log(`📁 Dossier des PDF d'impression : ${outDir}`);
  console.log(`   1️⃣  Jour 1, 2, 3, 4 et 5 séparés (pour imprimer au jour le jour)`);
  console.log(`   2️⃣  00_TOUTES_LES_500_LETTRES_ORDRE_ROUTE_BOOK.pdf (${totalMasterPages} pages triées dans l'ordre géographique exact !)`);
  console.log(`======================================================\n`);
}

mergeRouteBookPdfs().catch((err) => {
  console.error("Erreur lors de la fusion du Route Book :", err);
  process.exit(1);
});
