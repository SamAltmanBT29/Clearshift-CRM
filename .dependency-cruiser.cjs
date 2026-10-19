/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-cross-module-internal-imports",
      comment: "Modules must only import another module's public facade (public.ts)",
      severity: "error",
      from: { path: "^apps/crm/modules/[^/]+/" },
      to: {
        path: "^apps/crm/modules/([^/]+)/",
        pathNot: ["^apps/crm/modules/$1/", "^apps/crm/modules/[^/]+/(src/)?public(\\.ts)?$", "^apps/crm/modules/[^/]+/dist/"]
      }
    },
    {
      name: "no-db-in-ui",
      comment: "UI package and frontend code must never import database/ORM code",
      severity: "error",
      from: { path: "^(packages/ui|apps/web|apps/crm/modules/[^/]+/web)/" },
      to: { path: "^(packages/database|@cs/db|@clearshift/database|drizzle-orm)" }
    },
    {
      name: "no-modules-import-apps",
      comment: "Modules and libraries must never depend on apps/api",
      severity: "error",
      from: { path: "^(apps/crm/modules|packages)/" },
      to: { path: "^apps/api/" }
    },
    {
      name: "kernel-no-dependencies",
      comment: "packages/kernel is the lowest level and must have zero internal package dependencies",
      severity: "error",
      from: { path: "^packages/kernel/" },
      to: { path: "^(packages/(?!kernel)|apps)/" }
    },
    {
      name: "core-minimal-dependencies",
      comment: "packages/core must only depend on kernel",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "^(packages/(?!kernel)|apps)/" }
    }
  ],
  options: {
    doNotFollow: {
      path: "node_modules"
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json"
    }
  }
};
