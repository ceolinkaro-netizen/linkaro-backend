const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const {
  listNotifications,
} = require("../../controllers/mobile/notification.controller");

const router = express.Router();

router.get("/", verifyMobileToken, listNotifications);

module.exports = router;
