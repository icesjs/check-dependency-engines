//
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
    development,
    preRelease = false,
    cwd = process.cwd(),
    registry = registryUrl(),
  }) {
    this.logger = this.getLogger(log)
    this.loggerDisabled = log === false
    this.autoUpdateAfterCheck = !!update
    this.useExactVersionWhenUpdate = !!exact
    this.allowPreRelease = !!preRelease
    this.onlyUpdateDevDependencies = !!development
    this.cwd = cwd
    this.registry = `${`${registry}`.replace(/\/+$/, '')}/`

    // 需要更新的依赖类型
    this.depsTypeForUpdate = this.onlyUpdateDevDependencies
      ? ['devDependencies']
      : ['dependencies', 'peerDependencies', 'optionalDependencies']

    try {
      this.npmPackage = this.getNpmPackage()
      // 当前工程的引擎要求
      this.projectRequiredEngines = this.npmPackage.engines || null
    } catch (e) {
      this.logger(chalk.red(e.message))
      return
    }

    // 依赖包的总数
    this.dependencyAmount = this.getDependencyAmount()

    if (this.projectRequiredEngines) {
      // 期待的最小引擎版本号
      const { node, npm } = this.projectRequiredEngines
      this.minProjectEngineVersion = {
        node: node ? semver.minVersion(node) : '',
        npm: npm ? semver.minVersion(npm) : '',
      }
    }
  }

  // 获取当前工作目录下的package.json
  getNpmPackage() {
    const pkg = require(path.join(this.cwd, './package.json'))
    for (const prop of this.depsTypeForUpdate) {
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
    const { data } = this.formatData(await this.fetchMetaData())
    return data
  }

  // 检查依赖并进行package.json文件更新操作
  async check() {
    if (!this.verifiable()) {
      return []
    }
    const { node, npm } = this.minProjectEngineVersion
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
    this.logger(
      `Check the packages declared by ${chalk.cyan(
        this.depsTypeForUpdate.join(', ')
      )}`
    )
    // 分析并打印信息
    const updated = this.printTable(this.formatData(await this.fetchMetaData()))
    if (updated.length && this.autoUpdateAfterCheck) {
      // 更新package.json文件
      await writePackage(this.cwd, this.npmPackage, { normalize: true })
      this.logger(`Successfully updated package.json`)
    } else {
      this.logger(`Analyse completed`)
    }
    return updated
  }

  // 是否可验证的
  verifiable() {
    if (!this.minProjectEngineVersion) {
      return false
    }
    const { node, npm } = this.minProjectEngineVersion
    if (!node && !npm) {
      this.logger('No version requirements for engine in this project')
      return false
    }
    if (!this.dependencyAmount) {
      this.logger('No declared dependencies in this project')
      return false
    }
    return true
  }

  // 以表格形式打印
  printTable({ data, errors }) {
    const updatedDependencies = []
    const records = [
      // 表头
      ['Dependency Type', 'Dependency Declared', 'Version Details'],
    ]
    //
    for (const [type, obj] of Object.entries(data)) {
      for (const [name, item] of Object.entries(obj)) {
        const { installed, satisfied, latest, declaredRange, error } = item
        const updatable = this.isUpdatable(declaredRange, satisfied, latest)

        // 第一列
        const typeDesc = `${type}\n\n${chalk.gray(
          type === 'devDependencies' ? 'development' : 'production'
        )}`

        // 第二列
        const validDeclaredRange = semver.validRange(declaredRange)
        let declared = updatable ? chalk.yellow(name) : chalk.cyan(name)
        if (!installed) {
          declared += `  ${chalk.red('not install')}`
        }
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
        } else if (error) {
          declared += `\n\n${chalk.red('fetch failed')}`
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
        records.push([typeDesc, declared, details.join('\n')])
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
    if (errors.length) {
      this.logger(`Can not fetch metadata for these package:`)
      this.logger(
        errors
          .map(
            ({ name, message }) => `${chalk.cyan(name)} : ${chalk.red(message)}`
          )
          .join('\n')
      )
    }
    return updatedDependencies
  }

  // 获取更新后的版本范围
  getUpdatedRange(installed, satisfied, declared) {
    const validRange = semver.validRange(declared)

    if (validRange) {
      if (semver.ltr(satisfied, declared)) {
        // 匹配版本小于声明版本范围
        return satisfied
      }

      if (semver.satisfies(satisfied, declared)) {
        // 匹配版本在声明范围之中
        if (this.useExactVersionWhenUpdate || satisfied === declared) {
          // 使用精确版本
          // 如果安装版本大于匹配版本，实际上是做了降低版本处理
          // 如果安装版本小于匹配版本，实际上是做了升级版本处理
          return satisfied
        }
        // 使用范围版本
        if (validRange === '*') {
          return `<=${satisfied}`
        }

        return `${declared} <=${satisfied}`
      }

      // 匹配版本大于版本范围:
      // 返回原来的版本范围声明
      //（因为检查是否需要更新此项时判断过交集，实际不会到达这里）
      return declared
    }

    // 没有声明有效的版本范围（不正常的声明）
    // 检查是否已经安装依赖
    if (installed) {
      if (semver.gte(installed, satisfied)) {
        // 安装版本大于或等于匹配版本:
        // 降低至匹配版本
        return satisfied
      }
      if (this.useExactVersionWhenUpdate) {
        // 要求精确化版本，使用当前安装的版本
        return installed
      }
      // 应用版本范围
      if (semver.major(installed) < semver.major(satisfied)) {
        // 安装版本的主版本小于匹配版本的主版本
        // 返回锁定主版本的版本范围
        return `^${installed}`
      }
      if (semver.minor(installed) < semver.minor(satisfied)) {
        // 安装版本的主版本等于匹配版本，次版本小于匹配版本
        // 锁定次版本
        return `~${installed}`
      }
      // 主版本次版本相同
      // 升级补丁版本
      return satisfied
    }

    // 没有正确声明依赖版本范围，也没有安装此依赖
    return `${this.useExactVersionWhenUpdate ? '' : '<='}${satisfied}`
  }

  // 是否是需要更新
  isUpdatable(declaredRange, satisfied, latest) {
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
    if (semver.intersects(range, `>${satisfied}`)) {
      return this.useExactVersionWhenUpdate || latest !== satisfied
    }
    return false
  }

  // 获取已安装包的信息
  getInstalledPkg(name) {
    let pkg = { version: '', engines: null }
    const filter = ({ version, engines }) => {
      pkg.version = version
      pkg.engines = engines
    }
    try {
      resolve.sync(name, {
        basedir: this.cwd,
        packageFilter: filter,
      })
    } catch (e) {}
    return pkg
  }

  // 对依赖要求的引擎版本范围进行匹配
  matchRange(meta) {
    const allowBeta = this.allowPreRelease
    const { engines, version } = meta
    if (!allowBeta && semver.prerelease(version)) {
      // 不匹配预发布版本
      // 当前版本为预发布版本，不满足要求
      return false
    }
    if (!engines) {
      // 依赖包没有引擎要求
      return true
    }
    const { node: minNode, npm: minNpm } = this.minProjectEngineVersion
    const opt = { includePrerelease: allowBeta }
    const { node, npm } = Object.assign({}, engines)
    const nodeFailed = minNode && node && !semver.satisfies(minNode, node, opt)
    const npmFailed = minNpm && npm && !semver.satisfies(minNpm, npm, opt)
    return !(nodeFailed || npmFailed)
  }

  // 格式化结果数据
  formatData({ errors, data }) {
    const npmPkg = this.npmPackage
    const mockPkg = this.depsTypeForUpdate.reduce((obj, type) => {
      obj[type] = {}
      return obj
    }, {})
    for (const [deps, packs] of data) {
      for (const key of this.depsTypeForUpdate) {
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
              error: errors.filter((err) => err.name === name)[0],
            }
            if (
              this.isUpdatable(declaredRange, matchedVersion, latestVersion)
            ) {
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
    return { errors, data: mockPkg }
  }

  // 获取依赖的元数据信息
  async fetchMetaData() {
    const data = new Map()
    const errors = []
    this.logger(`Fetching meta data from ${this.registry}`)
    const tick = this.createProgressBar(this.dependencyAmount)
    for (const deps of this.depsTypeForUpdate.map(
      (type) => this.npmPackage[type]
    )) {
      data.set(deps, {})
      // 请求元数据
      for (const [name, range] of Object.entries(deps)) {
        tick.update({ name })
        const pkg = (data.get(deps)[name] = {
          name,
          declaredRange: range,
          meta: await this.fetch(name).catch((e) => {
            errors.push({
              name,
              error: e,
              message: e.message,
            })
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
      this.logger(chalk.red(`Some errors occurred while fetch meta data:`))
    } else {
      this.logger('Successfully Fetched all meta data')
    }
    return { errors, data }
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
    return this.depsTypeForUpdate.reduce(
      (amount, type) => amount + Object.keys(this.npmPackage[type]).length,
      0
    )
  }
}
