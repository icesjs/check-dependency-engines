#! /usr/bin/env node
const path = require('path')

const got = require('got')
const chalk = require('chalk')
const semver = require('semver')
const resolve = require('resolve')
const writePackage = require('write-pkg')
const registryUrl = require('registry-url')

const { table } = require('table')
const { SingleBar } = require('cli-progress')

/*!
 * 检查依赖的引擎要求，并通过元数据查找符合当前工程最小引擎版本要求的依赖的版本。
 */
module.exports = class Checker {
  //
  constructor({
    log,
    update,
    exact,
    preRelease = false,
    cwd = process.cwd(),
    registry = registryUrl(),
  }) {
    this.logger = this.getLogger(log)
    this.loggerDisabled = log === false
    this.autoUpdateAfterCheck = !!update
    this.useExactVersionWhenUpdate = !!exact
    this.allowPreRelease = !!preRelease
    this.cwd = cwd
    this.registry = `${`${registry}`.replace(/\/+$/, '')}/`

    try {
      this.npmPackage = this.getNpmPackage()
      // 当前工程的引擎要求
      this.requiredEngines = this.npmPackage.engines || null
    } catch (e) {
      this.logger(e)
      process.exit(1)
    }

    // 依赖包的总数
    this.dependencyAmount = this.getDependencyAmount()

    if (this.requiredEngines) {
      // 期待的最小引擎版本号
      const { node, npm } = this.requiredEngines
      this.minVersionEngines = {
        node: node ? semver.minVersion(node) : '',
        npm: npm ? semver.minVersion(npm) : '',
      }
    }
  }

  // 获取当前工作目录下的package.json
  getNpmPackage() {
    const pkg = require(path.join(this.cwd, './package.json'))
    for (const prop of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ]) {
      if (!pkg.hasOwnProperty(prop) || typeof pkg[prop] !== 'object') {
        pkg[prop] = {}
      }
    }
    return pkg
  }

  // 验证依赖是否都符合引擎要求
  async verify() {
    if (!this.verifiable()) {
      return null
    }
    return this.formatData(await this.fetchMetaData())
  }

  // 检查依赖并进行package.json文件更新操作
  async check() {
    if (!this.verifiable()) {
      return
    }
    const { node, npm } = this.minVersionEngines
    this.logger(
      `Expected ${chalk.cyan('Min version')} for ${chalk.cyan(
        'Node'
      )} is: ${chalk.cyan(node || '*')}`
    )
    this.logger(
      `Expected ${chalk.cyan('Min version')} for ${chalk.cyan(
        'Npm'
      )} is: ${chalk.cyan(npm || '*')}`
    )
    // 分析并打印信息
    const updated = this.printTable(this.formatData(await this.fetchMetaData()))
    if (updated.length && this.autoUpdateAfterCheck) {
      // 更新package.json文件
      await writePackage.sync(this.cwd, this.npmPackage, { normalize: true })
      this.logger(`Successfully updated package.json`)
    } else {
      this.logger(`Analyse completed.`)
    }
    return updated
  }

  // 是否可验证的
  verifiable() {
    const { node, npm } = this.minVersionEngines
    if (!node && !npm) {
      this.logger('There is no expectation for engines in project.')
      return false
    }
    if (!this.dependencyAmount) {
      this.logger('There is no dependency declared in project.')
      return false
    }
    return true
  }

  // 以表格形式打印
  printTable(data) {
    const updatedDependencies = []
    const records = [
      // 表头
      ['Dependency Type', 'Dependency Declared', 'Version Details'],
    ]
    //
    for (const [type, obj] of Object.entries(data)) {
      for (const [name, item] of Object.entries(obj)) {
        const { installed, satisfied, declaredRange } = item
        const updatable = this.isUpdatable(declaredRange, satisfied)

        // 第二列
        let declared = updatable ? chalk.yellow(name) : chalk.cyan(name)
        if (!installed) {
          declared += `  ${chalk.red('not install')}`
        }
        const validDeclaredRange = semver.validRange(declaredRange)
        if (validDeclaredRange) {
          declared += `\n\n${declaredRange}  ${chalk.gray(
            `range: ${validDeclaredRange}`
          )}`
        }
        if (updatable) {
          updatedDependencies.push({ name, installed, satisfied })
          //
          declared += `\n\n${chalk.cyan(declaredRange)}  ${chalk.bold.gray(
            '->'
          )}  ${this.getUpdatedRange(installed, satisfied, declaredRange)}`
        }

        // 第三列
        const details = []
        for (const field of [
          'installed',
          'expectedEngines',
          'latest',
          'satisfied',
          'satisfiedEngines',
        ]) {
          if (!field) {
            details.push('') // 空行
            continue
          }
          const val = item[field]
          let str = val
          if (typeof val === 'object') {
            str = val.node ? `node ${val.node}` : ''
            str += val.npm
              ? `\n${'npm'.padStart(field.length + 6)} ${val.npm}`
              : ''
          }
          str = `${field.padStart(16)}: ${
            field !== 'latest' ? chalk.cyan(str || '') : str || ''
          }`
          details.push(field === 'latest' ? chalk.gray(str) : str)
        }

        // 添加行至表格
        records.push([type, declared, details.join('\n')])
      }
    }
    //
    const output = table(records, {
      columnDefault: {
        wrapWord: false,
      },
    })
    // 输出至终端
    this.logger(output)
    return updatedDependencies
  }

  // 获取更新后的版本范围
  getUpdatedRange(installed, satisfied, declared) {
    // 能够进入该方法，是通过了isUpdatable检测的
    // 此时declared范围内最高版本一定是超出了匹配版本的
    // 主要进行范围下限限定
    const validRange = semver.validRange(declared)

    // 要求精确化版本
    if (this.useExactVersionWhenUpdate) {
      if (installed) {
        if (semver.gte(installed, satisfied)) {
          // 安装版本大于或等于匹配版本
          return satisfied
        }
        // 安装版本小于匹配版本
        return installed
      }
      // 当前没有安装该依赖
      return validRange ? semver.minVersion(declared) : satisfied
    }

    // 不要求精确化版本时
    if (validRange) {
      // 正确声明了版本范围
      if (semver.lt(semver.minVersion(declared), satisfied)) {
        // 声明了有效版本范围，并且最小版本小于匹配的版本
        return `${validRange !== '*' ? `${declared} ` : ''}<=${satisfied}`
      }
      return satisfied
    }
    // 没有声明有效的版本范围
    return `<=${satisfied}`
  }

  // 是否是需要更新
  isUpdatable(declaredRange, satisfied) {
    if (!satisfied || satisfied === '*') {
      // 没有合适当前工程最小引擎版本要求的依赖版本号
      // 或者因没有引擎要求而通配的依赖版本号
      return false
    }
    if (!declaredRange) {
      // 没有声明依赖的版本范围
      return true
    }
    const range = semver.validRange(declaredRange)
    if (!range) {
      // 声明的依赖版本不符合规范
      return true
    }
    // 如果与大于当前匹配版本的范围存在交集，则需要更新
    return semver.intersects(range, `>${satisfied}`)
  }

  // 获取已安装包的信息
  getInstalledPkg(name) {
    let pkg = {
      version: '',
      engines: null,
    }
    try {
      resolve.sync(name, {
        basedir: this.cwd,
        packageFilter: ({ version, engines }) => {
          pkg.version = version
          pkg.engines = engines
        },
      })
    } catch (e) {}
    return pkg
  }

  // 对依赖要求的引擎版本范围进行匹配
  matchRange(meta) {
    const { engines } = meta
    if (!engines) {
      return !(!this.allowPreRelease && semver.prerelease(meta.version))
    }
    const opt = { includePrerelease: this.allowPreRelease }
    const { node: minNode, npm: minNpm } = this.minVersionEngines
    const { node, npm } = Object.assign({}, engines)
    const nodeFailed = minNode && node && !semver.satisfies(minNode, node, opt)
    const npmFailed = minNpm && npm && !semver.satisfies(minNpm, npm, opt)
    return !(nodeFailed || npmFailed)
  }

  // 格式化结果数据
  formatData(data) {
    const npmPkg = this.npmPackage
    const mockPkg = {
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
    }
    for (const [deps, packs] of data) {
      for (const key of Object.keys(npmPkg)) {
        if (npmPkg[key] === deps) {
          for (const [name, pkg] of Object.entries(packs)) {
            const {
              declaredRange,
              matchedVersion,
              matchedEngines,
              latestVersion,
            } = pkg
            const { version, engines } = this.getInstalledPkg(name)
            const { node, npm } = Object.assign({}, engines)

            mockPkg[key][name] = {
              declaredRange,
              installed: version,
              latest: latestVersion,
              expectedEngines: !node && !npm ? '*' : engines,
              satisfied: matchedVersion,
              satisfiedEngines: matchedEngines,
            }
            if (this.isUpdatable(declaredRange, matchedVersion)) {
              // 更新package.json依赖版本信息为已匹配到的版本号
              deps[name] = this.getUpdatedRange(
                version,
                matchedVersion,
                declaredRange
              )
            }
          }
          break
        }
      }
    }
    return mockPkg
  }

  // 获取依赖的元数据信息
  async fetchMetaData() {
    const { dependencies, devDependencies, peerDependencies } = this.npmPackage
    const data = new Map()
    const errors = []
    this.logger(`Fetching meta data from "${this.registry}"...`)
    const tick = this.createProgressBar(this.dependencyAmount)
    for (const deps of [dependencies, devDependencies, peerDependencies]) {
      data.set(deps, {})
      // 请求元数据
      for (const [name, range] of Object.entries(deps)) {
        tick.update({ name })
        const pkg = (data.get(deps)[name] = {
          name,
          declaredRange: range,
          meta: await this.fetch(name).catch((e) => {
            errors.push(`${chalk.cyan(name)} ${chalk.red(e.message)}`)
            return { versions: {} }
          }),
        })
        // 递增进度条
        tick()
        // 匹配引擎版本
        const { versions } = pkg.meta
        const { latest } = pkg.meta['dist-tags'] || {}
        pkg.latestVersion = latest || ''

        const metas = Object.entries(versions).sort((a, b) =>
          a[0] && b[0] && semver.gt(a[0], b[0]) ? -1 : 1
        )
        pkg.matchedEngines = ''
        pkg.matchedVersion = ''
        for (const [ver, meta] of metas) {
          if (this.matchRange(meta)) {
            const { node, npm } = Object.assign({}, meta.engines)
            pkg.matchedEngines = !node && !npm ? '*' : meta.engines
            // 如果没有引擎要求，则满足要求的版本设置为通配
            pkg.matchedVersion = !node && !npm ? '*' : ver
            break
          }
        }
      }
    }
    if (errors.length) {
      this.logger(chalk.red(`Can not fetch metadata for these package:`))
      this.logger(errors.join('\n'))
    } else {
      this.logger('Successfully Fetched meta data.')
    }
    return data
  }

  // 从npm仓库请求元数据
  async fetch(name) {
    const { body } = await got(`${this.registry}${name}`, {
      timeout: 15000,
      json: true,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.121 Safari/537.36',
      },
    })
    return body
  }

  // 创建一个控制台进度条
  createProgressBar(total, payload = { name: '' }) {
    if (this.loggerDisabled) {
      const tick = () => {}
      tick.stop = tick.update = () => {}
      return tick
    }
    const setup = {
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      format: `{bar} {percentage}% ${chalk.cyan('{name}')} ${chalk.gray(
        '(Cost: {duration}s)'
      )}`,
      hideCursor: true,
      stopOnComplete: false,
      clearOnComplete: false,
      noTTYOutput: !process.stderr.isTTY,
      notTTYSchedule: 1000,
      total: 100,
    }
    if (typeof total === 'object') {
      Object.assign(setup, total)
    } else if (typeof total === 'number') {
      Object.assign(setup, { total })
    }

    // 创建一个实例
    const bar = new SingleBar(setup)
    const tick = (...args) => {
      bar.increment(...args)
      if (bar.value >= bar.getTotal()) {
        // 清空payload显示
        bar.update(
          Object.keys(payload).reduce((obj, key) => {
            obj[key] = ''
            return obj
          }, {})
        )
        bar.updateETA()
        bar.stop()
      }
    }
    tick.stop = bar.stop.bind(bar)
    tick.update = bar.update.bind(bar)
    // 启动进度条
    bar.start(setup.total, 0, payload)
    // 返回更新进度条的回调
    return tick
  }

  // 获取日志记录器
  getLogger(log) {
    if (typeof log === 'function') {
      return log
    }
    if (/^(?:log|error|info|warn|debug)$/.test(log)) {
      return (...args) => console[log](...args)
    }
    return log === false
      ? () => {}
      : (...args) =>
          args[0] instanceof Error
            ? console.error(args[0].message)
            : console.log(...args)
  }

  // 获取已声明的依赖数量
  getDependencyAmount() {
    return ['dependencies', 'devDependencies', 'peerDependencies'].reduce(
      (amount, type) => amount + Object.keys(this.npmPackage[type]).length,
      0
    )
  }
}
