import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import * as dotenv from "dotenv";
dotenv.config();

import Anthropic from "@anthropic-ai/sdk";
import { findChromePath } from "./chrome";

/** Slug simple pour le nom de fichier (accents et espaces retirés). */
function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** Paramètres CLI de la génération */
interface GenerateParams {
  inputPath: string;
  telephoneContact: string;
  siteWeb: string;
  separator: string;
  trackingMapPath?: string;
  generatePdf: boolean;
  dryRun?: number;
  resume: boolean;
  temperature: number;
}

/**
 * Analyse les arguments passés en ligne de commande.
 */
function parseArgs(): GenerateParams {
  const getArg = (name: string): string | undefined => {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    return arg?.split("=").slice(1).join("=");
  };

  const inputPath = getArg("input");
  if (!inputPath) {
    console.error("❌ Erreur : le paramètre --input=chemin/vers/fichier.csv est obligatoire.");
    console.error('Exemple : npm run generate-letters -- --input=./qalm_500_lettres.csv --separator=";" --telephone-contact="0756917569" --site-web="QalmAI.fr"');
    process.exit(1);
  }

  const telephoneContact = getArg("telephone-contact") ?? "07 56 91 75 69";
  const siteWeb = getArg("site-web") ?? "QalmAI.fr";
  const separator = getArg("separator") ?? ";";
  const trackingMapPath = getArg("tracking-map");
  const generatePdf = getArg("pdf") === "true";
  const dryRunStr = getArg("dry-run");
  const dryRun = dryRunStr && !isNaN(parseInt(dryRunStr, 10)) ? parseInt(dryRunStr, 10) : undefined;
  const resume = getArg("resume") === "true";
  const tempStr = getArg("temperature");
  const temperature = tempStr && !isNaN(parseFloat(tempStr)) ? parseFloat(tempStr) : 0.8;

  return {
    inputPath: path.resolve(process.cwd(), inputPath),
    telephoneContact,
    siteWeb,
    separator,
    trackingMapPath: trackingMapPath ? path.resolve(process.cwd(), trackingMapPath) : undefined,
    generatePdf,
    dryRun,
    resume,
    temperature,
  };
}

/**
 * Parseur CSV robuste gérant l'encodage UTF-8 (avec/sans BOM), le séparateur configurable,
 * les guillemets et les sauts de ligne dans les champs.
 */
function parseCsvFile(filePath: string, separator: string = ";"): Record<string, string>[] {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Erreur : le fichier CSV "${filePath}" n'existe pas.`);
    process.exit(1);
  }

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
        i++; // Ignorer le second guillemet échappé
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === separator && !insideQuotes) {
      currentRow.push(currentField);
      currentField = "";
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentField);
      currentField = "";
      if (currentRow.some((f) => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  if (headers.length === 1) {
    console.error(`❌ Erreur : 1 seule colonne détectée dans "${filePath}". Le séparateur actuel ("${separator}") n'est peut-être pas le bon (essayez --separator="," ou --separator=";").`);
    process.exit(1);
  }

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

/**
 * Extraie la vraie ville depuis le champ "adresse" si le champ "ville" est suspect ou répété.
 */
function extractVille(adresse: string, fallbackVille: string): string {
  if (!adresse) return fallbackVille.trim();
  const match = adresse.match(/\b(\d{5})\s+([A-Za-zÀ-ÿ\- /]+?)(?:,\s*France)?$/i);
  if (match && match[2] && match[2].trim().length > 1) {
    return match[2].trim();
  }
  return fallbackVille.trim();
}

/**
 * Sépare l'adresse en rue et code postal/ville pour le bloc destinataire de la lettre AFNOR.
 */
function extractAddressParts(adresse: string, fallbackVille: string): { rue: string; cpVille: string } {
  if (!adresse) return { rue: "Adresse non communiquée", cpVille: fallbackVille.trim() };
  const match = adresse.match(/^(.+?),\s*(\d{5})\s+([A-Za-zÀ-ÿ\- /]+?)(?:,\s*France)?$/i);
  if (match && match[1] && match[2]) {
    return {
      rue: match[1].trim(),
      cpVille: `${match[2]} ${match[3].trim()}`,
    };
  }
  return { rue: adresse.replace(/,\s*France$/i, "").trim(), cpVille: fallbackVille.trim() };
}

/**
 * Reconvertit les dates corrompues d'Excel vers la tranche d'effectif d'origine.
 */
function cleanEffectif(effectif: string): string {
  if (!effectif) return "";
  const cleaned = effectif.trim();
  
  if (/^0?1-(?:janv?|feb|févr?)$/i.test(cleaned)) return "1-2";
  if (/^0?3-(?:mai|may)$/i.test(cleaned)) return "3-5";
  if (/^0?6-(?:sept?|sep)$/i.test(cleaned)) return "6-9";
  if (/^10-(?:oct|octo?)$/i.test(cleaned)) return "10-19";

  if (/^\d{1,2}-[a-z]+/i.test(cleaned) && !/^\d+-\d+$/.test(cleaned)) {
    return "";
  }

  return cleaned;
}

/**
 * Extrait un prénom en casse Titre depuis nom_dirigeant (souvent en MAJUSCULES).
 * Ignore les civilités/particules. Gère les prénoms composés ("JEAN-PIERRE" -> "Jean-Pierre").
 */
function extractPrenom(nomDirigeant?: string): string | null {
  if (!nomDirigeant || !nomDirigeant.trim()) return null;

  let clean = nomDirigeant.trim()
    .replace(/^(Monsieur|Madame|Mme|M\.|M\s|Dr|Maître|Me|Pr)\s+/i, "")
    .trim();

  if (!clean) return null;

  const parts = clean.split(/\s+/);
  const first = parts[0];

  if (!first || first.length < 2) return null;

  return first.split("-").map((token) => {
    if (token.length === 0) return "";
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  }).join("-");
}

/**
 * Vérifie si le verbatim client dans citation_plainte_telephone est une véritable plainte négative
 * sur la joignabilité (injoignable, répondeur, etc.) et non un compliment ou un avis positif.
 */
function isVerbatimPlainteNegative(citation?: string): boolean {
  if (!citation || !citation.trim()) return false;
  const text = citation.trim();

  // Si c'est un compliment manifeste
  const positivePatterns = /(toujours joignable|facile (à|de) joindre|super accueil téléphonique|très bon accueil au téléphone|répond(ent)? (toujours|très vite|rapidement|tout de suite)|réactif au téléphone|merci pour (la rapidité|l'accueil)|jamais déçu par le téléphone)/i;
  if (positivePatterns.test(text) && !/(injoignable|répondeur|repondeur|impossible (à|de) joindre|aucun rappel|jamais de rappel|messagerie saturée|ne décroche jamais|personne au bout du fil|déplorable)/i.test(text)) {
    return false;
  }

  // Mots-clés stricts d'insatisfaction téléphonique
  const negativePatterns = /(injoignable|répondeur|repondeur|ne répond|impossible (à|de) joindre|aucun rappel|jamais (de )?rappel|pas de réponse|messagerie saturée|ne décroche|personne au bout du fil|attente interminable|difficile (à|de) joindre|sonne dans le vide|raccroche|service téléphonique déplorable|aucun retour téléphonique)/i;
  return negativePatterns.test(text);
}

/**
 * Résout un libellé métier court et naturel à partir d'indices dans nom_entreprise ou de la colonne grappe.
 * Évite d'injecter la liste brute de mots-clés du secteur.
 */
function resolveMetier(row: Record<string, string>): string {
  const nom = (row.nom_entreprise || "").toLowerCase();

  // Indices précis dans le nom d'entreprise
  if (/\bcarrosser/i.test(nom)) return "carrosserie";
  if (/\bgarage|m[eé]canique/i.test(nom)) return "garage auto";
  if (/\bcontr[oô]le\s*technique/i.test(nom)) return "centre de contrôle technique";
  if (/\bconcession/i.test(nom)) return "concession automobile";
  if (/\bcuisin/i.test(nom)) return "cuisiniste";
  if (/\bliterie/i.test(nom)) return "magasin de literie";
  if (/\b[eé]lectrom[eé]nager/i.test(nom)) return "magasin d'électroménager";
  if (/\bmeuble/i.test(nom)) return "magasin de meubles";
  if (/\brestaurant|brasserie|bistrot|pizz/i.test(nom)) return "restaurant";
  if (/\brooftop/i.test(nom)) return "rooftop";
  if (/\btraiteur/i.test(nom)) return "traiteur";
  if (/\bsalle de sport|fitness|gym/i.test(nom)) return "salle de sport";
  if (/\bgolf/i.test(nom)) return "golf";
  if (/\bbowling/i.test(nom)) return "bowling";
  if (/\binstitut|beaut[eé]|esth[eé]tique|ongl/i.test(nom)) return "institut de beauté";
  if (/\bspa\b/i.test(nom)) return "spa";
  if (/\bfrigoriste|climatisation/i.test(nom)) return "climatisation et froid";
  if (/\bpiscin/i.test(nom)) return "pisciniste";
  if (/\bpaysagiste|jardin/i.test(nom)) return "paysagiste";
  if (/\bloueur|location\s*(btp|mat[eé]riel)/i.test(nom)) return "location de matériel BTP";
  if (/\bauto-[eé]cole|conduite/i.test(nom)) return "auto-école";
  if (/\bplombier|plomberie/i.test(nom)) return "plomberie";
  if (/\b[eé]lectricien|[eé]lectricité/i.test(nom)) return "électricité";
  if (/\bserrurier|serrurerie/i.test(nom)) return "serrurerie";
  if (/\bchauffagiste|chauffage/i.test(nom)) return "chauffage";
  if (/\bh[oô]tel/i.test(nom)) return "hôtel";

  // Repli sur le mapping par grappe
  const grappe = (row.grappe || "").toLowerCase();
  if (grappe.includes("auto")) return "votre atelier";
  if (grappe.includes("habitat") || grappe.includes("showroom")) return "votre magasin";
  if (grappe.includes("loisir") || grappe.includes("r[eé]sa") || grappe.includes("résa") || grappe.includes("réservation")) return "votre établissement";
  if (grappe.includes("beaut[eé]") || grappe.includes("beauté") || grappe.includes("rdv")) return "votre institut";
  if (grappe.includes("artisan") || grappe.includes("b2b")) return "votre activité";

  // Si secteur unique court propre sans virgule
  const sec = (row.secteur || "").trim();
  if (sec && !sec.includes(",") && sec.length <= 35 && !/\b(et|ou|,|auto atelier|showroom)\b/i.test(sec)) {
    return sec;
  }

  return "votre activité";
}

/** Type et résolution du tracking par grappe */
type TrackingMap = Record<string, { site?: string; tel?: string }>;

function resolveTracking(
  grappe: string,
  defaultTel: string,
  defaultSite: string,
  map: TrackingMap
): { tel: string; site: string; used: string } {
  if (!grappe || Object.keys(map).length === 0) {
    return { tel: defaultTel, site: defaultSite, used: "non" };
  }
  if (map[grappe]) {
    const site = map[grappe].site || defaultSite;
    const tel = map[grappe].tel || defaultTel;
    return { tel, site, used: `oui (${grappe} -> site:${site}, tel:${tel})` };
  }
  for (const [k, v] of Object.entries(map)) {
    if (grappe.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(grappe.toLowerCase())) {
      const site = v.site || defaultSite;
      const tel = v.tel || defaultTel;
      return { tel, site, used: `oui (${k} -> site:${site}, tel:${tel})` };
    }
  }
  return { tel: defaultTel, site: defaultSite, used: "non" };
}

/**
 * Script principal de génération de lettres par entreprise.
 */
async function main(): Promise<void> {
  const params = parseArgs();
  console.log(`\n======================================================`);
  console.log(`📨 DÉMARRAGE DE LA GÉNÉRATION DE LETTRES QALM-LETTER`);
  console.log(`======================================================`);
  console.log(`Fichier source : ${params.inputPath}`);
  console.log(`Séparateur CSV : "${params.separator}"`);
  console.log(`Téléphone contact par défaut : ${params.telephoneContact}`);
  console.log(`Site web contact par défaut : ${params.siteWeb}`);
  console.log(`Tracking par grappe : ${params.trackingMapPath ? params.trackingMapPath : "Désactivé"}`);
  console.log(`Option Dry-Run : ${params.dryRun ? `Actif (${params.dryRun} lettres max)` : "Non"}`);
  console.log(`Option Resume (reprise) : ${params.resume ? "OUI (saut des fichiers existants)" : "NON"}`);
  console.log(`Température IA : ${params.temperature}`);

  let chromeExe = "";
  if (params.generatePdf) {
    try {
      chromeExe = findChromePath();
      console.log(`🖨️  Chrome portable détecté : ${chromeExe}`);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("❌ Erreur : ANTHROPIC_API_KEY manquante dans le fichier .env.");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  let trackingMap: TrackingMap = {};
  if (params.trackingMapPath && fs.existsSync(params.trackingMapPath)) {
    try {
      trackingMap = JSON.parse(fs.readFileSync(params.trackingMapPath, "utf-8"));
      console.log(`🔗 Tracking map chargée avec ${Object.keys(trackingMap).length} grappe(s).`);
    } catch (e: any) {
      console.warn(`⚠️  Erreur de chargement de la tracking-map JSON: ${e.message}`);
    }
  }

  const records = parseCsvFile(params.inputPath, params.separator);
  console.log(`\n✅ CSV chargé : ${records.length} entreprise(s) trouvée(s).`);

  const lettresDir = path.join(process.cwd(), "lettres");
  fs.mkdirSync(lettresDir, { recursive: true });

  const pdfDir = path.join(lettresDir, "pdf");
  fs.mkdirSync(pdfDir, { recursive: true });

  const templateHtmlMaster = fs.readFileSync(
    path.join(process.cwd(), "templates/template_lettre.html"),
    "utf-8"
  );

  const recapRecords: Array<{
    nom_entreprise: string;
    ville_extraite: string;
    secteur: string;
    grappe: string;
    tracking_utilise: string;
    angle_utilise: string;
    longueur_lettre: number;
    verification_ok: string;
    chemin_fichier_lettre: string;
    chemin_fichier_html: string;
    chemin_fichier_pdf: string;
  }> = [];

  const aVerifierRecords: Array<{
    nom_entreprise: string;
    siren: string;
    motif_echec: string;
    chemin_fichier_lettre: string;
    chemin_fichier_html: string;
  }> = [];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalLettersGenerated = 0;

  // Mots strictement interdits dans la lettre
  const FORBIDDEN_WORDS = [
    "révolutionnaire",
    "innovant",
    "solution",
    "optimiser",
    "disruptif",
    "gamechanger",
    "intelligence artificielle",
    "révolutionner",
    "propulser",
  ];

  // Mots-clés de vérification du transfert humain
  const TRANSFER_KEYWORDS = [
    "transfère",
    "transférer",
    "passe la main",
    "passer la main",
    "vers vous",
    "vers moi",
    "directement",
    "filet",
    "reprends",
    "reprenez",
    "humain",
  ];

  for (let i = 0; i < records.length; i++) {
    if (params.dryRun && i >= params.dryRun) {
      console.log(`\n🛑 [Dry-Run] Arrêt demandé après les ${params.dryRun} premières lettres.`);
      break;
    }

    const row = records[i];
    const nomEntreprise = row.nom_entreprise || `Entreprise_${i + 1}`;
    console.log(`\n------------------------------------------------------`);
    console.log(`[${i + 1}/${records.length}] Traitement : "${nomEntreprise}"`);

    const sirenPrefix = row.siren && row.siren.trim().length > 0 ? `${row.siren.trim()}_` : "";
    const slug = slugify(nomEntreprise);
    const fileNameTxt = `${sirenPrefix}${slug}.txt`;
    const filePathTxt = path.join(lettresDir, fileNameTxt);
    const fileNameHtml = `${sirenPrefix}${slug}.html`;
    const filePathHtml = path.join(lettresDir, fileNameHtml);
    const fileNamePdf = `${sirenPrefix}${slug}.pdf`;
    const filePathPdf = params.generatePdf ? path.join(pdfDir, fileNamePdf) : "";

    // 1. Nettoyage de la ville et de l'effectif
    const villeExtraite = extractVille(row.adresse || "", row.ville || "");
    const effectifPropre = cleanEffectif(row.effectif || "");

    // 2. Résolution du métier propre & tracking
    const metierPropre = resolveMetier(row);
    const tracking = resolveTracking(row.grappe || "", params.telephoneContact, params.siteWeb, trackingMap);

    // 3. Option Resume : si le fichier existe déjà, on saute l'appel API
    if (params.resume && fs.existsSync(filePathTxt) && fs.statSync(filePathTxt).size > 0) {
      console.log(`  ⏭️  [Resume] Fichier .txt existant (${fileNameTxt}), réutilisation...`);
      const existingText = fs.readFileSync(filePathTxt, "utf-8");
      const longueurLignes = existingText.split(/\r?\n/).filter((l: string) => l.trim().length > 0).length;

      let angleResume = `Métier (${metierPropre} à ${villeExtraite})`;
      const isPlainteExist = (row.plainte_telephonique || "").toLowerCase() === "oui" && isVerbatimPlainteNegative(row.citation_plainte_telephone);
      if (isPlainteExist) angleResume = `Plainte client avérée`;

      recapRecords.push({
        nom_entreprise: nomEntreprise,
        ville_extraite: villeExtraite,
        secteur: metierPropre,
        grappe: row.grappe || "",
        tracking_utilise: tracking.used,
        angle_utilise: angleResume,
        longueur_lettre: longueurLignes,
        verification_ok: "oui (resumé)",
        chemin_fichier_lettre: filePathTxt,
        chemin_fichier_html: filePathHtml,
        chemin_fichier_pdf: fs.existsSync(filePathPdf) ? filePathPdf : "Non généré",
      });
      continue;
    }

    // 4. Classification du dirigeant et extraction du prénom (casse Titre)
    const confiance = (row.confiance_dirigeant || "").toLowerCase();
    const isDirigeantFiable = confiance.includes("officielle") || confiance.includes("haute");
    const prenomExtrait = isDirigeantFiable ? extractPrenom(row.nom_dirigeant) : null;
    const salutationAttendue = prenomExtrait ? `Bonjour ${prenomExtrait},` : "Bonjour,";
    const nomDirigeantPourPrompt = isDirigeantFiable && row.nom_dirigeant && row.nom_dirigeant.trim().length >= 2
      ? row.nom_dirigeant.trim()
      : "Inconnu";

    // 5. Ancienneté et créneaux
    const ancienneteNum = parseInt(row.anciennete_annees || "0", 10);
    const ancienneteStr = !isNaN(ancienneteNum) && ancienneteNum > 0 ? `${ancienneteNum}` : "Non précisée";
    const creneaux = row.creneaux_non_couverts && row.creneaux_non_couverts.trim() !== "" && row.creneaux_non_couverts.trim() !== "Horaires continus / larges"
      ? row.creneaux_non_couverts.trim()
      : (row.horaires_ouverture || "Non précisés");

    // 6. Détection de la variante plainte et angle utilisé
    const isPlainteVariant = (row.plainte_telephonique || "").toLowerCase() === "oui" && isVerbatimPlainteNegative(row.citation_plainte_telephone);
    if ((row.plainte_telephonique || "").toLowerCase() === "oui" && !isPlainteVariant && row.citation_plainte_telephone) {
      console.log(`  ℹ️  [Filtre Plainte] Le verbatim n'est pas une plainte négative avérée ("${row.citation_plainte_telephone.slice(0, 45)}...") -> Bascule en GOLD_TEMPLATE_TEXT (variante standard).`);
    }
    let angleUtilise = `Métier (${metierPropre} à ${villeExtraite})`;
    if (isPlainteVariant) {
      angleUtilise = `Plainte client avérée (verbatim : "${row.citation_plainte_telephone.slice(0, 30)}...")`;
    } else if (creneaux && creneaux !== "Non précisés" && creneaux !== "Horaires non communiqués" && creneaux !== "Horaires continus / larges") {
      angleUtilise = `Créneaux non couverts (${creneaux})`;
    } else if (!isNaN(ancienneteNum) && ancienneteNum > 0) {
      angleUtilise = `Ancienneté (${ancienneteNum} ans d'activité)`;
    }

    // 7. Constitution du bloc DONNÉES DU PROSPECT
    let donneesProspectBlock =
      `Nom de l'entreprise : ${nomEntreprise}\n` +
      `Nom du dirigeant (si connu) : ${nomDirigeantPourPrompt}\n` +
      `Niveau de confiance sur ce nom : ${row.confiance_dirigeant || "Inconnu"}\n` +
      `Secteur / Métier réel : ${metierPropre}\n` +
      `Ville : ${villeExtraite}\n` +
      `Ancienneté : ${ancienneteStr} ${!isNaN(ancienneteNum) && ancienneteNum > 0 ? "ans" : ""}\n` +
      `Créneau non couvert (si connu) : ${creneaux}\n` +
      `Téléphone tracking à mentionner : ${tracking.tel}\n` +
      `Site web tracking à mentionner : ${tracking.site}`;

    if (isPlainteVariant) {
      donneesProspectBlock += `\n\nCONTEXTE SPÉCIFIQUE — PLAINTE TÉLÉPHONIQUE CLIENT :\n` +
        `Verbatim brut de l'avis client : "${row.citation_plainte_telephone.trim()}"\n` +
        `RÈGLES ABSOLUES SUR LA PLAINTE :\n` +
        `- Le paragraphe 1 fait référence à cette plainte avec tact et bienveillance (par exemple en mentionnant qu'en vous renseignant sur les entreprises à ${villeExtraite}, vous êtes tombé sur un avis d'un client qui regrettait de ne pas avoir réussi à joindre l'établissement par téléphone).\n` +
        `- Tu ne dois JAMAIS citer le verbatim client mot pour mot ni nommer le client. C'est strictement interdit pour ne pas être accusateur ou intrusif.\n` +
        `- L'intégralité des paragraphes 2, 3, 4 et 5 doivent rester rigoureusement et au mot près ceux du template.`;
    }

    const goldTemplateReference = isPlainteVariant
      ? `Bonjour [Prénom ou vide si inconnu/incertain],\n\n` +
        `En me renseignant sur les entreprises du coin, je suis tombé sur un avis d'un de vos clients qui regrettait de ne pas avoir réussi à vous joindre par téléphone. Ce n'est sûrement pas un cas isolé : quand on est pris, on ne peut pas décrocher, et chaque appel manqué peut coûter un client.\n\n` +
        `Je vous écris directement, par lettre, parce que je pense que ce sujet mérite un échange plus personnel. Je travaille avec Qalm et je suis à l’origine d’un assistant vocal qui décroche à votre place au quotidien. Il permet d’éviter les appels perdus, d’alléger votre secrétariat, de garantir une réponse rapide même en dehors de vos horaires, et de transformer chaque appel en opportunité commerciale.\n\n` +
        `L’assistant est configuré avec vos propres informations : il répond aux questions avec une voix naturelle, que vous pouvez adapter (ton, rythme, style de réponse), prend les rendez-vous ou note les messages. Et dès qu’une demande nécessite une intervention directe, l’appel est transféré sur votre portable. Vous gardez 100% de la main.\n\n` +
        `La mise en place prend cinq jours : deux points rapides sont prévus pour cadrer vos besoins, puis tout est pris en charge. Le tarif est pensé pour rester accessible, quel que soit votre secteur, et le premier mois est remboursé si cela ne vous convient pas.\n\n` +
        `Si vous avez cinq minutes, j’aimerais beaucoup en discuter avec vous par téléphone au <strong>${tracking.tel}</strong>. Vous pouvez aussi écouter un exemple et tester directement sur <strong>${tracking.site}</strong>, sans engagement.\n\n` +
        `À très vite,\n` +
        `Mouad de Qalm`
      : `Bonjour [Prénom ou vide si inconnu/incertain],\n\n` +
        `Vous devez régulièrement être coupé par des appels quand vous êtes pris, ou au contraire en manquer après la fermeture. Dans les deux cas, ça peut vite coûter un client. L’idée est simple : aucun client ne doit être laissé sans réponse, même quand vous êtes indisponible. Et chaque appel bien pris peut devenir un nouveau client.\n\n` +
        `Je vous écris directement, par lettre, parce que je pense que ce sujet mérite un échange plus personnel. Je travaille avec Qalm et je suis à l’origine d’un assistant vocal qui décroche à votre place au quotidien. Il permet d’éviter les appels perdus, d’alléger votre secrétariat, de garantir une réponse rapide même en dehors de vos horaires, et de transformer chaque appel en opportunité commerciale.\n\n` +
        `L’assistant est configuré avec vos propres informations : il répond aux questions avec une voix naturelle, que vous pouvez adapter (ton, rythme, style de réponse), prend les rendez-vous ou note les messages. Et dès qu’une demande nécessite une intervention directe, l’appel est transféré sur votre portable. Vous gardez 100% de la main.\n\n` +
        `La mise en place prend cinq jours : deux points rapides sont prévus pour cadrer vos besoins, puis tout est pris en charge. Le tarif est pensé pour rester accessible, quel que soit votre secteur, et le premier mois est remboursé si cela ne vous convient pas.\n\n` +
        `Si vous avez cinq minutes, j’aimerais beaucoup en discuter avec vous par téléphone au <strong>${tracking.tel}</strong>. Vous pouvez aussi écouter un exemple et tester directement sur <strong>${tracking.site}</strong>, sans engagement.\n\n` +
        `À très vite,\n` +
        `Mouad de Qalm`;

    const fullPrompt =
      `Tu écris une lettre B2B courte, en français, déposée physiquement dans la boîte aux lettres d'une entreprise. Tu es Mouad, tu proposes un assistant vocal qui répond au téléphone à la place du professionnel quand il ne peut pas décrocher.\n` +
      `RÈGLE ABSOLUE DE TON : cette lettre ne doit JAMAIS donner l'impression d'avoir été écrite ou générée par une IA, ni ressembler à un mail commercial. Elle doit sonner comme un message personnel, direct et authentique envoyé par un professionnel du coin à un autre dirigeant.\n\n` +
      `DONNÉES DU PROSPECT :\n\n` +
      `${donneesProspectBlock}\n\n` +
      `TEMPLATE DE LETTRE DE RÉFÉRENCE ("GOLD STANDARD") À REPRENDRE STRICTEMENT :\n` +
      `==============================================================\n` +
      `${goldTemplateReference}\n` +
      `==============================================================\n\n` +
      `CONSIGNES STRICTES DE PERSONNALISATION & ANTI-HALLUCINATION :\n` +
      `1. SALUTATION (PRÉNOM) : Tu DOIS commencer la lettre EXACTEMENT par "${salutationAttendue}". ${prenomExtrait ? `Le prénom officiel "${prenomExtrait}" a été vérifié, utilise STRICTEMENT ce prénom dans la salutation ("${salutationAttendue}").` : `Le prénom étant incertain ou absent, tu DOIS écrire STRICTEMENT "${salutationAttendue}" sans deviner ni inventer de prénom.`}\n` +
      `2. STRICTE CONSERVATION DE LA STRUCTURE (EXACTEMENT 5 PARAGRAPHES) & PERSONNALISATION CHIRURGICALE :\n` +
      `   - La lettre générée DOIT comporter EXACTEMENT 5 paragraphes distincts (en plus de la salutation et de la signature), ni un de plus, ni un de moins. TU NE DOIS JAMAIS couper un paragraphe en deux ni en ajouter un nouveau.\n` +
      `   - Tu reprends STRICTEMENT les 5 paragraphes du TEMPLATE DE RÉFÉRENCE ci-dessus. Ta SEULE personnalisation consiste à adapter subtilement le paragraphe 1 (ancrage dans la ville ${villeExtraite} et le métier de ${metierPropre}${isPlainteVariant ? ", avec mention tactique et bienveillante de l'avis client sur la joignabilité sans jamais le recopier mot pour mot" : " via la phrase 'quand vous êtes pris sur un chantier/en consultation...'"}).\n` +
      `   - L'INTÉGRALITÉ des paragraphes 2, 3, 4 et 5 doivent être recopiés MOT POUR MOT sans la moindre reformulation ni ajout de phrase.\n` +
      `3. AUCUNE HALLUCINATION : Ne prends AUCUNE décision qui pourrait faire perdre de la crédibilité à la lettre. N'invente JAMAIS de faux chiffres d'affaires, ni de fausses informations.\n` +
      `4. FIDÉLITÉ DES BLOCS DE RASSURANCE : Les paragraphes sur le fonctionnement technique, l'installation en 5 jours et l'appel à l'échange final avec le numéro (${tracking.tel}) et le site (${tracking.site}) doivent rester rigoureusement fidèles au modèle ci-dessus.\n` +
      `5. INTERDITS STRICTS : Aucun point d'exclamation (!). Aucun mot interdit (révolutionnaire, innovant, solution, optimiser, disruptif, gamechanger, IA, intelligence artificielle, révolutionner, propulser). Signature : exactement "Mouad de Qalm".\n\n` +
      `Génère la lettre personnalisée maintenant. Réponds UNIQUEMENT par le texte exact de la lettre, prêt à être imprimé, sans aucun commentaire ni markdown autour.`;

    try {
      const modelsToTry = [
        process.env.ANTHROPIC_MODEL,
        "claude-sonnet-4-5",
        "claude-haiku-4-5"
      ].filter(Boolean) as string[];

      let response: any = null;
      let lastErr: any = null;

      for (const modelId of modelsToTry) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            response = await client.messages.create({
              model: modelId,
              max_tokens: 1024,
              temperature: params.temperature,
              messages: [{ role: "user", content: fullPrompt }],
            });
            break; // Succès avec ce modèle
          } catch (err: any) {
            lastErr = err;
            if ((err?.status === 429 || err?.status === 529 || err?.message?.includes("rate_limit")) && attempt < 3) {
              const delayMs = attempt * 1500;
              console.warn(`  ⏳ [Retry ${attempt}/3] API surchargée/rate-limit (${err?.status}), attente ${delayMs}ms...`);
              await new Promise((res) => setTimeout(res, delayMs));
              continue;
            }
            if (err?.status === 404 || err?.message?.includes("not_found_error")) {
              break; // Tenter le modèle suivant
            }
            throw err;
          }
        }
        if (response) break;
      }

      if (!response && lastErr) {
        throw lastErr;
      }

      totalLettersGenerated++;
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      const block = response.content[0];
      const letterText = block && block.type === "text" ? block.text.trim() : "";

      // VÉRIFICATION QUALITÉ AUTOMATIQUE RENFORCÉE
      const failReasons: string[] = [];

      // 1. Présence du téléphone et du site web tracking (stricte)
      if (!letterText.includes(tracking.tel)) {
        failReasons.push("téléphone contact tracking absent");
      }
      if (!letterText.toLowerCase().includes(tracking.site.toLowerCase())) {
        failReasons.push("site web tracking absent");
      }

      // 2. Présence de point d'exclamation ou mots interdits (stricte)
      if (letterText.includes("!")) {
        failReasons.push("présence de point d'exclamation (!)");
      }

      const foundForbidden = FORBIDDEN_WORDS.filter((w) =>
        new RegExp(`\\b${w}\\b`, "i").test(letterText)
      );
      if (/\bIA\b/i.test(letterText) || /\bI\.A\.\b/i.test(letterText)) {
        foundForbidden.push("IA");
      }
      if (foundForbidden.length > 0) {
        failReasons.push(`mots interdits utilisés (${foundForbidden.join(", ")})`);
      }

      // 3. Vérification des 5 paragraphes du corps (hors salutation et signature)
      const bodyForCheck = letterText
        .replace(/^Bonjour[^\n]*\n+/i, "")
        .replace(/\n+À très vite,?\s*\n*Mouad\s+de\s+Qalm(AI)?\s*$/i, "")
        .replace(/\n+Mouad\s+de\s+Qalm(AI)?\s*$/i, "")
        .trim();
      const bodyParagraphs = bodyForCheck.split(/\n\s*\n+/).map((p: string) => p.trim()).filter(Boolean);
      if (bodyParagraphs.length !== 5) {
        failReasons.push(`Le corps de la lettre ne contient pas exactement 5 paragraphes (détectés: ${bodyParagraphs.length})`);
      }

      // 4. Vérification de la variante plainte : le verbatim brut (15+ chars) NE DOIT PAS apparaître
      if (isPlainteVariant && row.citation_plainte_telephone) {
        const citClean = row.citation_plainte_telephone.trim();
        let hasRawVerbatim = false;
        if (citClean.length >= 15) {
          for (let j = 0; j <= citClean.length - 15; j++) {
            const sub = citClean.slice(j, j + 15);
            if (letterText.toLowerCase().includes(sub.toLowerCase())) {
              hasRawVerbatim = true;
              break;
            }
          }
        } else if (citClean.length > 5 && letterText.toLowerCase().includes(citClean.toLowerCase())) {
          hasRawVerbatim = true;
        }
        if (hasRawVerbatim) {
          failReasons.push("verbatim brut de la plainte client détecté mot pour mot dans la lettre");
        }
      }

      // 5. Vérification que la liste brute de mots-clés secteur n'apparaît pas
      const rawSecteur = (row.secteur || "").trim();
      if (rawSecteur && (rawSecteur.includes(",") || rawSecteur.length > 15)) {
        if (letterText.toLowerCase().includes(rawSecteur.toLowerCase())) {
          failReasons.push(`liste brute de mots-clés secteur "${rawSecteur}" détectée dans la lettre`);
        }
      }

      // 6. Mention du transfert humain (alerte non stricte)
      const hasTransfer = TRANSFER_KEYWORDS.some((kw) =>
        letterText.toLowerCase().includes(kw)
      );
      if (!hasTransfer) {
        console.warn(`  ⚠️  [Alerte non stricte] Mention du transfert humain non détectée dans les mots-clés.`);
      }

      const verificationOk = failReasons.length === 0 ? "oui" : "non";
      if (verificationOk === "non") {
        console.warn(`  ❌ Échec vérification stricte : ${failReasons.join(" ; ")}`);
      } else {
        console.log(`  ✨ Vérification qualité OK (${isPlainteVariant ? "Variante Plainte" : "Variante Standard"}, 5 paragraphes)`);
      }

      // Sauvegarde du fichier texte brut (.txt)
      const letterTextClean = letterText.replace(/<\/?strong>/gi, "");
      fs.writeFileSync(filePathTxt, letterTextClean, "utf-8");

      // Nettoyage et injection dans le template HTML (.html)
      const bodyClean = letterText
        .replace(/={10,}/g, "")
        .replace(/\r?\n*À très vite,?\s*\r?\n*Mouad\s+de\s+Qalm(AI)?\s*$/i, "")
        .replace(/\r?\n*Mouad\s+de\s+Qalm(AI)?\s*$/i, "")
        .trim();

      const paragraphs = bodyClean
        .split(/\r?\n\r?\n+/)
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0);

      const paragraphsHtml = paragraphs
        .map((p: string) => {
          const formatted = p
            .replace(/07(?:\s|&nbsp;)56(?:\s|&nbsp;)91(?:\s|&nbsp;)75(?:\s|&nbsp;)69/g, '<strong><span style="white-space:nowrap">07&nbsp;56&nbsp;91&nbsp;75&nbsp;69</span></strong>')
            .replace(/QalmAI\.fr/gi, '<strong><span style="white-space:nowrap">QalmAI.fr</span></strong>');
          return `<p>${formatted}</p>`;
        })
        .join("\n\n      ");

      const prenomOuDirection = isDirigeantFiable && row.nom_dirigeant && row.nom_dirigeant.trim().length >= 2
        ? row.nom_dirigeant.trim()
        : "La Direction";

      const addressParts = extractAddressParts(row.adresse || "", row.ville || "");
      const objetLettre = `Objet : Gestion de vos appels au quotidien`;

      const htmlOutput = templateHtmlMaster
        .replace(/\{\{NOM_ENTREPRISE_PROSPECT\}\}/g, nomEntreprise)
        .replace(/\{\{PRENOM_OU_DIRIGEANT_OU_DIRECTION\}\}/g, prenomOuDirection)
        .replace(/\{\{ADRESSE_RUE_PROSPECT\}\}/g, addressParts.rue)
        .replace(/\{\{CODE_POSTAL_ET_VILLE_PROSPECT\}\}/g, addressParts.cpVille || villeExtraite)
        .replace(/\{\{OBJET_LETTRE\}\}/g, objetLettre)
        .replace(/\{\{LETTER_BODY_PARAGRAPHS\}\}/g, paragraphsHtml);

      fs.writeFileSync(filePathHtml, htmlOutput, "utf-8");

      if (params.generatePdf && chromeExe) {
        try {
          console.log(`  🖨️  Génération du PDF pour "${nomEntreprise}"...`);
          const chromeCmd = `"${chromeExe}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${filePathPdf}" "${filePathHtml}"`;
          execSync(chromeCmd, { stdio: "pipe" });
        } catch (pdfErr: any) {
          console.warn(`  ⚠️  Échec de la génération PDF : ${pdfErr.message}`);
        }
      }

      // Calcul de la longueur en lignes
      const longueurLignes = letterText.split(/\r?\n/).filter((l: string) => l.trim().length > 0).length;

      recapRecords.push({
        nom_entreprise: nomEntreprise,
        ville_extraite: villeExtraite,
        secteur: metierPropre,
        grappe: row.grappe || "",
        tracking_utilise: tracking.used,
        angle_utilise: angleUtilise,
        longueur_lettre: longueurLignes,
        verification_ok: verificationOk,
        chemin_fichier_lettre: filePathTxt,
        chemin_fichier_html: filePathHtml,
        chemin_fichier_pdf: filePathPdf || "Non généré (utilisez --pdf=true ou npm run generate-pdfs)",
      });

      if (verificationOk === "non") {
        aVerifierRecords.push({
          nom_entreprise: nomEntreprise,
          siren: row.siren || "",
          motif_echec: failReasons.join(" ; "),
          chemin_fichier_lettre: filePathTxt,
          chemin_fichier_html: filePathHtml,
        });
      }
    } catch (err: any) {
      console.error(`  ❌ Erreur API Claude pour "${nomEntreprise}": ${err.message}`);
    }
  }

  // Écriture du CSV Récapitulatif
  const recapPath = path.join(lettresDir, "recap_lettres.csv");
  const recapHeaders = [
    "nom_entreprise",
    "ville_extraite",
    "secteur",
    "grappe",
    "tracking_utilise",
    "angle_utilise",
    "longueur_lettre",
    "verification_ok",
    "chemin_fichier_lettre",
    "chemin_fichier_html",
    "chemin_fichier_pdf",
  ];
  const recapLines = [
    recapHeaders.join(","),
    ...recapRecords.map((r) =>
      recapHeaders
        .map((h) => {
          const val = String((r as any)[h] ?? "");
          return /[",\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
        })
        .join(",")
    ),
  ];
  fs.writeFileSync(recapPath, "\uFEFF" + recapLines.join("\n"), "utf-8");
  console.log(`\n📄 CSV Récapitulatif généré : ${recapPath}`);

  // Écriture du CSV A Vérifier (si erreurs strictes)
  const aVerifierPath = path.join(lettresDir, "a_verifier.csv");
  const aVerifierHeaders = ["nom_entreprise", "siren", "motif_echec", "chemin_fichier_lettre", "chemin_fichier_html"];
  const aVerifierLines = [
    aVerifierHeaders.join(","),
    ...aVerifierRecords.map((r) =>
      aVerifierHeaders
        .map((h) => {
          const val = String((r as any)[h] ?? "");
          return /[",\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
        })
        .join(",")
    ),
  ];
  fs.writeFileSync(aVerifierPath, "\uFEFF" + aVerifierLines.join("\n"), "utf-8");
  if (aVerifierRecords.length > 0) {
    console.warn(`⚠️  ${aVerifierRecords.length} lettre(s) à vérifier manuellement (voir ${aVerifierPath})`);
  } else {
    console.log(`🎉 100% des lettres ont réussi la vérification stricte (${aVerifierPath} créé vide).`);
  }

  // Calcul et log du coût total (Prix indicatifs Claude 3.5 Sonnet : 3 $ / M in, 15 $ / M out)
  const costIn = (totalInputTokens / 1_000_000) * 3.0;
  const costOut = (totalOutputTokens / 1_000_000) * 15.0;
  const costTotal = costIn + costOut;

  const logCoutText = [
    `=== BILAN DE GÉNÉRATION QALM-LETTER ===`,
    `Date : ${new Date().toISOString()}`,
    `Fichier traité : ${params.inputPath}`,
    `Lettres générées : ${totalLettersGenerated}`,
    `Lettres conformes (strict) : ${totalLettersGenerated - aVerifierRecords.length}`,
    `Lettres à vérifier : ${aVerifierRecords.length}`,
    `Tokens en entrée (Input) : ${totalInputTokens} (~${costIn.toFixed(4)} $)`,
    `Tokens en sortie (Output) : ${totalOutputTokens} (~${costOut.toFixed(4)} $)`,
    `COÛT TOTAL ESTIMÉ : ~${costTotal.toFixed(4)} $`,
  ].join("\n");

  const logCoutPath = path.join(lettresDir, "log_cout.txt");
  fs.writeFileSync(logCoutPath, logCoutText, "utf-8");

  console.log(`\n======================================================`);
  console.log(logCoutText);
  console.log(`======================================================`);
  console.log(`✅ Dossier de sortie : ${lettresDir}`);
}

main().catch((err) => {
  console.error("Erreur fatale lors de la génération des lettres :", err);
  process.exit(1);
});
