const express = require("express");
const {
  checkAvailability,
  login,
  providerLogin,
  resetPassword,
  sendOtp,
  signupConsumer,
  signupProvider,
} = require("../../controllers/mobile/auth.controller");

const router = express.Router();

router.post("/check-availability", checkAvailability);
router.post("/login", login);
router.post("/provider-login", providerLogin);
router.post("/reset-password", resetPassword);
router.post("/send-otp", sendOtp);
router.post("/signup/consumer", signupConsumer);
router.post("/signup/provider", signupProvider);

module.exports = router;
