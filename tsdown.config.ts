import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'jsx-runtime': 'src/jsx-runtime.ts',
    'jsx-dev-runtime': 'src/jsx-dev-runtime.ts',
    emit: 'src/emit/index.ts',
    serve: 'src/serve/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  minify: true,
  // The CLI imports the other entries by name, so it shares their files.
  deps: { neverBundle: [/^contextjsx(\/|$)/] },
  exports: { exclude: ['cli'], bin: false },
});
