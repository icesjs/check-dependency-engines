#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const execa = require('execa')
const chalk = require('chalk')

const execSetup = { extendEnv: true, cwd: process.cwd(), windowsHide: true }

const logger = {
  log: (...args) => !logger.q && console.log(...args),
  error: (...args) => !logger.q && console.error(...args),
}

// 清理文件
function clear(file) {
  logger.log(`Deleting "${file}"...`)
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
  logger.log('Executing clear...')
  await clear('node_modules')
  // await clear('package-lock.json')
  logger.log('Cleared successfully.\nExecuting install...')
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
  .option('development', {
    alias: 'D',
    type: 'boolean',
    describe: 'Only update the devDependencies',
  })
  .option('quiet', {
    alias: 'q',
    type: 'boolean',
    describe: 'Disable the logs',
  })

//
const args = yargs.argv
if (args.h) {
  // 显示帮助信息
  yargs.showHelp('log')
} else {
  logger.q = args.q
  //
  const Checker = require('./index')

  new Checker({
    cwd: args.d,
    registry: args.r,
    preRelease: args.p,
    exact: args.e,
    update: args.u,
    development: args.D,
    log: !args.q,
  })
    .check()
    .then(async (updated) => {
      if (!updated.length) {
        logger.log(chalk.cyan('No changes!'))
      }
      if (!args.u || !updated.length) {
        return
      }
      if (!args.t) {
        // 自动更新后，进行自动安装
        // 执行依赖安装
        logger.log('Auto installing after update...')
        execSetup.cwd = args.d || process.cwd()
        await install()
        logger.log('Successfully installed.')
        logger.log(
          chalk.yellow(
            'You should re-run your tests to make sure everything works with the updates.'
          )
        )
      } else {
        logger.log(
          chalk.cyan(
            chalk.yellow(
              'You should run npm install to update the dependencies,\nand re-run your tests to make sure everything works with the updates.'
            )
          )
        )
      }
    })
    .catch((e) => {
      logger.error(`\n${chalk.red(e instanceof Error ? e.message : `${e}`)}\n`)
      process.exit(1)
    })
}
