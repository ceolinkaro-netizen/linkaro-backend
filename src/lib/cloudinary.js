const crypto = require("crypto");
const env = require("../config/env");

// Extracts the Cloudinary public_id (including folder, excluding version
// and extension) from a secure_url, e.g.
// "https://res.cloudinary.com/<cloud>/image/upload/v1700000000/folder/abc123.jpg"
// -> "folder/abc123"
function extractPublicId(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
  return match ? match[1] : null;
}

// Deletes a single Cloudinary asset by its secure_url. Never throws —
// failures (including missing credentials) are logged and swallowed so a
// cleanup miss never breaks the request that triggered it.
async function deleteFromCloudinary(url, resourceType = "image") {
  const { cloudName, apiKey, apiSecret } = env.cloudinary;
  if (!apiKey || !apiSecret) {
    console.warn(
      "Cloudinary API credentials not configured; skipping image cleanup"
    );
    return;
  }

  const publicId = extractPublicId(url);
  if (!publicId) return;

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHash("sha1")
      .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
      .digest("hex");

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          public_id: publicId,
          timestamp: String(timestamp),
          api_key: apiKey,
          signature,
        }),
      }
    );
    const data = await res.json();
    if (data.result !== "ok" && data.result !== "not found") {
      console.error("Cloudinary delete failed:", publicId, data);
    }
  } catch (error) {
    console.error("Cloudinary delete error:", publicId, error);
  }
}

// Deletes a batch of asset URLs, ignoring duplicates/empties. Each deletion
// is independent — one failure doesn't stop the others.
async function deleteManyFromCloudinary(urls, resourceType = "image") {
  const unique = [...new Set((urls || []).filter(Boolean))];
  await Promise.all(
    unique.map((url) => deleteFromCloudinary(url, resourceType))
  );
}

// Uploads a base64 data URI (or remote URL) to Cloudinary via a signed
// request and returns the resulting secure_url.
async function uploadToCloudinary(file, folder = "uploads") {
  const { cloudName, apiKey, apiSecret } = env.cloudinary;
  if (!apiKey || !apiSecret) {
    throw new Error("Cloudinary API credentials not configured");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash("sha1")
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest("hex");

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        file,
        folder,
        timestamp: String(timestamp),
        api_key: apiKey,
        signature,
      }),
    }
  );

  const data = await res.json();
  if (!data.secure_url) {
    throw new Error(data.error?.message || "Cloudinary upload failed");
  }
  return data.secure_url;
}

module.exports = {
  extractPublicId,
  deleteFromCloudinary,
  deleteManyFromCloudinary,
  uploadToCloudinary,
};
