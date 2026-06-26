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
    // Env vars can't hold real newlines, so the .env value uses literal
    // "\n" sequences — un-escape them back into a real PEM string here.
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined,
  },
};
