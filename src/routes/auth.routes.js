const express = require("express");
const { requireAdminAuth } = require("../middleware/adminAuth");
const { login, logout, me } = require("../controllers/auth.controller");

const router = express.Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/me", requireAdminAuth, me);

module.exports = router;
