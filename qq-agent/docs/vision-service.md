# 本地视觉服务（image → 文字图档）

赛博宠物的"看图"不靠主模型：图片先由一个**本地视觉模型**转成 4 行文字图档，再进主模型上下文。
主模型永远看不到像素，图片 token 归零；本地推理不花钱，历史里留下的是文字。

- 代码：`src/kernel/vision-note.js`、接入点 `src/kernel/agent-runner.js`（媒体补发处）
- 启动脚本：`start-vision-service.bat`
- 缓存：`<数据目录>/vision-notes.json`（sha256 键、上限 400 条、先进先出）

## 1. 需要准备什么

| 东西 | 放哪 | 说明 |
|---|---|---|
| `llama-server.exe` | `tools\llama.cpp\llama-server.exe`（或 PATH / `%LOCALAPPDATA%\llama.cpp\`） | 取自 llama.cpp 的 `win-cuda-x64` 或 `win-cpu-x64` 发布包 |
| 视觉模型 | `models\vision\model.gguf` | 量大、量化档 Q4_K_M 起 |
| 视觉投影器 | `models\vision\mmproj.gguf` | **必须**，缺了模型就是"瞎子" |

本机访问不了 huggingface.co，只走镜像：`https://hf-mirror.com` 或 `https://modelscope.cn`。
脚本只校验文件在不在，不会替你下载几个 GB。

**本机已经装好了**（2026-10-28）：llama.cpp `b11946`（CUDA 13.4 构建，含 CUDA 运行时 DLL）
+ Qwen3-VL 2B Instruct `Q4_K_M` + `mmproj Q8_0`，合计约 2.1GB。来源、sha256、许可证见
[`vision-provenance.md`](vision-provenance.md)；`tools\` 与 `models\` 已加进 `.gitignore`，不会误入库。

> 下载渠道说明：模型来自阿里 Qwen 官方组织 `Qwen/Qwen3-VL-2B-Instruct-GGUF`（Apache-2.0），
> 走 hf-mirror；运行时来自 `ggml-org/llama.cpp` 官方 Release，走 `gh-proxy.com` 镜像（GitHub 直连只有
> ~12KB/s）。每个文件都按上游记录的 sha256 校验通过。


## 2. 选哪个模型

按"便宜 + 中文/表情包/番剧认得准"排：

- **MiniCPM-V 4.7 1B**（Apache-2.0）：最小，Q4_K_M 约 1GB，显存占用最低，端侧默认档。
- **Qwen3-VL 2B**（Apache-2.0）：Q4_K_M 约 1.5–2GB，中文、OCR、表情包/番剧更强，识别质量优先时选它。
- **Moondream 2B**：英文场景快，中文一般。

一台 8GB 显存的机器上，视觉服务和出图（DreamLite）**不能同时常驻**：出图前先关掉这个窗口，
或者用 `VISION_GPU_LAYERS=0` 让它退到 CPU（慢但让出显存）。

## 3. 启动

```
start-vision-service.bat
```

脚本做的事：找 `llama-server.exe` → 校验 gguf/mmproj → 查端口占用 → 起服务 → 打印要填进 app 的地址。

可调环境变量：

| 变量 | 默认 | 用途 |
|---|---|---|
| `VISION_PORT` | 8080 | 监听端口（占用时换一个） |
| `VISION_CTX` | 8192 | 上下文长度；图档只发单图 + 短提示词，4096 也够 |
| `VISION_GPU_LAYERS` | 99 | 上多少层到 GPU；设 0 = 纯 CPU，给显存腾地方 |

## 4. 在 app 里怎么配

1. 渠道里加一个 `baseURL = http://127.0.0.1:8080/v1` 的 provider（API Key 随便填，本地不校验）。
2. 模型配置里把**视觉模型**指到这个渠道下的任意模型名（名字不影响，llama-server 只跑一个模型）。
3. 视觉开关保持打开。

只要**视觉模型留空**，整条图档链路就是惰性的——行为和以前完全一样。

## 5. 怎么确认它在工作

- `curl http://127.0.0.1:8080/v1/models` 有返回即服务活着。
- 让宠物看一张图，看 `data\vision-notes.json` 是否多了一条，且日志里没有 `[vision-note] 生成图档失败`。
- 想临时退回旧行为（发原图）：启动 app 前设 `QQ_AGENT_VISION_NOTE=off`。

## 6. 实测数据（2026-10-28，RTX 5060 Laptop 8GB / i7-255HX）

| 指标 | 实测值 |
|---|---|
| 启动到能响应 | 约 2 秒（`--no-warmup`，模型 1GB + mmproj 424MB） |
| 显存占用（8192 ctx，全部层上 GPU） | 2772 MiB / 8151 MiB |
| 出图档耗时（640×360 纯色测试图） | 约 0.7 秒 |
| 出图档耗时（1565KB 照片，4025 prompt token） | 约 3.6 秒 |
| 生成速度 | 约 50–60 token/s |
| 一条图档样例 | `主体=发光的球体` / `画面=渐变的紫色和红色光晕` / `文字=无` / `细节=柔和的光晕边缘` |

参数上有一条是**必须**的：`--image-min-tokens 1024`。llama.cpp 对 Qwen-VL 会给警告
"require at minimum 1024 image tokens to function correctly on grounding tasks"，
不加的话模型经常答"无"，认不出画面内容。`start-vision-service.bat` 已经带上这个参数。

## 7. 已知的坑

- 提示词要用**标签式四行**（`主体=` / `画面=` / `文字=` / `细节=`），不要写"严格输出4行"这类元指令：
  2B 模型会把后者理解成编号列表，输出成 `1. 无 / 2. 无 / …`。`src/kernel/vision-note.js` 的
  `NOTE_PROMPT` 就是按实测结果定的，别随手改回去。
- 图档输出上限 `NOTE_MAX_TOKENS = 220`：不设上限时模型会顺着往下解释，图档变长但信息没变多。
- 服务只监听 127.0.0.1、没有 API key，日志会警告 "no API key is set and CORS allows all origins"；
  只在本机用是可以接受的，别把 8080 映射到公网。

## 8. 当前未验证的部分

- 长时间运行的稳定性（连续几百张图、缓存文件增长）。
- 动图 / 低分辨率表情包 / 长截图这几类图的图档质量。
- llama.cpp 对 MiniCPM-V 4.7 1B 的 mmproj 支持（只验证了 Qwen3-VL 2B）。

跑起来后如果 `[vision-note]` 一直报错，把 llama-server 窗口里的原文发我，按错误码定位（多半是 mmproj 版本不匹配或 chat 模板问题）。
