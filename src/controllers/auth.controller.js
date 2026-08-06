const crypto = require("crypto");
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
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
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
    return res.status(200).json({ success: true, role: user.role, redirectTo });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function sendOtp(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
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

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.collection("otps").deleteMany({ email: user.email, purpose: "login" });
    await db.collection("otps").insertOne({ email: user.email, code, purpose: "login", expiresAt });

    await sendEmail({
      to: user.email,
      subject: "Your Linkaro login code",
      html: otpEmail(code),
      text: `Your Linkaro login verification code is: ${code}. It expires in 10 minutes.`,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Send OTP error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function verifyLoginOtp(req, res) {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: "Email and code are required" });

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const db = await getDb();
    const record = await db.collection("otps").findOne({ email: normalizedEmail, purpose: "login" });

    if (!record || new Date() > record.expiresAt) {
      if (record) await db.collection("otps").deleteOne({ _id: record._id });
      return res.status(400).json({ message: "Invalid or expired code. Please request a new one." });
    }

    if (record.code !== code) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    await db.collection("otps").deleteOne({ _id: record._id });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Verify OTP error:", error);
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

async function forgotSendOtp(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  try {
    const db = await getDb();
    const user = await db.collection("users").findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ message: "No account found with this email" });

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.collection("otps").deleteMany({ email: user.email, purpose: "forgot-password-admin" });
    await db.collection("otps").insertOne({ email: user.email, code, purpose: "forgot-password-admin", expiresAt });

    await sendEmail({
      to: user.email,
      subject: "Reset your Linkaro password",
      html: otpEmail(code),
      text: `Your Linkaro password reset code is: ${code}. It expires in 10 minutes.`,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Forgot send OTP error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function forgotVerifyOtp(req, res) {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: "Email and code are required" });

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const db = await getDb();
    const record = await db.collection("otps").findOne({ email: normalizedEmail, purpose: "forgot-password-admin" });

    if (!record || new Date() > record.expiresAt) {
      if (record) await db.collection("otps").deleteOne({ _id: record._id });
      return res.status(400).json({ message: "Invalid or expired code. Please request a new one." });
    }

    if (record.code !== code) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    await db.collection("otps").deleteOne({ _id: record._id });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Forgot verify OTP error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function forgotResetPassword(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
  if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

  try {
    const db = await getDb();
    const user = await db.collection("users").findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ message: "User not found" });

    const hashed = await bcrypt.hash(password, 10);
    await db.collection("users").updateOne(
      { email: email.toLowerCase().trim() },
      { $set: { password: hashed } }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Forgot reset error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { login, sendOtp, verifyLoginOtp, logout, me, forgotSendOtp, forgotVerifyOtp, forgotResetPassword };
