const { createRequire } = require("node:module");
const { JWT } = require("google-auth-library");
const { docs_v1 } = createRequire(require.resolve("googleapis"))("googleapis/build/src/apis/docs/v1.js");
const { drive_v3 } = createRequire(require.resolve("googleapis"))("googleapis/build/src/apis/drive/v3.js");
const dotenv = require("dotenv");
dotenv.config();

const key = require(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

(async () => {
  const auth = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.readonly"
    ]
  });
  
  console.log("Service account:", key.client_email);
  
  // List all docs visible to this service account
  const drive = new drive_v3.Drive({ auth });
  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.document' and trashed=false",
    pageSize: 50,
    fields: "files(id,name,modifiedTime,permissions)"
  });
  
  const files = res.data.files || [];
  console.log("\n=== Drive API found", files.length, "docs ===");
  
  const docs = new docs_v1.Docs({ auth });
  
  for (const f of files) {
    console.log("\n---", f.name, "(" + f.id.slice(0, 12) + "...)");
    try {
      const docRes = await docs.documents.get({ documentId: f.id });
      const content = (docRes.data.body?.content || []);
      const anchors = content
        .filter(c => c.paragraph)
        .map(c => (c.paragraph.elements || []).map(e => e.textRun?.content || "").join("").trim())
        .filter(t => t.includes("DOCWALLET") || t.includes("ANCHOR"));
      console.log("  ✅ Can read. Elements:", content.length, "Anchors found:", anchors.length);
      if (anchors.length > 0) console.log("  Anchors:", anchors.slice(0, 5));
    } catch (e) {
      console.log("  ❌ Error:", e.message);
    }
  }
})().catch(e => console.error("FATAL:", e.message));
