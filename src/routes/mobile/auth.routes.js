const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const {
  checkAvailability,
  login,
  providerLogin,
  resetPassword,
  sendOtp,
  signupConsumer,
  signupProvider,
  switchRole,
} = require("../../controllers/mobile/auth.controller");

const router = express.Router();

router.post("/check-availability", checkAvailability);
router.post("/login", login);
router.post("/provider-login", providerLogin);
router.post("/reset-password", resetPassword);
router.post("/send-otp", sendOtp);
router.post("/signup/consumer", signupConsumer);
router.post("/signup/provider", signupProvider);
router.post("/switch-role", verifyMobileToken, switchRole);

module.exports = router;
