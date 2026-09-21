import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
  ...obsidianmd.configs.recommended,
  {
    files:['src/**/*.js'],
    languageOptions:{sourceType:'commonjs',parserOptions:{project:'./tsconfig.json'}},
    rules:{
      // The shipped Obsidian bundle and this existing source use CommonJS.
      '@typescript-eslint/no-require-imports':'off',
      'no-implicit-globals':'off', // CommonJS is already module-scoped.
      'no-redeclare':['error',{builtinGlobals:false}],
      'obsidianmd/ui/sentence-case':['warn',{brands:['Codex','Desktop','ChatGPT','Dataview','Daybook'],ignoreWords:['Settings','Community']}],
      // These expressions explicitly reject control characters in paths/text.
      'no-control-regex':'off',
      'no-empty':['error',{allowEmptyCatch:true}]
    }
  },
  {ignores:['node_modules/**','dist/**','release/**','test/**','scripts/**','build.js','eslint.config.mjs']}
];
