import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = tseslint.config([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["node_modules/**", ".next/**", "dist/**", "coverage/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
  },
]);

export default eslintConfig;
