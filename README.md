
<p align="center"><h1 align="center">
  check-dependency-engines
</h1>

<p align="center">
   A tool for analyzing dependencies.
</p>

# About

<p align="center">
  Check engines requirements of the dependency, and find the version of the dependency that meets the minimum engine version requirements of the current project through metadata.
</p>

# Install

Used as a cli util:
```bash
npm i check-dependency-engines -g
```

Used as a dev util:
```bash
npm i check-dependency-engines -D
```

# Usage

As a cli util:

```bash
> check-dependency-engines
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

As a package:

```js
;(async () => {
  const Checker = require('check-dependency-engines')
  const ck = new Checker({
    cwd: process.cwd(), // current working dir
    registry: 'https://npm.registry.some.domain', // npm registry for download metadata
    preRelease: false, // should match pre-release version of dependency
    exact: true, // should use exact version when update matched version of dependency
    update: true, // should auto update package.json when there ara some changes
    log: 'log', // can be a string as log level (log、warn、error) or a function, or false to disable.
  })
  const data = await ck.verify()
  // the data is an object that contains all dependency info.
})()
```

# Author

**check-dependency-engines** © [Stone](https://github.com/star2018), Released under the [MIT](./LICENSE) License.
