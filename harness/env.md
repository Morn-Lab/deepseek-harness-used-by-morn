# 本机环境与网络事实（2026-10-28 实测）

只写实测过的，不写推测。换机器/换网络后这些数字可能失效，重测再改。

## 硬件

| 项 | 值 | 怎么测的 |
| --- | --- | --- |
| GPU | NVIDIA GeForce RTX 5060 Laptop GPU，显存 8151 MiB（可用 8123 MiB） | `nvidia-smi` / `llama-server --list-devices` |
| 驱动 | 617.42 | `nvidia-smi` |
| CUDA Toolkit | **未安装**（`C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA` 不存在，System32 无 `cudart64_*.dll`） | `Test-Path` / `Get-ChildItem` |
| CPU / 内存 | Intel Core Ultra 7 255HX / 15.4 GB | `Get-CimInstance Win32_Processor/ComputerSystem` |

注意：PowerShell 的 `Win32_VideoController.AdapterRAM` 只报 4GB，是 32 位字段截断，**不是真实显存**，以 `nvidia-smi` 为准。

RTX 5060 是 Blackwell（sm_120），需要 CUDA 12.8+ 的工具链；官方预编译包选 `cuda-13.4`。

## Node / npm

系统里**没有** node 和 npm。可用的 node 来自 DSH 自带的运行时：

```
C:\Users\morn\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe   # v24.21.0
C:\Users\morn\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs
```

需要 npm 时单独装一份（不污染系统）：

```powershell
$dst = "$env:LOCALAPPDATA\npm-cli"
Invoke-WebRequest "https://registry.npmjs.org/npm/latest" -OutFile "$env:TEMP\npm.json"
$t = (Get-Content "$env:TEMP\npm.json" -Raw | ConvertFrom-Json).tarball
Invoke-WebRequest $t -OutFile "$env:TEMP\npm.tgz"
New-Item -ItemType Directory -Force $dst | Out-Null
tar -xzf "$env:TEMP\npm.tgz" -C $dst --strip-components=1
# 之后：& "<node.exe>" "$dst\bin\npm-cli.js" ci
```

## 网络与镜像（实测速度/状态）

`web_fetch` / 浏览器 fetch 走的通道和 `pwsh` 的 `Invoke-WebRequest` **不是一回事**：前者访问 huggingface.co、raw.githubusercontent.com、modelscope.cn 都失败，后者部分可达。要下载就用 `pwsh` 或 `curl.exe`。

| 目标 | 结果 |
| --- | --- |
| `hf-mirror.com` | 200，约 1.7 MB/s |
| `github.com` 直连 Release | 200，但稳定只有 **约 12 KB/s** |
| `gh-proxy.com/<GitHub 原始 URL>` | **约 6.4 MB/s**，本次唯一好用的 GitHub 加速 |
| `objects.githubusercontent.com` | HEAD 根路径 404 |
| `ghproxy.net` | 超时 |
| `ghfast.top` / `ghproxy.1888866.xyz` | 403 |
| `gh.ddlc.top` | 429 |
| `github.moeyy.xyz` / `gh.llkk.cc` / `ghproxy.cc` / `gitproxy.click` / `hub.whtrys.space` | 无响应 |
| `gh.con.sh` | 302 之后掉到 ~91 B/s |
| `registry.npmjs.org` / `registry.npmmirror.com` | 608 ms / 139 ms，均 200 |

## 校验做法（"安全渠道"的实际含义）

镜像只当传输管道，落盘前用上游记录的哈希比对，不是靠信任镜像：

- HuggingFace 镜像 API：`https://hf-mirror.com/api/models/<repo>?blobs=true` → 每个文件的 `lfs.sha256`。
- GitHub API：`/repos/<owner>/<repo>/releases/tags/<tag>` 的每个 asset 带 `digest: sha256:...`。
- 落地后：`Get-FileHash <file> -Algorithm SHA256`，不一致就删掉重下。

## 踩过的坑（都是原始报错）

1. `Invoke-WebRequest -Headers @{Range='bytes=0-1023'}` 直接报错 —— PowerShell 5.1 的 `Range` 是受限头。改用 `C:\Windows\System32\curl.exe -r 0-1023`。
2. `curl -C -` 对 0 字节文件会一直挂着不产出，换成普通下载再续。
3. 后台作业里把 hashtable 当 URL 传给 curl：`Could not resolve host: System.Collections.Hashtable`。用 `[pscustomobject]` 并取 `.u` / `.f` 字段。
4. `npm ci` → `npm error code EALLOWREMOTE` / `Fetching packages of type "remote" have been disabled`：`package-lock.json` 里 322 个包 resolved 在 `registry.npmmirror.com`、19 个在 `registry.npmjs.org`，npm 12 默认不跨源。加 `--allow-remote=all --registry=https://registry.npmmirror.com`。
5. npm 默认拦 install script：`electron@33.4.11 (postinstall: node install.js)` 被跳过，`electron.exe` 不存在。手动补跑：
   ```powershell
   cd node_modules\electron
   $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
   & "<node.exe>" install.js
   ```
6. llama.cpp 的 `releases/latest` 只有一个 `nightly-tag.txt`，真正的 Windows 二进制在**每日构建 tag**（如 `b11946`）下面。
7. Qwen-VL 系列在 llama.cpp 里必须给 `--image-min-tokens 1024`，否则日志警告 `Qwen-VL models require at minimum 1024 image tokens`，模型会答"画面里没有内容"。

## 未验证

- 长跑稳定性（视觉服务连续跑几小时）、动图/低清表情包的实际识别质量。
- 换更高版本的 llama.cpp 每日构建后上述参数是否仍然适用。

## 运行 PowerShell 脚本

本机 `Get-ExecutionPolicy` = **Restricted**，直接 `.\download-verified.ps1` 会报"在此系统上禁止运行脚本"。两种跑法：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\download-verified.ps1 -Url ... -OutFile ... -Sha256 ...
# 或用 pwsh（若已安装）：pwsh -NoProfile -File .\scripts\download-verified.ps1 ...
```

脚本参数：`-Mirrors` 给镜像前缀（默认直连），失败依次换；`-Retries` 控制每个镜像重试次数。已用 `file://` 源离线验证三条路径：哈希正确→落地、哈希错误→清理不留残件、已存在且一致→跳过。注意用 `-File` 传参时**不要给 `-Mirrors` 传空数组**，省略它即走默认直连。

