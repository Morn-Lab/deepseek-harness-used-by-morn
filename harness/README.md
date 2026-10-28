# harness/

本机 DeepSeek Harness 侧的环境记录与可复现脚本。和 `qq-agent/` 分开：这边只留"换个机器也能照着重做一遍"的信息，不含业务代码。

- `env.md` —— 2026-10-28 在本机实测过的环境事实：Node/npm 从哪来、哪些镜像通、速度多少、撞过哪些坑。
- `scripts/download-verified.ps1` —— 带 sha256 校验、支持镜像前缀、可重试的下载器；模型与运行时都用它下。

原则：**凭据不落库**。任何 token、API key、密码都不写进这个目录，也不写进提交。
