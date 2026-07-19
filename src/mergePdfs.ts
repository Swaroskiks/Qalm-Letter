import * as fs from "fs";
import * as path from "path";
import { PDFDocument } from "pdf-lib";

async function mergePdfs(): Promise<void> {
  const lettresDir = path.join(process.cwd(), "lettres");
  const pdfDir = path.join(lettresDir, "pdf");

  if (!fs.existsSync(pdfDir)) {
    console.error(`❌ Erreur : le dossier "${pdfDir}" n'existe pas.`);
    console.error(`Générez d'abord les PDF avec "npm run generate-pdfs" ou "--pdf=true".`);
    process.exit(1);
  }

  // Lister les fichiers PDF dans lettres/pdf en excluant un éventuel fichier fusionné
  const files = fs
    .readdirSync(pdfDir)
    .filter((f) => f.endsWith(".pdf") && !f.startsWith("lettres_fusionnees") && !f.includes("_fusion"))
    .sort();

  if (files.length === 0) {
    console.log(`ℹ️ Aucun fichier PDF à fusionner trouvé dans "${pdfDir}".`);
    return;
  }

  console.log(`\n======================================================`);
  console.log(`📑  FUSION DES PDF POUR IMPRESSION (${files.length} fichiers)`);
  console.log(`======================================================\n`);

  const mergedPdf = await PDFDocument.create();
  let totalPages = 0;

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];
    const filePath = path.join(pdfDir, fileName);

    process.stdout.write(`[${i + 1}/${files.length}] Ajout de : ${fileName} ... `);

    try {
      const pdfBytes = fs.readFileSync(filePath);
      const pdf = await PDFDocument.load(pdfBytes);
      const pageIndices = pdf.getPageIndices();
      const copiedPages = await mergedPdf.copyPages(pdf, pageIndices);

      for (const page of copiedPages) {
        mergedPdf.addPage(page);
        totalPages++;
      }
      console.log(`✅ OK (${pageIndices.length} page(s))`);
    } catch (err: any) {
      console.log(`❌ ÉCHEC`);
      console.error(`   Erreur lors de l'ajout de ${fileName}: ${err.message}`);
    }
  }

  if (totalPages === 0) {
    console.error(`\n❌ Erreur : Aucune page n'a pu être fusionnée.`);
    process.exit(1);
  }

  const outputPath = path.join(lettresDir, "lettres_fusionnees_pour_impression.pdf");
  const mergedBytes = await mergedPdf.save();
  fs.writeFileSync(outputPath, mergedBytes);

  console.log(`\n======================================================`);
  console.log(`🎉 FUSION TERMINÉE AVEC SUCCÈS !`);
  console.log(`📑 Total de pages dans le document : ${totalPages}`);
  console.log(`🖨️  Fichier prêt à être imprimé en une seule fois :`);
  console.log(`👉 ${outputPath}`);
  console.log(`======================================================\n`);
}

mergePdfs().catch((err) => {
  console.error("Erreur fatale lors de la fusion des PDF :", err);
  process.exit(1);
});
