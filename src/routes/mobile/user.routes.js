const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const {
  me,
  profileImage,
  subscription,
  updateBadgeSubscription,
  updateProfile,
  updateSubscription,
} = require("../../controllers/mobile/user.controller");

const router = express.Router();

router.get("/me", verifyMobileToken, me);
// profile-image performs its own token verification (it cross-checks the `id` query param)
router.get("/profile-image", profileImage);
router.post("/subscription", verifyMobileToken, subscription);
router.post("/update-badge-subscription", verifyMobileToken, updateBadgeSubscription);
router.post("/update-profile", verifyMobileToken, updateProfile);
router.post("/update-subscription", verifyMobileToken, updateSubscription);

module.exports = router;
