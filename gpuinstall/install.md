# Ollama + Gemma4 离线安装指南

## 目录

- [概述](#概述)
- [核心工具](#核心工具)
- [第一步：下载离线安装包](#第一步下载离线安装包)
- [第二步：目标机器安装 Ollama](#第二步目标机器安装-ollama)
- [第三步：传输并安装模型](#第三步传输并安装模型)
- [第四步：验证运行](#第四步验证运行)
- [切换不同模型](#切换不同模型)
- [常见问题](#常见问题)

---

## 概述

本方案使用 **ollama_offline_downloader.py** 实现类似 `ollama pull` 的离线下载体验。

**核心流程**：
```
python3 ollama_offline_downloader.py gemma4:e4b    # 自动下载 + 进度显示
    ↓
创建正确目录结构 (manifests/ + blobs/)
    ↓
传输到目标机器
    ↓
ollama run gemma4:e4b                              # 直接运行
```

**对比传统方案**：

| 方案 | Modelfile | 复杂度 | 可靠性 |
|------|-----------|--------|--------|
| ~~手动写 Modelfile~~ | ❌ 需要 | 高，易出错 | 依赖查文档 |
| ~~oget 命令行~~ | ✅ 自动 | 中，需解析输出 | 一般 |
| **ollama_offline_downloader.py** | ✅ 自动 | **低，一行命令** | ✅ 高 |

---

## 核心工具

### ollama_offline_downloader.py

自动下载 Ollama 模型到本地目录。

**功能**：
- 自动解析 Ollama registry 获取所有 blob 下载链接
- 自动创建正确的目录结构 (manifests/ + blobs/)
- 多线程并行下载
- 实时进度显示 (单文件 + 总体)
- 断点续传支持
- 下载完成后显示安装命令

**使用方法**：
```bash
# 基本用法
python3 ollama_offline_downloader.py <model>:<tag>

# 指定输出目录
python3 ollama_offline_downloader.py gemma4:e4b --output /path/to/output

# 指定下载线程数
python3 ollama_offline_downloader.py gemma4:e4b --workers 8

# 下载并安装到 Ollama
sudo python3 ollama_offline_downloader.py gemma4:e4b --install --models-path ~/.ollama/models
```

**支持下载的模型**：

所有 Ollama 官方库模型均可通过此工具下载：
- `gemma4:e2b`, `gemma4:e4b`, `gemma4:26b`, `gemma4:31b`
- `glm-5`, `glm-4.7-flash`
- `qwen3:6b`, `qwen3:8b`, `qwen3:32b`
- `deepseek-r1:7b`, `deepseek-r1:14b`
- `llama3.2:3b`, `llama3.2:1b`
- ...以及所有 ollama 库中的模型

---

## 第一步：下载离线安装包

在**联网机器**上执行以下下载：

### 1.1 下载 Ollama 主程序

```bash
cd /home/ubuntu/hermes/gpuinstall

# 下载 Ollama v0.21.0 (~600MB)
wget https://github.com/ollama/ollama/releases/download/v0.21.0/ollama-linux-amd64.tar.zst
```

### 1.2 下载离线下载工具

工具已准备在 `/home/ubuntu/hermes/gpuinstall/ollama_offline_downloader.py`

### 1.3 下载模型

```bash
cd /home/ubuntu/hermes/gpuinstall

# 下载 gemma4:e4b (推荐，编程能力强)
python3 ollama_offline_downloader.py gemma4:e4b --output ./gemma4_e4b --workers 4

# 或下载 gemma4:e2b (更轻量，4GB 显存无压力)
python3 ollama_offline_downloader.py gemma4:e2b --output ./gemma4_e2b --workers 4

# 或下载其他模型
python3 ollama_offline_downloader.py glm-5 --output ./glm5 --workers 4
python3 ollama_offline_downloader.py qwen3:6b --output ./qwen3_6b --workers 4
```

**下载输出示例**：
```
Ollama Offline Downloader
模型: gemma4:e2b
输出: /home/ubuntu/hermes/gpuinstall/gemma4_e2b
线程: 4
ℹ 获取模型信息: gemma4:e2b
Manifest URL: https://registry.ollama.ai/v2/library/gemma4/manifests/e2b
✔ 找到 4 个文件待下载
ℹ 下载 manifest: https://registry.ollama.ai/v2/library/gemma4/manifests/e2b
✔ Manifest 已保存: .../gemma4_e2b/manifests/registry.ollama.ai/library/gemma4/e2b

开始下载 4 个文件 (总计 6.7 GB)
ℹ 按 Ctrl+C 可中断，已下载的文件会自动保留

[2/4] ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 50.0% 3.0 GB/6.7 GB sha256-4e30e266...
[2/4] ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 50.0% 3.0 GB/6.7 GB sha256-4e30e266...
...
✔ 下载完成！
  - 文件数: 4/4
  - 总大小: 6.7 GB
  - 耗时: 60 秒
  - 平均速度: 112 MB/秒

===============================================================
安装到 Ollama (在目标离线机器上执行)
===============================================================
...
```

### 最终传输清单

```
/home/ubuntu/hermes/gpuinstall/
├── ollama-linux-amd64.tar.zst          # Ollama 主程序 (~600MB)
├── ollama_offline_downloader.py         # 下载工具
├── gemma4_e4b/                           # gemma4:e4b 模型文件 (~6.7GB)
│   ├── manifests/
│   │   └── registry.ollama.ai/
│   │       └── library/
│   │           └── gemma4/
│   │               └── e4b
│   └── blobs/
│       ├── sha256-xxx1...
│       └── ...
├── gemma4_e2b/                           # (可选) gemma4:e2b 模型文件 (~6.7GB)
│   ├── manifests/
│   └── blobs/
└── (其他模型目录...)
```

---

## 第二步：目标机器安装 Ollama

### 2.1 传输文件

将 `/home/ubuntu/hermes/gpuinstall/` 整个目录拷贝到目标离线机器。

### 2.2 安装 Ollama

```bash
# 进入安装目录
cd /home/ubuntu/hermes/gpuinstall

# 解压 (需要 zstd)
tar -I zstd -xf ollama-linux-amd64.tar.zst

# 移动到系统路径
sudo mv bin/ollama /usr/bin/ollama

# 验证安装
ollama --version
# 输出: ollama version 0.21.0
```

### 2.3 创建 systemd 服务 (可选)

```bash
sudo tee /etc/systemd/system/ollama.service << 'EOF'
[Unit]
Description=Ollama Service
After=network-online.target

[Service]
ExecStart=/usr/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="PATH=$PATH"
Environment="OLLAMA_HOST=0.0.0.0"

[Install]
WantedBy=default.target
EOF

# 创建 ollama 用户 (可选)
sudo useradd -r -s /bin/false -U -m -d /usr/share/ollama ollama 2>/dev/null || true
sudo usermod -a -G ollama $(whoami)

# 启用并启动
sudo systemctl daemon-reload
sudo systemctl enable ollama
sudo systemctl start ollama

# 检查状态
sudo systemctl status ollama
```

---

## 第三步：传输并安装模型

### 3.1 使用 ollama_offline_downloader.py 安装 (推荐)

```bash
cd /home/ubuntu/hermes/gpuinstall

# 安装 gemma4:e4b (需要 root 权限将文件复制到 ~/.ollama/models)
sudo python3 ollama_offline_downloader.py gemma4:e4b \
    --install \
    --output ./gemma4_e4b \
    --models-path ~/.ollama/models
```

### 3.2 手动安装 (不使用 --install)

如果不使用 `--install`，需要手动将文件复制到 Ollama 模型目录：

```bash
# 方法一：直接复制 (简单)
cp -r ./gemma4_e4b/blobs/* ~/.ollama/models/blobs/
cp -r ./gemma4_e4b/manifests/* ~/.ollama/models/manifests/

# 方法二：使用 rsync (保留结构)
rsync -av ./gemma4_e4b/blobs/ ~/.ollama/models/blobs/
rsync -av ./gemma4_e4b/manifests/ ~/.ollama/models/manifests/

# 方法三：符号链接 (节省磁盘空间，不推荐生产环境)
ln -s $(pwd)/gemma4_e4b/blobs/* ~/.ollama/models/blobs/
ln -s $(pwd)/gemma4_e4b/manifests/* ~/.ollama/models/manifests/
```

### 3.3 验证模型已安装

```bash
# 查看已安装模型
ollama list

# 应显示:
# NAME                ID          SIZE      MODIFIED
# gemma4:e4b          abc123...   6.7GB     Just now
```

---

## 第四步：验证运行

### 4.1 基本测试

```bash
# 运行交互式对话
ollama run gemma4:e4b "Hello, write a Python fibonacci function"

# 非交互式生成
ollama generate -m gemma4:e4b -p "What is 2+2?"

# API 测试
curl http://localhost:11434/api/generate -d '{
  "model": "gemma4:e4b",
  "prompt": "Explain recursion in programming",
  "stream": false
}'
```

### 4.2 GPU 监控

```bash
# 运行模型时另开终端监控
watch -n 1 nvidia-smi
```

### 4.3 Python API 测试

```python
from ollama import chat

response = chat(
    model='gemma4:e4b',
    messages=[
        {'role': 'user', 'content': 'Hello! Write a quicksort in Python.'}
    ]
)
print(response['message']['content'])
```

---

## 切换不同模型

### 下载新模型 (联网机器)

```bash
# 在联网机器上
python3 ollama_offline_downloader.py glm-5 --output ./glm5 --workers 4
python3 ollama_offline_downloader.py qwen3:6b --output ./qwen3_6b --workers 4
```

### 安装到目标机器

```bash
# 传输后安装
sudo python3 ollama_offline_downloader.py glm-5 \
    --install \
    --output ./glm5 \
    --models-path ~/.ollama/models

# 运行
ollama run glm-5
```

### 查看所有已安装模型

```bash
ollama list
```

### 删除模型

```bash
ollama rm gemma4:e4b
```

---

## 常见问题

### Q1: 下载中断怎么办？

**解决**：重新运行相同命令，支持断点续传

```bash
python3 ollama_offline_downloader.py gemma4:e4b --output ./gemma4_e4b --workers 4
# 已下载的文件会自动跳过
```

### Q2: 显存不足 (CUDA OOM)

**问题**：运行 e4b 时显存不够

**解决**：
```bash
# 改用 e2b (更轻量)
python3 ollama_offline_downloader.py gemma4:e2b --output ./gemma4_e2b --workers 4

# 或降低 context
ollama run gemma4:e4b /set parameter.num_ctx 2048
```

### Q3: 多个模型如何管理？

```bash
# 每个模型独立目录
/home/ubuntu/hermes/gpuinstall/
├── gemma4_e4b/        # gemma4:e4b
├── glm5/              # glm-5
├── qwen3_6b/          # qwen3:6b

# 分别安装
sudo python3 ollama_offline_downloader.py gemma4:e4b --install --output ./gemma4_e4b
sudo python3 ollama_offline_downloader.py glm-5 --install --output ./glm5
```

### Q4: 如何查看下载工具帮助？

```bash
python3 ollama_offline_downloader.py --help
```

### Q5: 模型加载后下次还需要重新加载吗？

**不需要**。ollama 会保持模型在内存中，直到服务重启或内存不足被卸载。

### Q6: OOM (内存不足) 但 GPU 还有显存

**原因**：Ollama 默认会将部分层卸载到系统内存

**解决**：
```bash
# 启动时指定 GPU
OLLAMA_GPU_OVERHEAD=0 ollama serve

# 或运行时不使用 GPU (不推荐，速度慢)
OLLAMA_GPU_OVERHEAD=1 ollama run gemma4:e4b
```

### Q7: 下载的文件是什么格式？

下载的是 **Ollama blob 格式**（非 GGUF），由 Ollama 内部管理。用户无需关心内部格式，ollama run 会自动处理。

---

## 快速参考卡

```bash
# === 联网机器上执行 ===
# 下载 Ollama
wget https://github.com/ollama/ollama/releases/download/v0.21.0/ollama-linux-amd64.tar.zst

# 下载模型
python3 ollama_offline_downloader.py gemma4:e4b --output ./gemma4_e4b --workers 4

# === 离线目标机器上执行 ===
# 安装 Ollama
tar -I zstd -xf ollama-linux-amd64.tar.zst
sudo mv bin/ollama /usr/bin/ollama

# 安装模型 (需要 root)
sudo python3 ollama_offline_downloader.py gemma4:e4b --install --output ./gemma4_e4b

# 验证
ollama list
ollama run gemma4:e4b
```

---

## 参考链接

- **Ollama 官方**: https://ollama.ai
- **Ollama 模型库**: https://ollama.com/library
- **Gemma4 模型**: https://ollama.com/library/gemma4
- **离线下载工具**: `/home/ubuntu/hermes/gpuinstall/ollama_offline_downloader.py`
