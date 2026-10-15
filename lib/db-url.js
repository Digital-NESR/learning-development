// Builds the PostgreSQL connection URL for Prisma.
// Uses DATABASE_URL if set; otherwise the Digital-NESR shared DB_* variables plus LD_DB_NAME.
// Plain JS so both the app and Node scripts (migrations, seed) can use it.

export function databaseUrl(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const host = env.DB_HOST;
  const name = env.LD_DB_NAME;
  if (!host || !name) {
    const missing = ["DB_HOST", "DB_USER", "DB_PASSWORD", "LD_DB_NAME"].filter(k => !env[k]);
    throw new Error(
      "Database not configured. Missing environment variables: " + missing.join(", ") +
      ". Add them to this Vercel project (Settings → Environment Variables), or link the team's shared variables to it, then redeploy."
    );
  }

  const user = encodeURIComponent(env.DB_USER || "");
  const pass = env.DB_PASSWORD ? ":" + encodeURIComponent(env.DB_PASSWORD) : "";
  const auth = user ? `${user}${pass}@` : "";
  const port = env.DB_PORT || "5432";

  const ssl = String(env.DB_SSL ?? "").trim().toLowerCase();
  const sslmode = ["", "false", "0", "no", "off", "disable"].includes(ssl) ? "disable"
    : ["prefer", "verify-full", "verify-ca"].includes(ssl) ? ssl
    : "require";

  return `postgresql://${auth}${host}:${port}/${encodeURIComponent(name)}?schema=public&sslmode=${sslmode}`;
}
