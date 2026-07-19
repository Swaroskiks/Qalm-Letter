import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { findChromePath } from "./chrome";

async function runBatchPdf(): Promise<void> {
  const lettresDir = path.join(process.cwd(), "lettres");
  if (!fs.existsSync(lettresDir)) {
    console.error(`❌ Erreur : le dossier "lettres" n'existe pas. Générez d'abord les lettres.`);
    process.exit(1);
  }

  let chromeExe = "";
  try {
    chromeExe = findChromePath();
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  const pdfDir = path.join(lettresDir, "pdf");
  fs.mkdirSync(pdfDir, { recursive: true });

  const files = fs.readdirSync(lettresDir).filter((f) => f.endsWith(".html"));
  if (files.length === 0) {
    console.log(`ℹ️ Aucun fichier HTML trouvé dans "lettres".`);
    return;
  }

  console.log(`\n======================================================`);
  console.log(`🖨️  CONVERSION PAR LOTS HTML -> PDF (${files.length} fichiers) via ${chromeExe}`);
  console.log(`======================================================\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    const fileHtml = files[i];
    const filePathHtml = path.join(lettresDir, fileHtml);
    const filePdf = fileHtml.replace(/\.html$/, ".pdf");
    const filePathPdf = path.join(pdfDir, filePdf);

    process.stdout.write(`[${i + 1}/${files.length}] Conversion : ${fileHtml} -> ${filePdf} ... `);

    try {
      const chromeCmd = `"${chromeExe}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${filePathPdf}" "${filePathHtml}"`;
      execSync(chromeCmd, { stdio: "pipe" });
      console.log("✅ OK");
      successCount++;
    } catch (err: any) {
      console.log("❌ ÉCHEC");
      console.error(`   Erreur: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n======================================================`);
  console.log(`🎉 Fin de la conversion par lots.`);
  console.log(`✅ Réussis : ${successCount} / ${files.length}`);
  if (failCount > 0) {
    console.warn(`❌ Échecs : ${failCount}`);
  }
  console.log(`======================================================\n`);
}

runBatchPdf().catch((err) => {
  console.error("Erreur fatale de conversion par lots :", err);
  process.exit(1);
});
