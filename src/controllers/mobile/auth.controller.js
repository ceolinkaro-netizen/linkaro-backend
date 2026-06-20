const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { ObjectId } = require("mongodb");
const { getDb } = require("../../config/db");
const env = require("../../config/env");
const { sendEmail, otpEmail } = require("../../lib/mailer");
const { VALID_GENDERS, VALID_CATEGORIES } = require("../../constants/categories");

const VALID_ROLES = ["consumer", "provider"];
const EMAIL_REGEX = /^[\w\-.]+@([\w-]+\.)+[\w-]{2,}$/;

async function checkAvailability(req, res) {
  const { email, cnic, phone, role } = req.body;

  if (!email || !cnic || !role) {
    return res.status(400).json({ message: "Email, CNIC and role are required" });
  }

  try {
    const db = await getDb();

    const existingEmail = await db
      .collection("users")
      .findOne({ email: email.toLowerCase().trim(), role });
    if (existingEmail) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const existingCnic = await db
      .collection("users")
      .findOne({ cnic, role });
    if (existingCnic) {
      return res.status(409).json({ message: "CNIC is already registered" });
    }

    if (phone) {
      const existingPhone = await db
        .collection("users")
        .findOne({ phone: `+92${phone}`, role });
      if (existingPhone) {
        return res.status(409).json({ message: "Phone number is already registered" });
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Check availability error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function login(req, res) {
  const { email, password, role } = req.body;

  if (!email || !password || !role) {
    return res.status(400).json({ message: "Email, password and role are required" });
  }

  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ message: "Invalid role. Must be 'consumer' or 'provider'" });
  }

  try {
    const db = await getDb();

    const user = await db
      .collection("users")
      .findOne({ email: email.toLowerCase().trim(), role: role });

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

    if (user.role !== role) {
      return res.status(403).json({ message: "You don't have access with this role" });
    }

    // Provider whose registration hasn't been approved yet
    if (role === "provider" && user.registrationStatus === false) {
      return res.status(200).json({ success: false, registrationPending: true });
    }

    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role },
      env.secretKey,
      { expiresIn: "30d" },
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage || null,
      },
    });
  } catch (error) {
    console.error("Mobile login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function providerLogin(req, res) {
  const { email, name, profileImage, provider, providerId, role } = req.body;

  if (!email || !provider || !providerId) {
    return res.status(400).json({ message: "Email, provider and providerId are required" });
  }

  try {
    const db = await getDb();

    const normalizedEmail = email.toLowerCase().trim();

    // Look up by email + role so the same email can hold separate consumer/provider accounts
    let user = await db
      .collection("users")
      .findOne({ email: normalizedEmail, role });

    // ── User does not exist → tell the app to redirect to signup ─────────────
    if (!user) {
      return res.status(200).json({ success: false, newUser: true });
    }

    // ── Registration pending check ────────────────────────────────────────────
    if (user.role === "provider" && user.registrationStatus === false) {
      return res.status(200).json({ success: false, registrationPending: true });
    }

    // ── Return token ──────────────────────────────────────────────────────────
    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role },
      env.secretKey,
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        name: user.name,
        email: user.email,
        profileImage: user.profileImage,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Social login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function resetPassword(req, res) {
  const { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  if (!role) {
    return res.status(400).json({ message: "Role is required" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  try {
    const db = await getDb();

    const query = { email: email.toLowerCase().trim(), role };

    const user = await db.collection("users").findOne(query);

    if (!user) {
      return res.status(404).json({ message: "No account found with this email and role" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.collection("users").updateOne(
      query,
      { $set: { password: hashedPassword } }
    );

    return res.status(200).json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function sendOtp(req, res) {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ message: "Email and code are required" });
  }

  try {
    await sendEmail({
      to: email,
      subject: "Your Verification Code",
      html: otpEmail(code),
    });

    return res.status(200).json({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("Send OTP error:", error);
    return res.status(500).json({ message: "Failed to send email" });
  }
}

async function signupConsumer(req, res) {
  const { fullName, phone, email, cnic, password, profileImage } = req.body;

  if (!fullName || !phone || !email || !cnic || !password) {
    return res.status(400).json({ message: "Full name, phone, email, CNIC and password are required" });
  }

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: "Invalid email address" });
  }

  if (String(phone).length !== 10) {
    return res.status(400).json({ message: "Phone must be 10 digits (without +92)" });
  }

  if (String(cnic).length !== 13) {
    return res.status(400).json({ message: "CNIC must be 13 digits" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  if (!profileImage) {
    return res.status(400).json({ message: "Profile photo is required" });
  }

  try {
    const db = await getDb();

    const existing = await db
      .collection("users")
      .findOne({ email: email.toLowerCase().trim(), role: "consumer" });
    if (existing) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const existingCnic = await db
      .collection("users")
      .findOne({ cnic, role: "consumer" });
    if (existingCnic) {
      return res.status(409).json({ message: "CNIC is already registered" });
    }

    const existingPhone = await db
      .collection("users")
      .findOne({ phone: `+92${phone}`, role: "consumer" });
    if (existingPhone) {
      return res.status(409).json({ message: "Phone number is already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.collection("users").insertOne({
      name: fullName,
      phone: `+92${phone}`,
      email: email.toLowerCase().trim(),
      cnic,
      password: hashedPassword,
      role: "consumer",
      profileImage,
      totalJobs: 0,
      createdAt: new Date(),
    });

    return res.status(201).json({ success: true, message: "Account created successfully" });
  } catch (error) {
    console.error("Consumer signup error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function signupProvider(req, res) {
  const {
    name,
    phone,
    email,
    street,
    city,
    cnic,
    zip,
    password,
    gender,
    category,
    about,
    latitude,
    longitude,
    profileImage,
    cnicFrontImage,
    cnicBackImage,
  } = req.body;

  // Required field check
  if (
    !name ||
    !phone ||
    !email ||
    !street ||
    !city ||
    !cnic ||
    !zip ||
    !password ||
    !gender ||
    !category
  ) {
    return res.status(400).json({ message: "All fields are required" });
  }

  // Validation
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: "Invalid email address" });
  }

  if (String(phone).length !== 10) {
    return res.status(400).json({ message: "Phone must be 10 digits (without +92)" });
  }

  if (String(cnic).length !== 13) {
    return res.status(400).json({ message: "CNIC must be 13 digits" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  if (!VALID_GENDERS.includes(gender)) {
    return res.status(400).json({ message: "Gender must be Male or Female" });
  }

  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ message: "Invalid category" });
  }

  if (!profileImage || !cnicFrontImage || !cnicBackImage) {
    return res.status(400).json({
      message: "Profile photo, CNIC front and back images are required",
    });
  }

  try {
    const db = await getDb();

    const existing = await db
      .collection("users")
      .findOne({ email: email.toLowerCase().trim(), role: "provider" });
    if (existing) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const existingCnic = await db
      .collection("users")
      .findOne({ cnic, role: "provider" });
    if (existingCnic) {
      return res.status(409).json({ message: "CNIC is already registered" });
    }

    const existingPhone = await db
      .collection("users")
      .findOne({ phone: `+92${phone}`, role: "provider" });
    if (existingPhone) {
      return res.status(409).json({ message: "Phone number is already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userDoc = {
      name,
      phone: `+92${phone}`,
      email: email.toLowerCase().trim(),
      address: { street, city, zip },
      cnic,
      gender,
      category,
      about: typeof about === "string" ? about.trim() : "",
      password: hashedPassword,
      role: "provider",
      profileImage,
      totalJobs: 0,
      cnicFrontImage,
      cnicBackImage,
      subscriptionStatus: "inactive",
      badgeSubscriptionStatus: "inactive",
      registrationStatus: false,
      createdAt: new Date(),
    };

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      userDoc.latitude = lat;
      userDoc.longitude = lng;
      userDoc.geo = { type: "Point", coordinates: [lng, lat] };
    }

    await db.collection("users").insertOne(userDoc);

    return res.status(201).json({ success: true, message: "Account created. Pending approval." });
  } catch (error) {
    console.error("Provider signup error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// Switches the signed-in user to their other-role account (consumer <->
// provider), matched by CNIC — both signup flows require it, and a single
// person is allowed one account per role. No password re-entry: the
// caller is already authenticated as the same real person.
async function switchRole(req, res) {
  try {
    const db = await getDb();

    const currentUser = await db
      .collection("users")
      .findOne({ _id: new ObjectId(req.decoded.id) });

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const targetRole = currentUser.role === "consumer" ? "provider" : "consumer";

    const targetUser = await db
      .collection("users")
      .findOne({ cnic: currentUser.cnic, role: targetRole });

    if (!targetUser) {
      return res.status(404).json({
        message: `You don't have a ${targetRole} account to switch to.`,
      });
    }

    if (targetRole === "provider" && targetUser.registrationStatus === false) {
      return res.status(200).json({ success: false, registrationPending: true });
    }

    const token = jwt.sign(
      { id: targetUser._id.toString(), email: targetUser.email, role: targetUser.role },
      env.secretKey,
      { expiresIn: "30d" },
    );

    return res.status(200).json({ success: true, token, role: targetUser.role });
  } catch (error) {
    console.error("Switch role error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  checkAvailability,
  login,
  providerLogin,
  resetPassword,
  sendOtp,
  signupConsumer,
  signupProvider,
  switchRole,
};
