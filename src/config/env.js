require("dotenv").config();

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  mongodbUri: process.env.MONGODB_URI,
  secretKey: process.env.SECRET_KEY,
  cronSecret: process.env.CRON_SECRET,
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  brevo: {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.EMAIL,
    senderName: "Linkaro",
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "dhqlxau24",
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Prefer the base64 form (FIREBASE_PRIVATE_KEY_BASE64) — some hosting
    // dashboards (Render included) mangle the multi-line PEM string's "\n"
    // escapes when pasted into their env var UI, which breaks OpenSSL's
    // parser with a cryptic "DECODER routines::unsupported" error. Base64
    // has no special characters for any UI to corrupt. Falls back to the
    // escaped-"\n" form for local .env convenience.
    privateKey: process.env.FIREBASE_PRIVATE_KEY_BASE64
      ? Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, "base64").toString(
          "utf8"
        )
      : process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        : undefined,
  },
};
