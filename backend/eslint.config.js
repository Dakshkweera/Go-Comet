import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const httpLayer = {
  group: ["**/controllers/**", "**/routes/**", "**/middlewares/**"],
  message: "Services must not depend on the HTTP layer.",
};

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "coverage/**", "drizzle/**", "data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["src/services/**", "src/db/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [httpLayer] }] },
  },
  {
    files: ["src/services/validation/**", "src/services/routing/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            httpLayer,
            {
              group: ["**/llm/**", "**/extraction/**"],
              message: "Validator and Router stay deterministic: no LLM or extraction imports.",
            },
          ],
        },
      ],
    },
  },
);
