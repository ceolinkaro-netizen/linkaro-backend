const jwt = require("jsonwebtoken");
const env = require("../config/env");

function requireAdminAuth(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    req.user = jwt.verify(token, env.secretKey);
    return next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

module.exports = { requireAdminAuth };
