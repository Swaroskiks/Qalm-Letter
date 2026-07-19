import fs from "fs";
import path from "path";

/**
 * Script de post-traitement pour toutes les lettres HTML :
 * 1. Rend le numéro de téléphone et QalmAI.fr en GRAS + INSÉCABLES dans le corps du texte.
 * 2. Ajoute le P.S. sous le bloc signature si absent.
 */
function main() {
  const dir = path.join(process.cwd(), "lettres");
  if (!fs.existsSync(dir)) {
    console.error("❌ Dossier lettres/ introuvable.");
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html") && !f.includes("feuille_de_route"));
  let fixed = 0;

  console.log(`🔍 Traitement de ${files.length} fichiers HTML dans lettres/ ...`);

  for (const f of files) {
    const p = path.join(dir, f);
    let html = fs.readFileSync(p, "utf-8");
    const before = html;

    // 1. Numéro et QalmAI.fr en GRAS et insécables dans <div class="letter-body">
    html = html.replace(/<div class="letter-body">([\s\S]*?)<\/div>/, (match, body) => {
      let newBody = body
        // Normalisation d'abord (suppression d'anciens strong ou span nowrap pour éviter la duplication)
        .replace(/<(?:strong|b)>\s*(?:<span[^>]*>)?\s*07(?:\s|&nbsp;)56(?:\s|&nbsp;)91(?:\s|&nbsp;)75(?:\s|&nbsp;)69\s*(?:<\/span>)?\s*<\/(?:strong|b)>/gi, "07 56 91 75 69")
        .replace(/(?:<span[^>]*>)\s*07(?:\s|&nbsp;)56(?:\s|&nbsp;)91(?:\s|&nbsp;)75(?:\s|&nbsp;)69\s*(?:<\/span>)/gi, "07 56 91 75 69")
        .replace(/<(?:strong|b)>\s*(?:<span[^>]*>)?\s*QalmAI\.fr\s*(?:<\/span>)?\s*<\/(?:strong|b)>/gi, "QalmAI.fr")
        .replace(/(?:<span[^>]*>)\s*QalmAI\.fr\s*(?:<\/span>)/gi, "QalmAI.fr")
        // Application propre et uniforme de strong + span nowrap
        .replace(/07(?:\s|&nbsp;)56(?:\s|&nbsp;)91(?:\s|&nbsp;)75(?:\s|&nbsp;)69/g, '<strong><span style="white-space:nowrap">07&nbsp;56&nbsp;91&nbsp;75&nbsp;69</span></strong>')
        .replace(/QalmAI\.fr/gi, '<strong><span style="white-space:nowrap">QalmAI.fr</span></strong>');
      return `<div class="letter-body">${newBody}</div>`;
    });

    // 2. P.S. sous la signature
    if (!html.includes("P.S. Vous pouvez appeler")) {
      html = html.replace(
        /(<span class="signature-name">Mouad de Qalm(?:AI)?<\/span>\s*<\/div>)/i,
        `$1\n    <div style="margin-top:6mm;font-size:10.5pt;font-style:italic">P.S. Vous pouvez appeler à n'importe quelle heure, même un dimanche soir : vous aurez toujours quelqu'un au bout du fil.</div>`
      );
    }

    if (html !== before) {
      fs.writeFileSync(p, html, "utf-8");
      fixed++;
    }
  }

  console.log(`✅ ${fixed}/${files.length} lettres HTML ont été corrigées avec succès (gras + insécables + P.S.) !`);
}

main();
