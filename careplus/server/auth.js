const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "careplus-medi-bridge-secret-change-me";
const TOKEN_TTL = "7d";

function signToken(user) {
  return jwt.sign(
    { role: user.role, id: user.ref_id || user.id, name: user.name, username: user.username },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(role) {
  return function (req, res, next) {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden: " + role + " role required" });
    }
    return next();
  };
}

module.exports = { signToken, verifyToken, requireAuth, requireRole };
