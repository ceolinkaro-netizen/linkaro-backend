const jwt = require("jsonwebtoken");
const env = require("../config/env");

const ADMIN_ROLES = ["admin", "user manager", "ticket manager"];

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
    if (!ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

module.exports = { requireAdminAuth };
