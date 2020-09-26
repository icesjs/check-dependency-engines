#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const execa = require('execa')
const chalk = require('chalk')

const execSetup = { extendEnv: true, cwd: process.cwd(), windowsHide: true }

// 清理文件
function clear(file) {
  console.log(`Deleting "${file}"...`)
  if (!fs.existsSync(path.join(execSetup.cwd, file))) {
    return
  }
  const platform = process.platform
  if (/^(?:win32|windows_nt)$/.test(platform)) {
    return execa(`rd`, ['/s/q', `"${file}"`], execSetup)
  } else {
    return execa(`rm`, ['-rf', `'${file}'`], execSetup)
  }
}

// 安装依赖
async function install() {
  console.log('Executing clear...')
  await clear('node_modules')
  await clear('package-lock.json')
  console.log('Cleared successfully.\nExecuting install...')
  const subProcess = execa('npm', ['install'], execSetup)
  subProcess.stdout.pipe(process.stdout)
  subProcess.stderr.pipe(process.stderr)
  await subProcess
}

// 初始化命令行提示信息
const yargs = require('yargs')
  .usage('check-deps-engine [options]')
  .option('help', {
    alias: 'h',
    type: 'boolean',
    describe: 'Show help',
  })
  .option('version', {
    alias: 'v',
    type: 'boolean',
    describe: 'Show version number',
  })
  .option('allow-pre-release', {
    alias: 'p',
    type: 'boolean',
    describe: 'Allow match pre-release version',
  })
  .option('exact', {
    alias: 'e',
    type: 'boolean',
    describe: 'Use exact version when update',
  })
  .option('disable-auto-install', {
    alias: 't',
    type: 'boolean',
    describe: 'Disable auto install after update',
  })
  .option('update', {
    alias: 'u',
    type: 'boolean',
    describe: 'Auto update package.json file',
  })
  .option('cwd', {
    alias: 'd',
    type: 'string',
    describe: 'Current Working Directory',
  })
  .option('registry', {
    alias: 'r',
    type: 'string',
    describe: 'Registry url for npm repository',
  })

//
const args = yargs.argv
if (args.h) {
  // 显示帮助信息
  yargs.showHelp('log')
} else {
  const Checker = require('./index')

  new Checker({
    cwd: args.d,
    registry: args.r,
    preRelease: args.p,
    exact: args.e,
    update: args.u,
  })
    .check()
    .then(async (updated) => {
      if (!updated.length) {
        console.log(chalk.cyan('No changes!'))
      }
      if (!args.u || !updated.length) {
        return
      }
      if (!args.t) {
        // 自动更新后，进行自动安装
        // 执行依赖安装
        console.log('Auto installing after update...')
        execSetup.cwd = args.d || process.cwd()
        await install()
        console.log('Successfully installed.')
      } else {
        console.log(
          chalk.cyan('You should run npm install to update the dependencies.')
        )
      }
    })
    .catch((e) => {
      console.error(`\n${chalk.red(e instanceof Error ? e.message : `${e}`)}\n`)
      process.exit(1)
    })
}
