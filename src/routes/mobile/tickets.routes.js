const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const { myTickets, postTicket } = require("../../controllers/mobile/tickets.controller");

const router = express.Router();

router.get("/my-tickets", verifyMobileToken, myTickets);
router.post("/post-ticket", verifyMobileToken, postTicket);

module.exports = router;
