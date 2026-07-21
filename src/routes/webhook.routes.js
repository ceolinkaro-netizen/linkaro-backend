const express = require("express");
const { googlePlayWebhook } = require("../controllers/webhook.controller");

const router = express.Router();

router.post("/google-play", googlePlayWebhook);

module.exports = router;
