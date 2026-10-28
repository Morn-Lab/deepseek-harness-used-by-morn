# 来源与改动说明

## qq-agent/

`qq-agent/` 是 [`K0nd1us/QQ-agent`](https://github.com/K0nd1us/QQ-agent)（MIT，Copyright (c) 2026 Kondius）的 **0.5 分支快照**，离线取自本地浅克隆。

- 上游基准：提交 `789c7f7`（2026-10-26，"feat: sync rules editor, appearance customization and SnowLuma fixes"）。
- 本仓库不跟踪上游：不 pull、不 push、不提 issue；上游后续提交（如 `18e11d7`）没有合进来。
- 许可证沿用上游 MIT，全文见根目录 [LICENSE](LICENSE)。

本地相对上游基准的改动（截至 2026-10-28）：

| 文件 | 改动 |
| --- | --- |
| `src/kernel/vision-note.js` | 新增：看图后生成"图档"文本（sha256 缓存、串行队列、25s 超时、本地端点优先） |
| `src/kernel/agent-runner.js` | 接入 `applyVisionNotes`：媒体补发前把图像 part 换成图档文本，同一轮再看同一张图仍发原图 |
| `test/308-vision-note-test.mjs` | 新增：14 个用例 / 88 断言 |
| `test/run-m3.mjs` | 登记 308 用例 |
| `start-vision-service.bat` | 新增：启动本地 llama.cpp 视觉服务（含 4 条前置校验） |
| `docs/vision-service.md`、`docs/vision-provenance.md`、`docs/install-and-layout.md` | 新增：安装、实测数据、模型与运行时来源校验 |

## harness/

本机环境记录与下载脚本，原创内容，不含第三方代码。

## 本仓库不包含

`node_modules/`、`models/`（Qwen3-VL-2B GGUF）、`tools/`（llama.cpp 运行时）、`data/`（账号与会话数据）、`data-plugin-runtime/`，以及本机其他工作区。它们都在 `.gitignore` 里；模型与运行时的来源、字节数、sha256 见 `qq-agent/docs/vision-provenance.md`。
