const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const {
  listNotifications,
  getUnreadCount,
} = require("../../controllers/mobile/notification.controller");

const router = express.Router();

router.get("/", verifyMobileToken, listNotifications);
router.get("/unread-count", verifyMobileToken, getUnreadCount);

module.exports = router;
