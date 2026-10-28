# deepseek-harness

本机两套东西的版本化归档，**私有仓库**。只放源码、文档与可复现脚本；依赖、模型权重、运行时与账号数据不进库。

```
deepseek-harness/
├── qq-agent/     # 赛博宠物 QQ 机器人 0.5（源码 + 文档），工作副本在 Documents\qq-agent\0.5(unfinished)
└── harness/      # 本机环境记录与可复现脚本（Node/npm 装法、镜像渠道、带校验的下载器）
```

## 提交身份

`Morn <349269406+Morn-Lab@users.noreply.github.com>`，即 GitHub 的 noreply 中转地址：由「账号数字 id + 登录名」自动拼成，提交会归属到 `Morn-Lab` 账号，真实邮箱不出现在任何提交里。

## qq-agent/

赛博宠物 0.5 的源码与文档快照。仓库里**没有**这些（都在 `.gitignore` 里）：

- `node_modules/`（341 个包 + electron 运行时）
- `models/`、`tools/`（Qwen3-VL-2B GGUF 与 llama.cpp，约 2.2GB，按机器下载）
- `data/`（账号、会话、日志、锁文件）
- `data-plugin-runtime/`（运行时插件目录，可能是 junction 集合）

装依赖、启动、路径对照见 `qq-agent/docs/install-and-layout.md`；本地视觉服务见 `qq-agent/docs/vision-service.md`，模型与运行时的来源校验见 `qq-agent/docs/vision-provenance.md`。

## harness/

`harness/env.md` 记本机实测过的环境事实与踩坑；`harness/scripts/download-verified.ps1` 是带 sha256 校验、可换镜像的下载器，当初下载 Qwen3-VL GGUF 与 llama.cpp 就是这套流程（见 provenance 表）。

## 版本边界

- 本仓库是快照，不是工作副本。改代码在 `Documents\qq-agent\0.5(unfinished)` 里改，再同步过来。
- 不追踪 `K0nd1us/QQ-agent` 上游：本地那份浅克隆停在 `789c7f7`（2026-10-26），不 pull、不 push、不提 issue。
