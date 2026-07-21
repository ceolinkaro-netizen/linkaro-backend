const express = require("express");
const authRoutes = require("./auth.routes");
const adminRoutes = require("./admin.routes");
const mobileRoutes = require("./mobile");
const webhookRoutes = require("./webhook.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/admin", adminRoutes);
router.use("/mobile", mobileRoutes);
router.use("/webhooks", webhookRoutes);

module.exports = router;
