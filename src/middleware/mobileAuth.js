const jwt = require("jsonwebtoken");
const env = require("../config/env");

// Web app sends JWT as an HttpOnly cookie (web_token).
// Mobile app sends it in the request body (POST) or query string (GET).
function verifyMobileToken(req, res, next) {
  const token = req.cookies?.web_token || req.body?.token || req.query?.token;

  if (!token) {
    return res.status(400).json({ message: "Token is required" });
  }

  try {
    req.decoded = jwt.verify(token, env.secretKey);
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

module.exports = { verifyMobileToken };
