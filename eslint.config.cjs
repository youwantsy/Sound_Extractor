const js = require("@eslint/js");
const globals = require("globals");
module.exports = [
  {
    ignores: [
      "node_modules/**",
      "vendor/**",
      "dist/**",
      ".cache/**",
      "test-results/**",
    ],
  },
  {
    files: ["src/**/*.cjs", "scripts/**/*.cjs", "test/**/*.cjs", "*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["src/ui/renderer.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    files: ["scripts/e2e.cjs"],
    languageOptions: { globals: { window: "readonly", document: "readonly" } },
  },
  {
    files: ["src/security.cjs", "test/security.test.cjs"],
    // These expressions intentionally strip Windows-forbidden control characters.
    rules: { "no-control-regex": "off" },
  },
];
