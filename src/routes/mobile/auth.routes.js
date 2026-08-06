const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const {
  checkAvailability,
  login,
  providerLogin,
  resetPassword,
  sendOtp,
  sendOtpV2,
  verifyOtp,
  signupConsumer,
  signupProvider,
  switchRole,
  webLogin,
  webProviderLogin,
  webLogout,
  getSocketToken,
} = require("../../controllers/mobile/auth.controller");

const router = express.Router();

router.post("/check-availability", checkAvailability);
router.post("/login", login);
router.post("/provider-login", providerLogin);
router.post("/reset-password", resetPassword);
router.post("/send-otp", sendOtp);
router.post("/send-otp-v2", sendOtpV2);
router.post("/verify-otp", verifyOtp);
router.post("/signup/consumer", signupConsumer);
router.post("/signup/provider", signupProvider);
router.post("/switch-role", verifyMobileToken, switchRole);

// Web-app-only endpoints — cookie-based, never return token in body
router.post("/web-login", webLogin);
router.post("/web-provider-login", webProviderLogin);
router.post("/web-logout", webLogout);
router.get("/socket-token", verifyMobileToken, getSocketToken);

module.exports = router;
