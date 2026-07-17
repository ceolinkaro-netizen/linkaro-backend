const jwt = require("jsonwebtoken");
const env = require("../config/env");

function requireAdminAuth(req, res, next) {
  // Accept token from Authorization header (Bearer) or cookie
  let token = req.cookies?.token;
  if (!token) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) token = auth.slice(7);
  }

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
