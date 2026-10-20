import hooks from "eslint-plugin-react-hooks";
import globals from "globals";
export default [
  { ignores: ["out/**", ".next/**"] },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^[A-Z]", argsIgnorePattern: "^_" },
      ],
    },
  },
];
