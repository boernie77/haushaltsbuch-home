const router = require("express").Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Issuer, generators } = require("openid-client");
const { User, Household, HouseholdMember, sequelize } = require("../models");
const { seedSystemCategories } = require("../utils/seedCategories");

let _clientPromise;
function getClient() {
  if (!_clientPromise) {
    if (
      !(
        process.env.OIDC_ISSUER_URL &&
        process.env.OIDC_CLIENT_ID &&
        process.env.OIDC_CLIENT_SECRET
      )
    ) {
      return Promise.reject(
        new Error(
          "OIDC nicht konfiguriert (OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET fehlt)"
        )
      );
    }
    _clientPromise = (async () => {
      const issuer = await Issuer.discover(process.env.OIDC_ISSUER_URL);
      const appUrl = process.env.APP_URL || "http://localhost:8080";
      return new issuer.Client({
        client_id: process.env.OIDC_CLIENT_ID,
        client_secret: process.env.OIDC_CLIENT_SECRET,
        redirect_uris: [`${appUrl}/api/auth/oidc/callback`],
        response_types: ["code"],
      });
    })().catch((err) => {
      _clientPromise = null;
      throw err;
    });
  }
  return _clientPromise;
}

// In-Memory-State-Map: state -> { nonce, code_verifier, created }
const pendingStates = new Map();
const STATE_TTL_MS = 5 * 60 * 1000;

function gcStates() {
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (now - v.created > STATE_TTL_MS) {
      pendingStates.delete(k);
    }
  }
}

// GET /api/auth/oidc/login — kicks off the OIDC dance
router.get("/login", async (req, res) => {
  try {
    const client = await getClient();
    const state = generators.state();
    const nonce = generators.nonce();
    const code_verifier = generators.codeVerifier();
    const code_challenge = generators.codeChallenge(code_verifier);

    pendingStates.set(state, { nonce, code_verifier, created: Date.now() });
    gcStates();

    const url = client.authorizationUrl({
      scope: "openid email profile",
      state,
      nonce,
      code_challenge,
      code_challenge_method: "S256",
    });
    res.redirect(url);
  } catch (err) {
    console.error("[oidc] /login error:", err.message);
    res.status(500).json({ error: `OIDC login start failed: ${err.message}` });
  }
});

// GET /api/auth/oidc/callback — Authentik redirects here with code+state
router.get("/callback", async (req, res) => {
  const appUrl = process.env.APP_URL || "http://localhost:8080";
  const fail = (msg) =>
    res.redirect(`${appUrl}/login?sso_error=${encodeURIComponent(msg)}`);
  try {
    const client = await getClient();
    const params = client.callbackParams(req);

    const stateInfo = pendingStates.get(params.state);
    if (!stateInfo) {
      return fail("State abgelaufen oder ungültig");
    }
    pendingStates.delete(params.state);

    const tokens = await client.callback(
      `${appUrl}/api/auth/oidc/callback`,
      params,
      {
        state: params.state,
        nonce: stateInfo.nonce,
        code_verifier: stateInfo.code_verifier,
      }
    );
    const claims = tokens.claims();
    const email = claims.email;
    const sub = claims.sub;
    if (!email) {
      return fail("OIDC-Claim email fehlt");
    }

    let user = await User.findOne({ where: { oidcSubject: sub } });
    if (!user) {
      user = await User.findOne({ where: { email } });
      if (user) {
        await user.update({ oidcSubject: sub });
      } else {
        // Auto-Provision: erster SSO-Login eines Authentik-Users → eigener
        // Privat-Haushalt, kein Invite-Code nötig. Authentik ist Source-of-Truth
        // für „wer darf rein" (Familie-Group-Binding).
        const displayName =
          claims.name || claims.preferred_username || email.split("@")[0];
        user = await sequelize.transaction(async (t) => {
          const userCount = await User.count({ transaction: t });
          const isFirst = userCount === 0;
          const isFamilyMode = process.env.FAMILY_MODE === "true";
          const noTrial = isFirst || isFamilyMode;
          // Random-Hash als Platzhalter — User loggt nur via SSO ein, das Feld
          // ist im Schema NOT NULL, wird aber nie verifiziert.
          const placeholderPw = await bcrypt.hash(
            crypto.randomBytes(32).toString("hex"),
            12
          );
          const newUser = await User.create(
            {
              name: displayName,
              email,
              password: placeholderPw,
              role: isFirst ? "superadmin" : "member",
              subscriptionType: noTrial ? null : "trial",
              trialStartedAt: noTrial ? null : new Date(),
              trialEndsAt: noTrial
                ? null
                : new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
              oidcSubject: sub,
            },
            { transaction: t }
          );
          const household = await Household.create(
            {
              name: `${displayName}s Haushalt`,
              adminUserId: newUser.id,
              isShared: false,
            },
            { transaction: t }
          );
          await HouseholdMember.create(
            {
              householdId: household.id,
              userId: newUser.id,
              role: "admin",
            },
            { transaction: t }
          );
          return newUser;
        });
        // Nur einmal global, nicht pro User — seedSystemCategories nutzt
        // findOrCreate und ist daher idempotent.
        await seedSystemCategories();
        console.log(
          `[oidc] Auto-Provision: User ${email} angelegt mit eigenem Haushalt`
        );
      }
    }

    if (!user.isActive) {
      return fail("Konto ist deaktiviert");
    }

    await user.update({ lastLoginAt: new Date() });
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    // Token im Hash, damit es nicht in Server-Logs landet
    res.redirect(`${appUrl}/login#token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error("[oidc] /callback error:", err.message);
    return fail(`SSO-Login fehlgeschlagen: ${err.message}`);
  }
});

module.exports = router;
