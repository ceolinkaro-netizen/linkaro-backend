const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const {
  startConversation,
  getConversations,
  getMyOpenJobs,
  getMessages,
  sendMessage,
  discardConversation,
} = require("../../controllers/mobile/chat.controller");

const router = express.Router();

router.post("/start", verifyMobileToken, startConversation);
router.get("/conversations", verifyMobileToken, getConversations);
router.get("/my-open-jobs", verifyMobileToken, getMyOpenJobs);
router.get("/messages/:conversationId", verifyMobileToken, getMessages);
router.post("/messages", verifyMobileToken, sendMessage);
router.delete("/conversations/:id", verifyMobileToken, discardConversation);

module.exports = router;
