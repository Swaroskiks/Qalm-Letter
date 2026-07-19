import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { findChromePath } from "./chrome";

const exDir = path.join(process.cwd(), "lettres/exemples");
fs.mkdirSync(exDir, { recursive: true });

const templateHtmlMaster = fs.readFileSync(
  path.join(process.cwd(), "templates/template_lettre.html"),
  "utf-8"
);

const exemples = [
  {
    slug: "exemple_1_standard_carrosserie",
    nomEntreprise: "Carrosserie Moderne Val d'Europe",
    prenomOuDirigeant: "Marc Dupont",
    rue: "12 rue de la Prudence",
    cpVille: "77700 Serris",
    objet: "Objet : Gestion de vos appels au quotidien",
    paragraphs: [
      "Bonjour Marc,",
      "Vous devez régulièrement être coupé par des appels quand vous êtes en atelier sur un véhicule à Serris, ou au contraire en manquer après la fermeture. Dans les deux cas, ça peut vite coûter un client. L’idée est simple : aucun client ne doit être laissé sans réponse, même quand vous êtes indisponible. Et chaque appel bien pris peut devenir un nouveau client.",
      "Je vous écris directement, par lettre, parce que je pense que ce sujet mérite un échange plus personnel. Je travaille avec Qalm et je suis à l’origine d’un assistant vocal qui décroche à votre place au quotidien. Il permet d’éviter les appels perdus, d’alléger votre secrétariat, de garantir une réponse rapide même en dehors de vos horaires, et de transformer chaque appel en opportunité commerciale.",
      "L’assistant est configuré avec vos propres informations : il répond aux questions avec une voix naturelle, que vous pouvez adapter (ton, rythme, style de réponse), prend les rendez-vous ou note les messages. Et dès qu’une demande nécessite une intervention directe, l’appel est transféré sur votre portable. Vous gardez 100% de la main.",
      "La mise en place prend cinq jours : deux points rapides sont prévus pour cadrer vos besoins, puis tout est pris en charge. Le tarif est pensé pour rester accessible, quel que soit votre secteur, et le premier mois est remboursé si cela ne vous convient pas.",
      "Si vous avez cinq minutes, j’aimerais beaucoup en discuter avec vous par téléphone au <strong>07 56 91 75 69</strong>. Vous pouvez aussi écouter un exemple et tester directement sur <strong>QalmAI.fr</strong>, sans engagement."
    ]
  },
  {
    slug: "exemple_2_plainte_institut",
    nomEntreprise: "Cabinet Esthétique & SPA",
    prenomOuDirigeant: "La Direction",
    rue: "4 avenue du Bien-Être",
    cpVille: "93160 Noisy-le-Grand",
    objet: "Objet : Gestion de vos appels au quotidien",
    paragraphs: [
      "Bonjour,",
      "En me renseignant sur les instituts de beauté à Noisy-le-Grand, je suis tombé sur un avis d'un de vos clients qui regrettait de ne pas avoir réussi à vous joindre par téléphone pour une réservation. Ce n'est sûrement pas un cas isolé : quand on est pris en soin, on ne peut pas décrocher, et chaque appel manqué peut coûter un client.",
      "Je vous écris directement, par lettre, parce que je pense que ce sujet mérite un échange plus personnel. Je travaille avec Qalm et je suis à l’origine d’un assistant vocal qui décroche à votre place au quotidien. Il permet d’éviter les appels perdus, d’alléger votre secrétariat, de garantir une réponse rapide même en dehors de vos horaires, et de transformer chaque appel en opportunité commerciale.",
      "L’assistant est configuré avec vos propres informations : il répond aux questions avec une voix naturelle, que vous pouvez adapter (ton, rythme, style de réponse), prend les rendez-vous ou note les messages. Et dès qu’une demande nécessite une intervention directe, l’appel est transféré sur votre portable. Vous gardez 100% de la main.",
      "La mise en place prend cinq jours : deux points rapides sont prévus pour cadrer vos besoins, puis tout est pris en charge. Le tarif est pensé pour rester accessible, quel que soit votre secteur, et le premier mois est remboursé si cela ne vous convient pas.",
      "Si vous avez cinq minutes, j’aimerais beaucoup en discuter avec vous par téléphone au <strong>07 56 91 75 69</strong>. Vous pouvez aussi écouter un exemple et tester directement sur <strong>QalmAI.fr</strong>, sans engagement."
    ]
  },
  {
    slug: "exemple_3_filtre_compliment_rooftop",
    nomEntreprise: "Le Rooftop Lounge",
    prenomOuDirigeant: "La Direction",
    rue: "8 cours du Danube",
    cpVille: "77700 Chessy",
    objet: "Objet : Gestion de vos appels au quotidien",
    paragraphs: [
      "Bonjour,",
      "Vous devez régulièrement être coupé par des appels quand vous êtes en plein service dans votre restaurant à Chessy, ou au contraire en manquer après la fermeture. Dans les deux cas, ça peut vite coûter un client. L’idée est simple : aucun client ne doit être laissé sans réponse, même quand vous êtes indisponible. Et chaque appel bien pris peut devenir un nouveau client.",
      "Je vous écris directement, par lettre, parce que je pense que ce sujet mérite un échange plus personnel. Je travaille avec Qalm et je suis à l’origine d’un assistant vocal qui décroche à votre place au quotidien. Il permet d’éviter les appels perdus, d’alléger votre secrétariat, de garantir une réponse rapide même en dehors de vos horaires, et de transformer chaque appel en opportunité commerciale.",
      "L’assistant est configuré avec vos propres informations : il répond aux questions avec une voix naturelle, que vous pouvez adapter (ton, rythme, style de réponse), prend les rendez-vous ou note les messages. Et dès qu’une demande nécessite une intervention directe, l’appel est transféré sur votre portable. Vous gardez 100% de la main.",
      "La mise en place prend cinq jours : deux points rapides sont prévus pour cadrer vos besoins, puis tout est pris en charge. Le tarif est pensé pour rester accessible, quel que soit votre secteur, et le premier mois est remboursé si cela ne vous convient pas.",
      "Si vous avez cinq minutes, j’aimerais beaucoup en discuter avec vous par téléphone au <strong>07 56 91 75 69</strong>. Vous pouvez aussi écouter un exemple et tester directement sur <strong>QalmAI.fr</strong>, sans engagement."
    ]
  }
];

let chromeExe = "";
try {
  chromeExe = findChromePath();
  console.log(`🖨️ Chrome portable détecté : ${chromeExe}\n`);
} catch (e: any) {
  console.error(e.message);
  process.exit(1);
}

for (const ex of exemples) {
  const paragraphsHtml = ex.paragraphs.map((p) => `<p>${p}</p>`).join("\n\n      ");
  const htmlContent = templateHtmlMaster
    .replace(/\{\{NOM_ENTREPRISE_PROSPECT\}\}/g, ex.nomEntreprise)
    .replace(/\{\{PRENOM_OU_DIRIGEANT_OU_DIRECTION\}\}/g, ex.prenomOuDirigeant)
    .replace(/\{\{ADRESSE_RUE_PROSPECT\}\}/g, ex.rue)
    .replace(/\{\{CODE_POSTAL_ET_VILLE_PROSPECT\}\}/g, ex.cpVille)
    .replace(/\{\{OBJET_LETTRE\}\}/g, ex.objet)
    .replace(/\{\{LETTER_BODY_PARAGRAPHS\}\}/g, paragraphsHtml);

  const htmlPath = path.join(exDir, `${ex.slug}.html`);
  const pdfPath = path.join(exDir, `${ex.slug}.pdf`);

  fs.writeFileSync(htmlPath, htmlContent, "utf-8");
  console.log(`📝 HTML créé : ${htmlPath}`);

  try {
    const chromeCmd = `"${chromeExe}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" "${htmlPath}"`;
    execSync(chromeCmd, { stdio: "pipe" });
    console.log(`✅ PDF généré avec succès : ${pdfPath}\n`);
  } catch (err: any) {
    console.error(`❌ Erreur lors de la génération PDF de ${ex.slug} : ${err.message}`);
  }
}

console.log(`🎉 Les 3 exemples PDF sont disponibles dans : ${exDir}`);
