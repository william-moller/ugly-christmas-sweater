  import typescript from '@rollup/plugin-typescript';

  export default {
    input: 'src/ts/Game.ts',
    output: {
      file: 'modules/js/Game.js',
      format: 'es',
      sourcemap: false,
      inlineDynamicImports: true,
      // Pre-release checklist: "Copyright headers in all source files have your name." The bundle is
      // generated, so the header has to be injected here — without it the deployed Game.js opened with
      // whichever module rollup emitted first and carried no attribution at all.
      banner: `/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Ugly Christmas Sweaters implementation : © Will Moller <will.moller@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * GENERATED — do not edit. Built from src/ts by rollup (npm run build).
 */`,
    },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        outDir: 'modules/js',
      }),
    ],
    treeshake: false,
  };