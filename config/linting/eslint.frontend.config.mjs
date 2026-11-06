import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import globals from "globals"
import { jsdocPlugin, sharedRules, tsPresets } from "./eslint.shared.mjs"

export default defineConfig(
    {
        files: ["**/*.{js,ts}"],
        extends: tsPresets,
        plugins: jsdocPlugin,
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 2021,
            sourceType: "module",
            globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
            parserOptions: { project: "config/typescript/tsconfig.svelte.json" }
        },
        rules: {
            ...sharedRules,
            "@typescript-eslint/no-require-imports": "error",
            "@typescript-eslint/triple-slash-reference": "off",
            "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrors: "none" }],
            "@typescript-eslint/restrict-plus-operands": "off",
            "id-denylist": ["error", "any", "String", "string", "Boolean", "boolean", "Undefined", "undefined"],
            "no-console": ["error", { allow: ["error", "warn", "info", "assert", "time", "timeEnd"] }],
            "no-underscore-dangle": "off"
        }
    },
    // plain .js files (simplex-noise.js) are not part of the tsconfig project: lint them without type information
    {
        files: ["**/*.js"],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: { parserOptions: { project: false } }
    }
)
