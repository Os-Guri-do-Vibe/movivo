// @ts-check
/**
 * ESLint flat config compartilhado do monorepo MOVIVO (US-0.1 / TASK-0.1.3).
 *
 * Camadas:
 *  1. ignores globais
 *  2. base JS/TS (vale para todos os workspaces)
 *  3. preset apps/api      — TypeScript + Node/NestJS
 *  4. preset apps/web      — TypeScript + React 19 / Next.js 15
 *  5. preset packages/shared — código isomórfico (sem globals de plataforma)
 *  6. eslint-config-prettier (SEMPRE por último: desliga regras de formatação)
 *
 * Formatação é responsabilidade exclusiva do Prettier — o ESLint não formata.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';

export default tseslint.config(
  {
    name: 'movivo/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'docs/**',
      'sprint/**',
    ],
  },

  {
    name: 'movivo/base-js',
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    extends: [js.configs.recommended],
  },

  {
    name: 'movivo/base-ts',
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Regras inegociáveis do ARQUITETURA.md §12: tipagem forte, sem escapes silenciosos.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    name: 'movivo/config-files',
    files: ['*.{js,mjs,cjs}', '**/*.config.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    name: 'movivo/apps-api',
    files: ['apps/api/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: 'module' },
    },
    rules: {
      // NestJS depende de decorators e de classes com construtor de injeção vazio.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-empty-function': ['error', { allow: ['constructors'] }],
      /*
       * `consistent-type-imports` é DESLIGADO aqui de propósito, e isso não é
       * preguiça: a injeção de dependência do NestJS resolve o provider pelo tipo do
       * parâmetro do construtor, lido em RUNTIME via `emitDecoratorMetadata`. Trocar
       * `import { Foo }` por `import type { Foo }` apaga o import na emissão, a
       * metadata vira `Object` e o Nest passa a lançar "Nest can't resolve
       * dependencies" — um erro de execução que o compilador não pega. O ganho da
       * regra (imports levemente mais enxutos) não paga esse risco.
       * Onde o tipo é comprovadamente só tipo, o código usa `import type` à mão.
       */
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  {
    /*
     * Scripts de linha de comando do banco (`db:migrate`, `db:seed`).
     *
     * `no-console` é desligado aqui porque nestes arquivos o stdout **é** a
     * interface com o operador: quem roda uma migração precisa ver, no terminal,
     * qual host foi alvo, quais extensões foram garantidas e se o modelo de
     * permissões passou. Mandá-los para o logger estruturado da aplicação seria
     * pior — o pino é montado pelo ciclo de vida do Nest, que não existe num
     * script `tsx` avulso.
     */
    name: 'movivo/db-cli-scripts',
    files: ['apps/api/src/core/database/{migrate,seed}.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    name: 'movivo/apps-web',
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      '@next/next': nextPlugin,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // Projeto usa exclusivamente App Router (US-0.5) — não existe diretório `pages/`.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  {
    name: 'movivo/packages-shared',
    files: ['packages/shared/**/*.ts'],
    rules: {
      // packages/shared é isomórfico: nunca pode depender de APIs de Node ou do browser.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'crypto', 'child_process'],
              message:
                '@movivo/shared é isomórfico (back + front). Não importe APIs de plataforma aqui.',
            },
          ],
        },
      ],
    },
  },

  prettierConfig,
);
