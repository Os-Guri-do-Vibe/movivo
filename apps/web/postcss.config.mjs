/**
 * Tailwind CSS v4 é um plugin do PostCSS e dispensa `tailwind.config.*`:
 * toda a configuração de tema vive em CSS (`src/app/globals.css`, bloco `@theme`).
 *
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
