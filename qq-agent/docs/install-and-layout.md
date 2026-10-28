# 安装、目录归属与迁移记录

记录 2026-10-28 的工作副本迁移、依赖安装步骤与踩过的坑。目的是下次重装、换机、或隔几个月再装时不用重新试错。

## 1. 工作副本在哪里

| 内容 | 路径 |
| --- | --- |
| **工作副本（唯一权威）** | `%USERPROFILE%\Documents\deepseek-harness\qq-agent` |
| 仓库根（git 在这里） | `%USERPROFILE%\Documents\deepseek-harness` |
| 迁移前的副本（已归档，可删） | `%USERPROFILE%\Documents\deepseek-harness_archive\2026-10-28-qq-agent-move\` |
| 更早的副本（已归档） | `%USERPROFILE%\Documents\deepseek-harness_archive\2026-10-28-qq-agent-0.5-source\qq-agent\0.5(unfinished)` |
| 原 git 仓库（现在只剩 0.4 与历史） | `<会话工作区>\qq-agent` |

- 迁移历史：会话工作区 → `Documents\qq-agent\0.5(unfinished)`（提交 `372481d`，未 push）→ 2026-10-28 晚**移进仓库** `Documents\deepseek-harness\qq-agent`，成为唯一一份工作副本。
- 迁移原因：旧位置在 `.dsh\sessions\...` 会话工作区内，换工作区或重装 DSH 后路径失效，而桌面快捷方式指向它；再往外挪是为了让代码和它的版本控制待在一起，不再有"副本漂移"。
- **现在只有一份源码。** `models/`、`tools/`、`node_modules/`、`data/` 跟着搬了过来，但都在 `.gitignore` 里，不进仓库、不上 GitHub。

## 2. 依赖安装（两条命令）

本机没有系统级 Node/npm。用 DSH 运行时自带的 node + 独立安装的 npm：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$npm  = "$env:LOCALAPPDATA\npm-cli\bin\npm-cli.js"
Set-Location "$env:USERPROFILE\Documents\deepseek-harness\qq-agent"

# 命令 1：装依赖（--allow-remote=all 必须带，原因见第 3 节）
& $node $npm ci --no-audit --no-fund --allow-remote=all --registry=https://registry.npmmirror.com

# 命令 2：手动补跑 electron 的 postinstall（npm 12 默认拦安装脚本）
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
Push-Location node_modules\electron
& $node install.js
Pop-Location
```

两条命令的实测耗时：装依赖约 5 秒（341 个包），electron 二进制约 10 秒（180 MB，走 npmmirror）。
走 GitHub 直连同一文件只有约 12 KB/s，会卡几十分钟，所以务必设 `ELECTRON_MIRROR`。

验证安装完整：

```powershell
Test-Path .\node_modules\electron\dist\electron.exe      # 应为 True
.\node_modules\electron\dist\electron.exe --version      # 能打印版本号即运行时可用
```

如果 `%LOCALAPPDATA%\npm-cli` 不存在（新机器），先装一个独立 npm：

```powershell
$meta = Invoke-RestMethod 'https://registry.npmjs.org/npm/latest'
Invoke-WebRequest $meta.dist.tarball -OutFile "$env:TEMP\npm.tgz"
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\npm-cli" | Out-Null
tar -xzf "$env:TEMP\npm.tgz" -C "$env:LOCALAPPDATA\npm-cli" --strip-components=1
```

## 3. 两个必须知道的坑

### 坑 1：`EALLOWREMOTE`——锁文件跨源被拒

```
npm error code EALLOWREMOTE
npm error Fetching packages of type "remote" have been disabled
npm error Refusing to fetch "https://registry.npmmirror.com/yocto-queue/-/yocto-queue-0.1.0.tgz"
```

原因：`package-lock.json` 里有 322 个包的 `resolved` 指向 `registry.npmmirror.com`、19 个指向 `registry.npmjs.org`。npm 12 默认只信任当前 registry，跨源 tarball 会被当成 "remote" 拒绝。
修法：命令 1 里的 `--allow-remote=all`（顺带用 `--registry=https://registry.npmmirror.com` 提速，国内 1.7 MB/s 量级）。

### 坑 2：安装脚本被拦截——electron 只有壳没有二进制

```
npm warn install-scripts 2 packages had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   electron@33.4.11 (postinstall: node install.js)
```

npm 12 默认不跑 postinstall。结果是 `node_modules\electron` 存在、但 `dist\electron.exe` 不存在，双击 `启动QQ机器人.bat` 会直接报：

```
Electron runtime not found: "...\node_modules\electron\dist\electron.exe"
Run npm install before starting QQ Agent.
```

修法就是命令 2（手动执行 `install.js`）。不要用 `npm install-scripts approve`，那会改 `package.json`、产生仓库 diff。

## 4. 日常启动顺序

1. 双击桌面 `赛博宠物-视觉服务` —— 起本地 llama.cpp 视觉服务（`127.0.0.1:8080`）。黑色控制台窗口是服务本体，**不要关**。
2. 双击桌面 `赛博宠物-启动机器人` —— 起 Electron 机器人界面。

两个快捷方式都指向 `%USERPROFILE%\Documents\deepseek-harness\qq-agent`，工作目录也设成它（脚本按相对路径找 `tools\`、`models\`、`node_modules\`）。

视觉服务排障见 `docs/vision-service.md`（启动参数、`--image-min-tokens 1024` 的原因、实测延迟）。
文件来源与 sha256 校验见 `docs/vision-provenance.md`。

## 5. 快捷方式怎么恢复

如果桌面图标丢了，重建命令（PowerShell）：

```powershell
$d = "$env:USERPROFILE\Documents\deepseek-harness\qq-agent"
$w = New-Object -ComObject WScript.Shell

$s = $w.CreateShortcut("$env:USERPROFILE\Desktop\赛博宠物-视觉服务.lnk")
$s.TargetPath = "$d\start-vision-service.bat"; $s.WorkingDirectory = $d
$s.IconLocation = "$env:LOCALAPPDATA\CyberPet\vision-service.ico,0"; $s.Save()

$b = $w.CreateShortcut("$env:USERPROFILE\Desktop\赛博宠物-启动机器人.lnk")
$b.TargetPath = "$d\启动QQ机器人.bat"; $b.WorkingDirectory = $d
$b.IconLocation = "$env:LOCALAPPDATA\CyberPet\bot.ico,0"; $b.Save()
```

图标文件在 `%LOCALAPPDATA%\CyberPet\`（由 `assets\icon.png` 转换，不占仓库）。丢了就再用 Pillow 转一次，或删掉 `IconLocation` 行用默认图标。

## 6. 版本控制（仓库根 = 上一层）

git 仓库在 `%USERPROFILE%\Documents\deepseek-harness`，本目录是它的子目录 `qq-agent/`。远端是 GitHub **公开**仓库 `Morn-Lab/deepseek-harness-used-by-morn`（MIT，`main`）。

- 身份：仓库内局部配置 `Morn <349269406+Morn-Lab@users.noreply.github.com>`，对应 GitHub 账号 `Morn-Lab`（未写全局配置）。
  这是 GitHub 的 noreply 中转地址，由「账号数字 id + 登录名」自动拼成：不需要注册、不设密码，用它提交同样归属到账号，但不暴露真实邮箱。
  真实邮箱只保存在 GitHub 后台，不进任何提交对象；要换身份用 `git config user.email <新地址>`，只影响之后的提交。
- 已排除（项目 `.gitignore`）：`qq-agent/node_modules/`（355 MB）、`qq-agent/models/`（1481 MB）、`qq-agent/tools/`（731 MB）、`qq-agent/data/`（账号与会话数据）、`qq-agent/data-plugin-runtime/`、`qq-agent/plugins/`、`*.log`，以及同级工作区 `/default-workspace/`、`/工作区2/`。
- 因此仓库里只有代码与文档；`git status` 干净说明运行时目录都被挡住了。
- 日常用法：在仓库根（或本目录）改完先 `git status` 看差异，`git add -A && git commit -m "..."`，再 `git push`。撤销靠 `git restore` / `git checkout`。

## 7. 坑：整目录搬家后 `data-plugin-runtime` 里的 junction 会失效

`qq-agent/data-plugin-runtime/<插件id>/app/<子项>` 下有 **595 个 junction**，全部指回项目自己的子目录（`assets/`、`build/`、`data/`、`docs/`、`electron/` 等），目标是**绝对路径**。

- 用 `Move-Item` 整体搬目录时它们会原样跟着走，但目标仍指向旧绝对路径 → 全部变成死链接。
- 修法：搬之前先抓清单（相对路径 + 相对目标），搬之后逐个 `Remove-Item`（只删链接本身，别递归）再 `New-Item -ItemType Junction` 重建。
- 删 junction 不要用 `Remove-Item -Recurse`，PS 5.1 会跟进目标目录真删内容；用 `[System.IO.Directory]::Delete($path, $false)`。
- 另外：如果目录里还留着旧的 `cmd.exe` 窗口（双击 bat 留下的黑框），它的当前目录会把整个目录钉住，`Move-Item` 直接报"另一个进程正在使用此文件"。搬家前先关掉这些窗口。
