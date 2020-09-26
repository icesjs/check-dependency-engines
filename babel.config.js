module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        // 支持node8以上环境
        targets: 'node 8.3.0',
        // 转换为cjs模块
        modules: 'cjs',
        // 根据target按需引入polyfill
        useBuiltIns: 'usage',
        corejs: {
          // env插件会从全局引入polyfill
          version: 3,
          proposals: true,
        },
        // 支持仍处于提议状态的特性
        shippedProposals: true,
      },
    ],
  ],
  plugins: [
    [
      '@babel/plugin-transform-runtime',
      {
        // 进行helpers抽取
        helpers: true,
        // 不需要引入polyfill，已由env插件处理
        corejs: false,
        // 不需要处理生成器函数
        regenerator: false,
      },
    ],
  ],
}
