import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import svelte from "eslint-plugin-svelte"
import svelteParser from "svelte-eslint-parser"
import globals from "globals"
import { tsPresets, typeAwareOff } from "./eslint.shared.mjs"

// Same scope as before: the svelte target lints only .svelte files with the typescript-eslint presets plus a
// handful of overrides (the svelte3 setup never enabled the frontend rule list on .svelte files).
export default defineConfig(
    // .svelte.ts/.svelte.js modules are linted by the frontend target (flat/base would otherwise claim them)
    { ignores: ["**/*.svelte.ts", "**/*.svelte.js"] },
    svelte.configs["flat/base"],
    {
        files: ["**/*.svelte"],
        extends: tsPresets,
        plugins: { svelte },
        languageOptions: {
            parser: svelteParser,
            ecmaVersion: 2021,
            sourceType: "module",
            globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
            parserOptions: {
                parser: tseslint.parser,
                project: "config/typescript/tsconfig.svelte.json",
                extraFileExtensions: [".svelte"]
            }
        },
        rules: {
            ...typeAwareOff,
            "@typescript-eslint/no-implied-eval": "off",
            "@typescript-eslint/no-unused-expressions": "off", // not in the typescript-eslint 5 recommended set; `$: a, b` reactive triggers are idiomatic
            // @typescript-eslint/no-unused-vars 8 throws on svelte-eslint-parser `$:` ComputedVariable definitions, so the core rule is used here
            "@typescript-eslint/no-unused-vars": "off",
            "no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrors: "none" }],
            "@typescript-eslint/restrict-plus-operands": "off",
            // svelte3 reported compile errors (not warnings such as a11y); keep the same coverage
            "svelte/valid-compile": ["error", { ignoreWarnings: true }]
        }
    }
)
