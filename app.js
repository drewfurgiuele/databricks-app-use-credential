// Minimal Databricks App: on startup, use a Unity Catalog service credential
// (backed by an Azure managed identity / service principal) to obtain a
// temporary Microsoft Entra ID (Azure AD) access token.
//
// Environment variables (set in app.yaml):
//   UC_CREDENTIAL_NAME   Name of the Unity Catalog service credential
//   UC_AZURE_RESOURCES   Comma-separated Azure resource(s)/audience(s) for the token.
//                        Defaults to https://management.azure.com/.default
// Injected automatically by Databricks Apps:
//   DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, DATABRICKS_APP_PORT

const http = require("http");

const CREDENTIAL_NAME = process.env.UC_CREDENTIAL_NAME;
const DEFAULT_AZURE_RESOURCE = "https://management.azure.com/.default";
const AZURE_RESOURCES = (process.env.UC_AZURE_RESOURCES || DEFAULT_AZURE_RESOURCE)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PORT = process.env.DATABRICKS_APP_PORT || 8000;

function workspaceUrl() {
  const host = process.env.DATABRICKS_HOST || "";
  if (!host) throw new Error("DATABRICKS_HOST is not set");
  return (host.startsWith("http") ? host : `https://${host}`).replace(/\/$/, "");
}

// Get an OAuth token for the app's service principal (M2M client credentials).
async function getDatabricksToken() {
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET are not set");
  }
  const res = await fetch(`${workspaceUrl()}/oidc/v1/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" }),
  });
  if (!res.ok) throw new Error(`OAuth token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// Exchange the UC service credential for a temporary cloud credential.
async function getServiceCredentialToken() {
  if (!CREDENTIAL_NAME) throw new Error("UC_CREDENTIAL_NAME is not set");

  const body = {
    credential_name: CREDENTIAL_NAME,
    azure_options: { resources: AZURE_RESOURCES },
  };

  const token = await getDatabricksToken();
  const res = await fetch(`${workspaceUrl()}/api/2.1/unity-catalog/temporary-service-credentials`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Temporary credential request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Summarize the credential without exposing secrets.
function describe(cred) {
  const mask = (v) => (v ? `${v.slice(0, 6)}...(${v.length} chars)` : null);
  const token = cred.azure_aad && cred.azure_aad.aad_token;
  if (!token) throw new Error("Response did not contain an Azure AD token (azure_aad.aad_token)");
  return {
    credential_name: CREDENTIAL_NAME,
    azure_resources: AZURE_RESOURCES,
    token: mask(token),
    expires_at: cred.expiration_time ? new Date(cred.expiration_time).toISOString() : null,
  };
}

let status = { state: "starting" };

async function main() {
  try {
    const cred = await getServiceCredentialToken();
    status = { state: "ok", ...describe(cred) };
    console.log("Obtained temporary credential:", status);
  } catch (err) {
    status = { state: "error", error: err.message };
    console.error("Failed to obtain temporary credential:", err.message);
  }
}

// Databricks Apps expects the app to listen on DATABRICKS_APP_PORT.
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status, null, 2));
  })
  .listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
    main();
  });
