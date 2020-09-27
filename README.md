# @ices/check-dependency-engines

<p>
   A tool for analyzing dependencies.
</p>

# About

<p>
  Check engines requirements of the dependency, and find the version of the dependency that meets the minimum engine version requirements of the current project through metadata.
</p>

# Install

Used as a cli util:
```bash
npm i @ices/check-dependency-engines -g
```

or run without install:
```bash
npx @ices/check-dependency-engines
```

<p>
By default, only the dependencies for production will be analyzing, you can use the -D arg to analyze dev dependencies.
</p>

Used as a dev util:
```bash
npm i @ices/check-dependency-engines -D
```

# Usage

As a cli util:

```bash
> check-engines
```

Options:
*  --help, -h                  Show help                               
*  --version, -v               Show version number                     
*  --allow-pre-release, -p     Allow match pre-release version        
*  --exact, -e                 Use exact version when update          
*  --disable-auto-install, -t  Disable auto install after update      
*  --update, -u                Auto update package.json file        
*  --cwd, -d                   Current Working Directory      
*  --registry, -r              Registry url for npm repository
*  --development, -D           Only update the devDependencies
*  --quiet, -q                 Disable the logs


As a package:

```js
;(async () => {
  const Checker = require('@ices/check-dependency-engines')
  const ck = new Checker({
    cwd: process.cwd(), // current working dir
    registry: 'https://registry.some.domain', // npm registry for download metadata
    preRelease: false, // should match pre-release version of dependency
    exact: true, // should use exact version when update matched version of dependency
    update: true, // should auto update package.json when there ara some changes
    log: 'log', // can be a string as log level (log、warn、error) or a function, or false to disable.
    development: false, // set only run with devDependencies.
  })
  const data = await ck.verify()
  // the data is an object that contains all dependency info.
})()
```

# Author

**@ices/check-dependency-engines** © [Stone](https://github.com/icesjs), Released under the [MIT](./LICENSE) License.
