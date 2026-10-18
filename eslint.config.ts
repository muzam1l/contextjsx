import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig(
  { ignores: ['dist/**', '.tmp/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts', 'test/**/*.{ts,tsx}', 'bench/**/*.ts', 'scripts/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Source and test hooks are declared to return Promise; `async` without `await` is the honest signature.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['src/jsx-runtime.ts'],
    rules: {
      // TypeScript's JSX protocol: a declared namespace, components with any props shape, open interfaces for augmentation.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'always', allowObjectTypes: 'always' },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Bun's `expect().rejects` matchers are thenable at runtime but not in their types.
      '@typescript-eslint/await-thenable': 'off',
    },
  },
  prettier,
);
