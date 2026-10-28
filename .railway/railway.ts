import { defineRailway, postgres, preserve, project, service } from "railway/iac";

type AppName = "backend" | "sim" | "echo";

// Every service builds from the repository root (the apps import packages/*)
// and picks its app through the root npm scripts.
function deploySettings(name: AppName) {
  return {
    build: {
      builder: "RAILPACK" as const,
      buildCommand: `npm run build:${name}`,
      watchPatterns: [`apps/${name}/**`, "packages/**", "package.json", "package-lock.json"],
    },
    deploy: {
      startCommand: `npm run start:${name}`,
      healthcheckPath: "/healthz",
      healthcheckTimeout: 120,
      restartPolicyType: "ON_FAILURE" as const,
      restartPolicyMaxRetries: 10,
    },
  };
}

export default defineRailway(() => {
  const db = postgres("Postgres");

  const backend = service("backend", {
    ...deploySettings("backend"),
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      PORT: "8787",
      GEMINI_API_KEY: preserve(),
    },
  });

  // The frontends proxy /api to the backend over the private network.
  const backendUrl = "http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:${{backend.PORT}}";
  const sim = service("sim", { ...deploySettings("sim"), env: { BACKEND_URL: backendUrl } });
  const echo = service("echo", { ...deploySettings("echo"), env: { BACKEND_URL: backendUrl } });

  return project("aware-nurturing", {
    resources: [db, backend, sim, echo],
  });
});
