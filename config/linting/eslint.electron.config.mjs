import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import globals from "globals"
import { jsdocPlugin, sharedRules, tsPresets } from "./eslint.shared.mjs"

export default defineConfig({
    files: ["**/*.{js,ts}"],
    extends: tsPresets,
    plugins: jsdocPlugin,
    languageOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2018,
        sourceType: "module",
        globals: { ...globals.node, ...globals.es2015 },
        parserOptions: { project: "config/typescript/tsconfig.electron.json" }
    },
    rules: {
        ...sharedRules,
        "@typescript-eslint/triple-slash-reference": ["error", { path: "always", types: "prefer-import", lib: "always" }],
        "@typescript-eslint/unbound-method": ["error", { ignoreStatic: true }],
        "id-denylist": ["error", "any", "Number", "number", "String", "string", "Boolean", "boolean", "Undefined", "undefined"],
        "no-console": ["error", { allow: ["error", "warn", "info", "time", "timeEnd"] }],
        "no-underscore-dangle": "error"
    }
})
