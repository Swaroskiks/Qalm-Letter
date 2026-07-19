# Qalm-Letter ✉️

> **Pipeline de génération de lettres de prospection AFNOR hyper-personnalisées, conversion PDF par lots via Chrome Headless et calcul d'itinéraires mobiles de distribution sur 5 jours.**

Ce module transforme votre liste de prospects qualifiés (issue de `Qalm-Prospects`) en un dispositif de publipostage physique de précision : lettres aux normes postales françaises AFNOR DL avec fenêtre, paragraphes IA contextualisés, et application mobile de tournée terrain (`Route Book`).

---

## 🛠️ Installation & Configuration

```bash
npm install
```

Créez un fichier `.env` à la racine (ou copiez depuis `.env.example`) en spécifiant votre clé API Anthropic pour la génération dynamique des paragraphes :
```env
ANTHROPIC_API_KEY="sk-ant-api03-..."
```

---

## 🚀 Workflow en 4 Étapes

### 1. Génération des Textes & Templates HTML
Générez les lettres pour votre fichier source (ex: `qalm_500_lettres.csv`) avec option de reprise automatique (`--resume=true`) en cas de coupure réseau ou de limite de crédits :
```bash
npm run generate-letters -- --input=./qalm_500_lettres.csv --resume=true
```

### 2. Post-Traitement & Typographie de Précision
Appliquez le formatage de précision sur 100% des fichiers HTML générés (`lettres/*.html`) en 1 seconde :
```bash
npm run post-process:html
```
👉 **Ce que fait ce script :**
- Met en **gras et en espace insécable (`white-space:nowrap`)** le numéro de téléphone (`07 56 91 75 69`) et l'URL (`QalmAI.fr`) dans le dernier paragraphe pour maximiser la conversion.
- Injecte la formule de post-scriptum (`P.S. — ...`) sous la signature.

### 3. Conversion par lots HTML -> PDF via Chrome Headless
Convertissez vos lettres HTML en fichiers PDF individuels haute qualité dans le dossier `lettres/pdf/` :
```bash
npm run generate-pdfs
```

### 4. Livret de Route Mobile (`Route Book`) & Fusion Géographique par Jour
Calculez l'itinéraire géographique optimal de distribution à pied ou en voiture depuis **Champs-sur-Marne** sur 5 jours :
```bash
npm run route-book
npm run merge-route-book
```

---

## 📍 Le Livret de Route Mobile (`Route Book`)

Le script `npm run route-book` analyse chaque adresse, supprime toute hallucination GPS et génère deux outils majeurs dans le dossier `lettres/` :

1. 📱 **`feuille_de_route_mobile.html` (Application Mobile Terrain Interactive) :**
   - Ouvrez simplement ce fichier HTML dans **Safari** ou **Chrome** sur votre smartphone !
   - Affiche les 5 journées classées dans l'ordre du trajet le plus court depuis Champs-sur-Marne.
   - Boutons cliquables **🧭 Google Maps** et **🚗 Waze** pour chaque prospect.
   - Case à cocher **"Distribué"** avec mémorisation locale (`localStorage`) et barre de progression 0 à 100%.

2. 📊 **`feuille_de_route_5_jours.csv` (Tableau de Bord CSV) :**
   - Récapitulatif complet sur 500 lignes avec colonnes : `Jour`, `Label_Jour`, `Nom_Entreprise`, `Adresse_Verifiee_GPS`, `Commune`, `Code_Postal`, `Dirigeant`, `Telephone`, et liens directs Google Maps / Waze.

---

## 📑 Impression Triée par Jour (`impression_par_jour/`)

Quand vous lancez `npm run merge-route-book` (ou `npm run merge-pdfs`), le script regroupe vos PDF individuels dans l'ordre de passage géographique du Route Book :

📁 **Dossier généré : `lettres/impression_par_jour/`**
- `Jour_1_Val_Maubuee_et_Ouest.pdf` *(110 lettres triées dans l'ordre exact du trajet)*
- `Jour_2_Pole_Tertiaire_Bussy_Ferrieres.pdf` *(111 lettres)*
- `Jour_3_Coeur_Urbain_Lagny_Thorigny.pdf` *(110 lettres)*
- `Jour_4_Boucle_Nord_Claye_Montevrain.pdf` *(90 lettres)*
- `Jour_5_Val_d_Europe_Serris_Chessy.pdf` *(79 lettres)*
- `00_TOUTES_LES_500_LETTRES_ORDRE_ROUTE_BOOK.pdf` *(Master PDF de 500 pages trié par ordre géographique)*

💡 **Avantage sur le terrain :** En sortant de l'imprimante, la feuille sur le dessus de votre pile `Jour_1.pdf` correspond à la 1ère étape sur votre application mobile `feuille_de_route_mobile.html`. Zéro tri manuel !

---

## 🎨 Normes Postales & Template (`templates/template_lettre.html`)

Le fichier maître `templates/template_lettre.html` respecte strictement la norme postale française **AFNOR DL avec fenêtre** :
- **Bloc Adresse Destinataire :** Aligné pour tomber parfaitement dans la fenêtre transparente d'une enveloppe format DL ($110 \times 220\text{ mm}$).
- **En-tête Qalm :** Logo, coordonnées de l'émetteur (`Mouad de Qalm — 117 Avenue du Général Leclerc, 77400 Lagny-sur-Marne`), et date formatée en toutes lettres.
- **Corps en 5 Paragraphes :** Accroche personnalisée avec note Google, constatation du Pain Point téléphonique, solution Qalm AI, preuve sociale / appel à l'action en gras, et P.S. de réassurance.
