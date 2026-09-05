// api/generate.js
// Backend Meridian : direction artistique -> développeur -> critique, via l'API Gemini.
// La clé Gemini est lue depuis les Environment Variables de Vercel (jamais dans ce fichier).

const SUPABASE_URL = "https://muynltisznfgxpuspmku.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11eW5sdGlzem5mZ3hwdXNwbWt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NjI4NDUsImV4cCI6MjEwNDEzODg0NX0.3z5xN12sPDeyzP_0gh_hvfnasMojD8Opjs-IPSVPJGo";
const BUCKET = "meridian-images";

// Modèle Gemini utilisé. Si ce modèle n'est plus disponible sur ton compte,
// va sur aistudio.google.com -> Playground -> Get code pour voir un nom de modèle valide,
// et remplace la valeur ci-dessous.
const GEMINI_MODEL = "gemini-3.6-flash";

const MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function extensionOf(filename) {
  const parts = filename.split(".");
  return parts[parts.length - 1].toLowerCase();
}

// Récupère la liste des fichiers du bucket Supabase
async function listBucketFiles() {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix: "",
        limit: 100,
        sortBy: { column: "name", order: "asc" },
      }),
    }
  );
  if (!res.ok) {
    throw new Error("Impossible de lister le bucket Supabase (" + res.status + ")");
  }
  const files = await res.json();
  return files.filter((f) => f.name && MIME_BY_EXT[extensionOf(f.name)]);
}

// Télécharge une image publique Supabase et la convertit en base64
async function fetchImageAsBase64(filename) {
  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(
    filename
  )}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return {
    mimeType: MIME_BY_EXT[extensionOf(filename)],
    data: base64,
  };
}

// Appelle l'API Gemini avec un system prompt et des parts (texte + éventuellement images)
async function callGemini(systemPrompt, parts) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY manquante dans les Environment Variables Vercel");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts }],
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Erreur Gemini (" + res.status + ") : " + errText.slice(0, 300));
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n");
  if (!text) throw new Error("Réponse Gemini vide ou inattendue");
  return text;
}

function extractHTML(text) {
  return text.replace(/```html|```/g, "").trim();
}

// Liste anti-clichés IA — vide pour l'instant, à remplir par le user avec ce qu'il veut exclure
const ANTI_CLICHE = "";

const ART_DIRECTION_SYSTEM = `Tu es un directeur artistique.

Tu reçois des images de référence. Étudie-les attentivement : couleurs, matières, lumière, composition, hiérarchie typographique, ambiance générale. Ta direction artistique doit se baser uniquement sur ce que montrent ces images — n'introduis aucun style, référence ou vocabulaire esthétique qui n'en soit pas directement issu.

À partir du secteur d'activité et du nom de marque donnés, écris une direction artistique précise et actionnable pour un développeur :
- palette de couleurs (4 à 6 couleurs nommées, en hex, prélevées ou déduites des images)
- typographies (2 familles maximum, avec leurs rôles)
- concept de layout (structure des sections, alignement, hiérarchie)
- principes directeurs (ce qui rend ce site unique pour CE secteur précis, pas générique)

Adapte cette direction artistique au secteur donné (une écurie équestre n'a pas les mêmes besoins visuels qu'une marque de montres, même en gardant l'esprit des images). Réponds en texte structuré, clair, directement utilisable par un développeur. Pas de code ici.

${ANTI_CLICHE}`;

const DEVELOPER_SYSTEM = `Tu es un développeur front-end senior spécialisé en sites one-page ultra soignés (niveau Awwwards).
On te donne un brief client (secteur, nom de marque) et une direction artistique déjà validée. Ton travail : écrire le code.

Contraintes strictes :
- Un seul fichier HTML autonome (CSS et JS inclus dans le fichier, balises <style> et <script>)
- HTML/CSS/JS vanilla uniquement, aucune dépendance externe sauf polices Google Fonts si besoin (via <link>)
- Site one-page, responsive (mobile inclus), accessible (focus visible, contrastes corrects)
- Respecte scrupuleusement la direction artistique fournie (couleurs, typographies, layout, principes)
- Utilise du vrai contenu rédigé (titres, textes, labels) cohérent avec le secteur et la marque, jamais de texte placeholder
- Une seule animation ou moment d'entrée soigné plutôt que des effets partout
- N'ajoute jamais de bandeau cookies, de faux formulaire de paiement, ni de lien vers des pages qui n'existent pas

${ANTI_CLICHE}

Réponds UNIQUEMENT avec le code HTML complet, sans explication, sans markdown, en commençant directement par <!DOCTYPE html>.`;

const CRITIQUE_SYSTEM = `Tu es un directeur de création senior qui relit le travail d'un développeur junior avant livraison client.
On te donne le code HTML d'un site "Luxe tech" ainsi que la direction artistique qu'il devait suivre.

Vérifie point par point :
- Le code respecte-t-il fidèlement la direction artistique (couleurs, typographies, layout) ?
- Le contenu est-il spécifique au secteur et à la marque, sans texte générique ?
- Le site évite-t-il les clichés de sites générés par IA (voir liste ci-dessous) ?
- Le HTML est-il valide, responsive, accessible ?

${ANTI_CLICHE}

Si des corrections sont nécessaires, réécris le code HTML complet corrigé.
Si le code est déjà conforme, renvoie-le tel quel, inchangé.

Réponds UNIQUEMENT avec le code HTML complet final, sans explication, sans markdown, en commençant directement par <!DOCTYPE html>.`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  try {
    const { sector, brandName } = req.body || {};
    if (!sector || !brandName) {
      res.status(400).json({ error: "Secteur et nom de marque requis" });
      return;
    }

    const briefText = `Secteur d'activité : ${sector}\nNom de la marque : ${brandName}`;

    // 1. Récupérer les images de référence Luxe tech depuis Supabase — obligatoire
    const files = await listBucketFiles();
    if (files.length === 0) {
      throw new Error("Aucune image trouvée dans le bucket Supabase — génération bloquée");
    }
    const images = await Promise.all(files.map((f) => fetchImageAsBase64(f.name)));
    const imageParts = images
      .filter(Boolean)
      .map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } }));
    if (imageParts.length === 0) {
      throw new Error("Les images n'ont pas pu être téléchargées depuis Supabase — génération bloquée");
    }

    // 2. Agent direction artistique (texte + images de référence)
    const artDirectionParts = [...imageParts, { text: briefText }];
    const artDirection = await callGemini(ART_DIRECTION_SYSTEM, artDirectionParts);

    // 3. Agent développeur (texte seul)
    const devInput = `${briefText}\n\n--- DIRECTION ARTISTIQUE VALIDÉE ---\n${artDirection}`;
    let code = await callGemini(DEVELOPER_SYSTEM, [{ text: devInput }]);
    code = extractHTML(code);

    // 4. Agent critique (relit et corrige si besoin)
    const critiqueInput = `--- DIRECTION ARTISTIQUE ---\n${artDirection}\n\n--- CODE À RELIRE ---\n${code}`;
    let finalCode = await callGemini(CRITIQUE_SYSTEM, [{ text: critiqueInput }]);
    finalCode = extractHTML(finalCode);

    res.status(200).json({ code: finalCode || code, imageCount: imageParts.length });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur inconnue" });
  }
};
