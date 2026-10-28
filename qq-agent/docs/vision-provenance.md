# 模型来源与校验（2026-10-28 下载）

> 只从**官方组织**的仓库取，且每个文件都用上游记录的 sha256 校验过。校验值来自
> HuggingFace 的 LFS 元数据（`lfs.sha256`）与 GitHub Release 的 `digest`，不是第三方转述。

## models\vision\model.gguf

| 项 | 值 |
|---|---|
| 上游仓库 | `Qwen/Qwen3-VL-2B-Instruct-GGUF`（阿里 Qwen 官方组织） |
| 上游文件 | `Qwen3VL-2B-Instruct-Q4_K_M.gguf` |
| 下载地址 | `https://hf-mirror.com/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3VL-2B-Instruct-Q4_K_M.gguf` |
| 本地文件名 | `model.gguf`（`start-vision-service.bat` 固定读这个名字） |
| 大小 | 1,107,409,952 字节（1,056.1 MiB） |
| sha256 | `089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae` |
| 许可证 | Apache-2.0 |

## models\vision\mmproj.gguf

| 项 | 值 |
|---|---|
| 上游仓库 | 同上 |
| 上游文件 | `mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf` |
| 下载地址 | `https://hf-mirror.com/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf` |
| 本地文件名 | `mmproj.gguf` |
| 大小 | 445,053,216 字节（424.4 MiB） |
| sha256 | `f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82` |
| 许可证 | Apache-2.0 |

## tools\llama.cpp\（推理运行时）

| 项 | 值 |
|---|---|
| 上游 | `ggml-org/llama.cpp` 官方 Release `b11946`（2026-10-28 发布） |
| 文件 | `llama-b11946-bin-win-cuda-13.4-x64.zip` |
| 下载地址 | `https://gh-proxy.com/https://github.com/ggml-org/llama.cpp/releases/download/b11946/llama-b11946-bin-win-cuda-13.4-x64.zip` |
| 大小 / digest | 164,880,776 字节 / `5ac28ef7b3bb539698d3044243ff13d817ada9081cc41a6404267993dd7ee23c` |
| 文件 | `cudart-llama-bin-win-cuda-13.4-x64.zip`（CUDA 运行时 DLL） |
| 下载地址 | 同上路径，文件名换成该 zip |
| 大小 / digest | 423,535,356 字节 / `738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668` |
| 许可证 | MIT |

当时选择 `cuda-13.4` 而非 `cuda-12.4` 的原因：显卡是 RTX 5060 Laptop（Blackwell / sm_120），
需要 CUDA 12.8+ 的工具链；驱动 617.42 满足 CUDA 13.x。

## 重新校验的办法

```powershell
Get-FileHash models\vision\model.gguf -Algorithm SHA256
Get-FileHash models\vision\mmproj.gguf -Algorithm SHA256
```

两个值应与上文一致；不一致就说明文件被截断或被替换过，删掉重下。

## 已验证 / 未验证

- 已验证：sha256 全部匹配；`llama-server.exe` 能识别 `CUDA0: NVIDIA GeForce RTX 5060 Laptop GPU`；
  模型 + mmproj 加载成功；`/v1/chat/completions` 传图能返回四行图档（见 `docs\vision-service.md`）。
- 未验证：长时间运行稳定性、不同图片类型（动图、截图、低分辨率表情包）的图档质量。
