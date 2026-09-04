/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "lark-bot 模块依赖必须单向，禁止循环 import",
      from: { path: "^agent-src/.pi/scripts/lark-bot" },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: ["npm", "npm-dev", "npm-peer", "npm-bundled", "npm-no-pkg"],
    },
    exclude: {
      path: [
        "(^|/)node_modules/",
        "(^|/)__tests__/",
        "(^|/)broadcast/", // L4a 占位，未来实现后移除
        "(^|/)\.dependency-cruiser\\.cjs$",
      ],
    },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};