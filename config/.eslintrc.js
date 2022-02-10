module.exports = {
  env: {
    browser: true,
    es6: true,
    commonjs: true,
    node: true,
    webextensions: true
  },
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:styled-components-a11y/recommended",
    "plugin:import/recommended",
    "plugin:import/typescript"
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaFeatures: {
      jsx: true
    },
    ecmaVersion: 12
  },
  plugins: ["react", "react-hooks", "@typescript-eslint", "styled-components-a11y", "import"],
  rules: {
    "default-case": "warn",
    eqeqeq: ["warn", "always"],
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/consistent-type-imports": [
      "error",
      {
        prefer: "type-imports",
        disallowTypeAnnotations: true
      }
    ],
    "jsx-a11y/label-has-associated-control": [
      "error",
      {
        required: {
          some: ["nesting", "id"]
        }
      }
    ],
    "jsx-a11y/label-has-for": [
      "error",
      {
        required: {
          some: ["nesting", "id"]
        }
      }
    ],
    "react/jsx-uses-react": "off",
    "react/react-in-jsx-scope": "off",
    "no-console": [
      "error",
      {
        allow: ["error", "warn", "info", "groupEnd", "groupCollapsed"]
      }
    ],
    "no-alert": "error",
    "no-inline-comments": "error",
    "padding-line-between-statements": [
      "error",
      {
        blankLine: "always",
        prev: "*",
        next: ["return", "function", "export", "default", "case"]
      },
      {
        blankLine: "always",
        prev: "singleline-const",
        next: "multiline-const"
      },
      {
        blankLine: "always",
        prev: ["multiline-const", "block-like"],
        next: "*"
      }
    ],
    "spaced-comment": [
      "error",
      "always",
      {
        block: {
          markers: ["*"],
          balanced: true
        }
      }
    ],
    camelcase: "error",
    "import/no-unresolved": ["error", { ignore: ["^~/*"] }],
    "import/newline-after-import": "warn",
    "import/order": [
      "warn",
      {
        groups: ["builtin", "external", "parent", "sibling", "index", "object", "type"],
        "newlines-between": "always",
        alphabetize: {
          order: "asc"
        },
        warnOnUnassignedImports: true
      }
    ]
  },
  settings: {
    react: {
      version: "detect"
    },
    "import/extensions": [".ts", ".tsx"],
    "import/parsers": {
      "@typescript-eslint/parser": [".ts", ".tsx"]
    },
    "import/resolver": {
      typescript: {
        alwaysTryTypes: true,
        project: "config/tsconfig.json"
      }
    }
  },
  ignorePatterns: ["docs", "**/*.{js,jsx}"]
};
