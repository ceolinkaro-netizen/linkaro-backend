const express = require("express");
const { requireAdminAuth } = require("../middleware/adminAuth");
const { login, sendOtp, verifyLoginOtp, logout, me, forgotSendOtp, forgotVerifyOtp, forgotResetPassword } = require("../controllers/auth.controller");

const router = express.Router();

router.post("/login", login);
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyLoginOtp);
router.post("/logout", logout);
router.get("/me", requireAdminAuth, me);
router.post("/forgot-send-otp", forgotSendOtp);
router.post("/forgot-verify-otp", forgotVerifyOtp);
router.post("/forgot-reset", forgotResetPassword);

module.exports = router;
