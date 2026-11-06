// Shared ESLint flat-config building blocks for the electron, frontend and svelte lint targets.
// Rule values mirror the previous eslintrc configs (typescript-eslint 5 era). Rules renamed or removed
// in typescript-eslint 8 / ESLint 10 / eslint-plugin-jsdoc 65 are mapped to their closest equivalent.
import tseslint from "typescript-eslint"
import jsdoc from "eslint-plugin-jsdoc"
import prettier from "eslint-config-prettier"

export const bannedTypes = {
    Object: { message: "Avoid using the `Object` type. Did you mean `object`?" },
    Function: { message: "Avoid using the `Function` type. Prefer a specific function type, like `() => void`." },
    Boolean: { message: "Avoid using the `Boolean` type. Did you mean `boolean`?" },
    Number: { message: "Avoid using the `Number` type. Did you mean `number`?" },
    String: { message: "Avoid using the `String` type. Did you mean `string`?" },
    Symbol: { message: "Avoid using the `Symbol` type. Did you mean `symbol`?" }
}

// typescript-eslint 8 recommended-type-checked, with rules added after v5 switched off so the rule set
// (and the error baseline) stays equivalent to the previous configuration.
export const tsPresets = [
    tseslint.configs.recommendedTypeChecked,
    {
        rules: {
            "@typescript-eslint/no-array-delete": "off",
            "@typescript-eslint/no-base-to-string": "off",
            "@typescript-eslint/no-duplicate-type-constituents": "off",
            "@typescript-eslint/no-redundant-type-constituents": "off",
            "@typescript-eslint/no-unsafe-enum-comparison": "off",
            "@typescript-eslint/no-unsafe-unary-minus": "off",
            "@typescript-eslint/no-unsafe-function-type": "off",
            "@typescript-eslint/no-wrapper-object-types": "off",
            "@typescript-eslint/only-throw-error": "off",
            "@typescript-eslint/prefer-promise-reject-errors": "off",
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { caughtErrors: "none" }],
            "@typescript-eslint/no-inferrable-types": "error"
        }
    },
    prettier,
    // ESLint 9+ warns on unused disable directives by default; the eslintrc setup did not
    { linterOptions: { reportUnusedDisableDirectives: "off" } }
]

export const typeAwareOff = {
    "@typescript-eslint/no-floating-promises": "off",
    "@typescript-eslint/no-misused-promises": "off",
    "@typescript-eslint/restrict-template-expressions": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/naming-convention": "off",
    "@typescript-eslint/ban-ts-comment": "off"
}

export const jsdocPlugin = { jsdoc }

// Rules shared by the electron and frontend targets (identical in both previous configs).
export const sharedRules = {
    "@typescript-eslint/adjacent-overload-signatures": "error",
    "@typescript-eslint/array-type": ["error", { default: "array" }],
    "@typescript-eslint/no-restricted-types": ["error", { types: bannedTypes }],
    "@typescript-eslint/consistent-type-assertions": "error",
    "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", disallowTypeAnnotations: true }],
    "@typescript-eslint/dot-notation": "error",
    "@typescript-eslint/no-empty-function": "error",
    "@typescript-eslint/no-empty-object-type": "error",
    "@typescript-eslint/no-misused-new": "error",
    "@typescript-eslint/no-namespace": "error",
    "@typescript-eslint/no-unused-expressions": "error",
    "@typescript-eslint/no-use-before-define": "off",
    "@typescript-eslint/prefer-for-of": "error",
    "@typescript-eslint/prefer-function-type": "error",
    "@typescript-eslint/prefer-namespace-keyword": "error",
    "@typescript-eslint/unified-signatures": "error",
    ...typeAwareOff,
    "constructor-super": "error",
    eqeqeq: ["error", "smart"],
    "guard-for-in": "error",
    "id-match": "error",
    "jsdoc/check-alignment": "error",
    "jsdoc/check-indentation": "error",
    // replaces jsdoc/newline-after-description (removed from eslint-plugin-jsdoc in v44)
    "jsdoc/tag-lines": ["error", "any", { startLines: 1 }],
    "max-classes-per-file": ["error", 1],
    "no-caller": "error",
    "no-cond-assign": "error",
    "no-debugger": "error",
    "no-empty": "error",
    "no-eval": "error",
    "no-new-wrappers": "error",
    "no-shadow": ["error", { hoist: "all" }],
    "no-throw-literal": "error",
    "no-undef-init": "error",
    "no-unsafe-finally": "error",
    "no-unused-labels": "error",
    "no-var": "error",
    "object-shorthand": "error",
    "one-var": ["error", "never"],
    "prefer-const": "error",
    radix: "error",
    "spaced-comment": ["error", "always", { markers: ["/"] }],
    "use-isnan": "error"
}
