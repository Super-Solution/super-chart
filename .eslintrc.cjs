// ESLint for src/ only (tsconfig includes nothing else). standard-with-typescript
// needs type information, so parserOptions.project is required: without it the
// first type-aware rule crashes ESLint.
//
// The purely stylistic rules the imported upstream code does not follow are off,
// and the type-aware rules it trips are warnings for now, so `bun run lint`
// passes today. Do not mass-run `eslint --fix`: it would rewrite ~150 files under
// every other change in flight. Tighten a rule by fixing its warnings first.
//
// Warnings are a ratchet, not a free pass: `bun run lint` runs with
// --max-warnings set to today's count (package.json), so a change that adds a
// warning fails. Lower the number when you fix some; raising it needs a reason
// in the PR. Unhandled promises are errors everywhere except the two files
// that still have them.
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true
  },
  extends: 'standard-with-typescript',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: './tsconfig.json',
    tsconfigRootDir: __dirname
  },
  rules: {
    // Style: off (see above).
    semi: 'off',
    '@typescript-eslint/semi': 'off',
    quotes: 'off',
    '@typescript-eslint/quotes': 'off',
    'comma-dangle': 'off',
    '@typescript-eslint/comma-dangle': 'off',
    '@typescript-eslint/member-delimiter-style': 'off',
    'space-before-function-paren': 'off',
    '@typescript-eslint/space-before-function-paren': 'off',
    'eol-last': 'off',
    'no-trailing-spaces': 'off',
    'no-multiple-empty-lines': 'off',
    'one-var': 'off',
    '@typescript-eslint/object-curly-spacing': 'off',
    '@typescript-eslint/brace-style': 'off',
    'no-multi-spaces': 'off',
    'multiline-ternary': 'off',
    'arrow-spacing': 'off',
    '@typescript-eslint/space-infix-ops': 'off',
    'padded-blocks': 'off',
    '@typescript-eslint/keyword-spacing': 'off',
    '@typescript-eslint/no-extra-parens': 'off',
    // Type-aware and correctness rules the current code trips: warnings until
    // their hits are fixed by hand.
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/consistent-type-imports': 'warn',
    '@typescript-eslint/strict-boolean-expressions': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
    '@typescript-eslint/method-signature-style': 'warn',
    '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
    '@typescript-eslint/no-confusing-void-expression': 'warn',
    '@typescript-eslint/restrict-plus-operands': 'warn',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-unused-vars': 'warn',
    'prefer-const': 'warn',
    '@typescript-eslint/return-await': 'warn',
    '@typescript-eslint/restrict-template-expressions': 'warn',
    '@typescript-eslint/prefer-optional-chain': 'warn',
    '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'warn',
    'no-undef-init': 'warn',
    '@typescript-eslint/array-type': 'warn',
    '@typescript-eslint/no-dynamic-delete': 'warn',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/prefer-readonly': 'warn',
    'n/no-callback-literal': 'warn',
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
    'prefer-regex-literals': 'warn',
    '@typescript-eslint/consistent-type-assertions': 'warn',
    '@typescript-eslint/no-extraneous-class': 'warn',
    'no-useless-escape': 'warn',
    'no-new-func': 'warn',
    '@typescript-eslint/dot-notation': 'warn'
  },
  overrides: [
    {
      // The existing unhandled promises (5): warnings until fixed by hand.
      files: ['src/ChartProComponent.tsx', 'src/widget/period-bar/index.tsx'],
      rules: {
        '@typescript-eslint/no-floating-promises': 'warn',
        '@typescript-eslint/no-misused-promises': 'warn'
      }
    }
  ]
}
