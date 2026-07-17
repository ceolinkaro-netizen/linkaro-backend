const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const env = require("../config/env");
const { sendEmail, otpEmail } = require("../lib/mailer");

const ROLE_ROUTES = {
  admin: "/admin/dashboard",
  "user manager": "/admin/user-management",
  "ticket manager": "/ticket-management",
};

async function login(req, res) {
  const { email, password, category } = req.body;

  if (!email || !password || !category) {
    return res.status(400).json({ message: "Email, password and category are required" });
  }

  if (!ROLE_ROUTES[category]) {
    return res.status(400).json({ message: "Invalid category selected" });
  }

  try {
    const db = await getDb();

    const user = await db.collection("users").findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isHashed = /^\$2[aby]\$/.test(user.password);
    const passwordMatch = isHashed
      ? await bcrypt.compare(password, user.password)
      : password === user.password;

    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (user.role !== category) {
      return res.status(403).json({ message: "You don't have access to this role" });
    }

    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role, name: user.name || null },
      env.secretKey,
      { expiresIn: "7d" },
    );

    // In production the dashboard (Vercel) and this API (Render) are on
    // different domains, so the cookie must be SameSite=None (which itself
    // requires Secure) to be sent on cross-site fetch calls at all. Locally
    // both run on "localhost" (just different ports), where Lax is fine and
    // Secure would block the cookie over plain http.
    const isProduction = env.nodeEnv === "production";
    const sameSite = isProduction ? "None" : "Lax";
    res.setHeader(
      "Set-Cookie",
      `token=${token}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=${sameSite}${isProduction ? "; Secure" : ""}`,
    );

    const redirectTo = ROLE_ROUTES[user.role] || "/admin/dashboard";
    return res.status(200).json({ success: true, role: user.role, redirectTo, token });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function sendOtp(req, res) {
  const { email, password, category } = req.body;

  if (!email || !password || !category) {
    return res.status(400).json({ message: "Email, password and category are required" });
  }

  if (!ROLE_ROUTES[category]) {
    return res.status(400).json({ message: "Invalid category selected" });
  }

  try {
    const db = await getDb();
    const user = await db.collection("users").findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isHashed = /^\$2[aby]\$/.test(user.password);
    const passwordMatch = isHashed
      ? await bcrypt.compare(password, user.password)
      : password === user.password;

    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (user.role !== category) {
      return res.status(403).json({ message: "You don't have access to this role" });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));

    await sendEmail({
      to: user.email,
      subject: "Your Linkaro login code",
      html: otpEmail(otp),
      text: `Your Linkaro login verification code is: ${otp}. It expires in 10 minutes.`,
    });

    return res.status(200).json({ success: true, otp });
  } catch (error) {
    console.error("Send OTP error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

function logout(req, res) {
  const isProduction = env.nodeEnv === "production";
  const sameSite = isProduction ? "None" : "Lax";
  res.setHeader(
    "Set-Cookie",
    `token=; HttpOnly; Path=/; Max-Age=0; SameSite=${sameSite}${isProduction ? "; Secure" : ""}`,
  );
  return res.status(200).json({ success: true });
}

async function me(req, res) {
  try {
    const db = await getDb();
    const user = await db.collection("users").findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { name: 1, email: 1, role: 1, profileImage: 1 } }
    );
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    return res.status(200).json({
      success: true,
      role: user.role,
      email: user.email,
      name: user.name || null,
      profileImage: user.profileImage || null,
    });
  } catch (error) {
    console.error("Me error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { login, sendOtp, logout, me };
