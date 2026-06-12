require("dotenv").config();

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  mongodbUri: process.env.MONGODB_URI,
  secretKey: process.env.SECRET_KEY,
  cronSecret: process.env.CRON_SECRET,
  brevo: {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.EMAIL,
    senderName: "Linkaro",
  },
};
