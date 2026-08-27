// eslint.config.js — ESLint 9 flat config
// 集成 Vue 3 推荐规则 + TypeScript 推荐规则
// 自定义 dev 仓库规则：禁止 console 残留、强制 ===、禁止 v-html XSS
import pluginVue from 'eslint-plugin-vue'
import vueTsEslintConfig from '@vue/eslint-config-typescript'

export default [
  {
    ignores: [
      'dist/**',
      '.astro/**',
      'node_modules/**',
      'agent-src/**',          // ops 仓库镜像，不属于 dev 维护
      'types/**',              // 自动生成，不手动维护
      'scripts/generate-types.mjs',  // 工具脚本
    ],
  },
  ...pluginVue.configs['flat/recommended'],
  ...vueTsEslintConfig(),
  {
    rules: {
      // 自定义 dev 仓库规则
      // 拦截 console.log/debug/info 残留；但允许 console.error/warn（catch 块记录错误合理）
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'eqeqeq': ['error', 'always'],                      // 强制 ===
      'vue/no-v-html': 'error',                           // 拦截 XSS 风险
      'no-unused-vars': 'off',                            // vue-tsc 已覆盖类型层未使用变量
      'vue/multi-word-component-names': 'off',            // App.vue 单字不算违规
      'vue/html-self-closing': 'off',                     // 允许自闭合写法
      'vue/max-attributes-per-line': 'off',               // 允许单行多属性
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/attributes-order': 'off',
      'vue/attribute-hyphenation': 'off',
      'vue/v-on-event-hyphenation': 'off',
    },
  },
  {
    files: ['src/composables/*.ts', 'src/components/*.vue', 'src/App.vue'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]