const jwt = require("jsonwebtoken");
const env = require("../config/env");

// Mobile endpoints accept the JWT as `token` in the body (POST) or query string (GET),
// matching the mobile app's existing request contract.
function verifyMobileToken(req, res, next) {
  const token = req.body?.token || req.query?.token;

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
