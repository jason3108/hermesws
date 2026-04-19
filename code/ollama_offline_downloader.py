#!/usr/bin/env python3
"""
Ollama Offline Downloader
========================
自动下载 Ollama 模型到本地目录，模拟 ollama pull 的离线体验。

Usage:
    python3 ollama_offline_downloader.py gemma4:e4b
    python3 ollama_offline_downloader.py gemma4:e4b --output /path/to/output
    python3 ollama_offline_downloader.py glm-5 --workers 4

Features:
    - 自动解析 oget get 输出，获取所有 blob 下载链接
    - 自动创建正确的目录结构 (manifests/ + blobs/)
    - 多线程并行下载
    - 实时显示下载进度 (单文件 + 总体)
    - 断点续传支持
    - 下载完成后显示安装命令
"""

import argparse
import subprocess
import re
import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from datetime import datetime

# 默认 registry
DEFAULT_REGISTRY = "registry.ollama.ai"

# 颜色输出
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


def print_info(msg):
    print(f"{Colors.OKCYAN}ℹ{Colors.ENDC} {msg}")


def print_success(msg):
    print(f"{Colors.OKGREEN}✔{Colors.ENDC} {msg}")


def print_warning(msg):
    print(f"{Colors.WARNING}⚠{Colors.ENDC} {msg}")


def print_error(msg):
    print(f"{Colors.FAIL}✖{Colors.ENDC} {msg}", file=sys.stderr)


def print_header(msg):
    print(f"\n{Colors.BOLD}{Colors.HEADER}{msg}{Colors.ENDC}")


def format_size(size_bytes):
    """格式化文件大小"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} TB"


def parse_oget_output(output):
    """解析 oget get 命令的输出，提取下载链接"""
    manifest_url = None
    blobs = []  # [(url, size, filename), ...]

    lines = output.strip().split('\n')

    for i, line in enumerate(lines):
        # 匹配 manifest URL
        if '📄' in line or ('http' in line and 'manifests' in line and 'curl' not in line):
            # 提取 URL
            url_match = re.search(r'https?://[^\s"]+', line)
            if url_match:
                manifest_url = url_match.group(0)
                # 清理 URL 末尾的引号
                manifest_url = manifest_url.rstrip('"').rstrip("'")

        # 匹配 blob 下载链接
        # 格式: "1 - [5.3 GB] https://registry.ollama.ai/v2/..."
        blob_match = re.match(r'\s*\d+\s*-\s*\[([^\]]+)\]\s*(https?://[^\s]+)', line)
        if blob_match:
            size_str = blob_match.group(1)
            url = blob_match.group(2).rstrip('"').rstrip("'")

            # 转换大小字符串为字节
            size_bytes = parse_size_to_bytes(size_str)

            # 从 URL 提取文件名
            filename = url.split('/')[-1].split('?')[0]
            if not filename.startswith('sha256-'):
                filename = filename.replace('sha256:', 'sha256-', 1)

            blobs.append({
                'url': url,
                'size': size_bytes,
                'size_str': size_str,
                'filename': filename
            })

    return manifest_url, blobs


def parse_size_to_bytes(size_str):
    """将大小字符串转换为字节数"""
    size_str = size_str.strip().upper()

    # 提取数字和单位
    match = re.match(r'([\d.]+)\s*([KMGT]?B?)', size_str)
    if not match:
        return 0

    number = float(match.group(1))
    unit = match.group(2) or 'B'

    multipliers = {
        'B': 1,
        'KB': 1024,
        'MB': 1024 ** 2,
        'GB': 1024 ** 3,
        'TB': 1024 ** 4,
        'K': 1024,
        'M': 1024 ** 2,
        'G': 1024 ** 3,
        'T': 1024 ** 4,
    }

    return int(number * multipliers.get(unit, 1))


def fetch_manifest_json(model_name):
    """直接获取 manifest JSON，不依赖 oget 命令输出"""
    # 解析模型名
    if ':' in model_name:
        base, tag = model_name.split(':', 1)
    else:
        base = model_name
        tag = 'latest'

    if '/' in base:
        namespace, model = base.split('/', 1)
    else:
        namespace = 'library'
        model = base

    url = f"https://{DEFAULT_REGISTRY}/v2/{namespace}/{model}/manifests/{tag}"

    print_info(f"获取模型信息: {model_name}")
    print_info(f"Manifest URL: {url}")

    try:
        req = urllib.request.Request(url, headers={
            "Accept": "application/vnd.docker.distribution.manifest.v2+json"
        })
        with urllib.request.urlopen(req) as response:
            if response.status != 200:
                print_error(f"Registry 返回状态码 {response.status}")
                return None, None, None

            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print_error(f"模型 '{model_name}' 在 registry 中未找到。")
        else:
            print_error(f"HTTP 错误: {e}")
        return None, None, None
    except urllib.error.URLError as e:
        print_error(f"网络错误: {e}")
        return None, None, None

    # 解析 layers 和 config
    layers = data.get("layers", [])
    config = data.get("config")

    blobs = []
    for layer in layers:
        digest = layer.get("digest")
        size = layer.get("size", 0)
        if digest:
            layer_url = f"https://{DEFAULT_REGISTRY}/v2/{namespace}/{model}/blobs/{digest}"
            filename = digest.replace(":", "-")
            blobs.append({
                'url': layer_url,
                'size': size,
                'size_str': format_size(size),
                'filename': filename,
                'digest': digest
            })

    # config 也是一个 blob
    if config:
        digest = config.get("digest")
        size = config.get("size", 0)
        if digest:
            layer_url = f"https://{DEFAULT_REGISTRY}/v2/{namespace}/{model}/blobs/{digest}"
            filename = digest.replace(":", "-")
            blobs.append({
                'url': layer_url,
                'size': size,
                'size_str': format_size(size),
                'filename': filename,
                'digest': digest
            })

    # 构建 manifest 路径
    manifest_path = f"manifests/{DEFAULT_REGISTRY}/{namespace}/{model}/{tag}"

    return manifest_path, blobs, url


def download_file(url, dest_path, filename, progress_info=None, resume=True):
    """下载单个文件，带进度显示"""
    dest_file = os.path.join(dest_path, filename)
    temp_file = dest_file + ".part"

    # 检查是否已下载完成
    if os.path.exists(dest_file):
        file_size = os.path.getsize(dest_file)
        if progress_info:
            progress_info['completed'].add(filename)
        return True, filename, file_size

    # 检查是否支持断点续传
    existing_size = 0
    if resume and os.path.exists(temp_file):
        existing_size = os.path.getsize(temp_file)

    try:
        # 创建请求，支持断点续传
        headers = {}
        if existing_size > 0:
            headers['Range'] = f'bytes={existing_size}-'

        req = urllib.request.Request(url, headers=headers)

        start_time = time.time()

        with urllib.request.urlopen(req) as response:
            total_size = int(response.headers.get('Content-Length', 0))
            if existing_size > 0:
                total_size += existing_size

            mode = 'ab' if existing_size > 0 else 'wb'

            with open(temp_file, mode) as f:
                downloaded = existing_size
                chunk_size = 1024 * 1024  # 1MB chunks
                last_update = 0

                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break

                    f.write(chunk)
                    downloaded += len(chunk)

                    # 更新进度 (每秒最多更新一次)
                    if progress_info and time.time() - last_update >= 0.5:
                        progress_info['downloaded'] += len(chunk)
                        progress_info['current_file'] = filename
                        progress_info['speed'] = downloaded / (time.time() - start_time + 1)
                        last_update = time.time()

                        # 刷新进度显示
                        _print_progress(progress_info)

                # 下载完成，重命名临时文件
                os.rename(temp_file, dest_file)
                if progress_info:
                    progress_info['completed'].add(filename)
                    # 文件完成，打印完成行
                    _progress_finish_line(
                        f"{Colors.OKGREEN}✓{Colors.ENDC} {filename} "
                        f"({format_size(downloaded)})"
                    )

                return True, filename, downloaded

    except Exception as e:
        print_error(f"下载失败 {filename}: {e}")
        return False, filename, 0


import time

_progress_lock = Lock()
_last_progress_line = ""
_progress_line_count = 0

def _clear_and_write(line):
    """安全地写入单行进度（覆盖上一行）"""
    global _last_progress_line, _progress_line_count
    with _progress_lock:
        # 用 ANSI escape 精确清除当前行
        # \033[2K = 清除整行, \033[1G = 移到行首
        sys.stdout.write('\033[2K\033[1G' + line)
        sys.stdout.flush()
        _progress_line_count = 1
        _last_progress_line = line

def _progress_finish_line(line):
    """完成一行进度（换行，后续输出从这里继续）"""
    global _progress_line_count
    with _progress_lock:
        # 先精确清除当前行，再写新内容+换行
        sys.stdout.write('\033[2K\033[1G' + line + '\n\033[1G')
        sys.stdout.flush()
        _progress_line_count = 0
        _last_progress_line = line

def _print_progress(info):
    """打印简洁的单行进度"""
    downloaded = info.get('downloaded', 0)
    total = info.get('total', 0)
    current = info.get('current_file', '')
    completed = info.get('completed', set())
    total_files = info.get('total_files', 0)
    speed = info.get('speed', 0)

    pct = (downloaded / total * 100) if total > 0 else 0
    speed_str = f"{format_size(speed)}/s" if speed > 0 else ""

    # 简洁的单行格式
    if current:
        display_name = current[:40] + '...' if len(current) > 40 else current
        line = (f"{Colors.OKCYAN}[{len(completed)}/{total_files}]{Colors.ENDC} "
                f"{pct:5.1f}% {format_size(downloaded)}/{format_size(total)} "
                f"{Colors.WARNING}{display_name}{Colors.ENDC}")
    else:
        line = f"{Colors.OKCYAN}[{len(completed)}/{total_files}]{Colors.ENDC} {pct:5.1f}%"

    if speed_str:
        line += f" {speed_str}"

    _clear_and_write(line)


def download_all_files(blobs, output_dir, manifest_struct_path, manifest_download_url, num_workers=4, resume=True):
    """下载所有文件

    Args:
        blobs: blob 文件列表
        output_dir: 输出根目录
        manifest_struct_path: manifest 结构化路径 (e.g., manifests/registry.ollama.ai/library/gemma4/e2b)
        manifest_download_url: manifest 实际下载 URL
        num_workers: 并行下载线程数
        resume: 是否支持断点续传
    """
    # 创建目录
    blobs_dir = os.path.join(output_dir, "blobs")
    # manifest_struct_path 类似: manifests/registry.ollama.ai/library/gemma4/e2b
    manifest_full_dir = os.path.join(output_dir, os.path.dirname(manifest_struct_path))

    os.makedirs(blobs_dir, exist_ok=True)
    os.makedirs(manifest_full_dir, exist_ok=True)

    # 写入 manifest 文件
    manifest_filename = os.path.basename(manifest_struct_path)
    manifest_dest = os.path.join(manifest_full_dir, manifest_filename)

    print_info(f"下载 manifest: {manifest_download_url}")
    try:
        urllib.request.urlretrieve(manifest_download_url, manifest_dest)
        print_success(f"Manifest 已保存: {manifest_dest}")
    except Exception as e:
        print_error(f"Manifest 下载失败: {e}")
        return False

    # 计算总大小
    total_size = sum(b['size'] for b in blobs)
    total_files = len(blobs)

    print_header(f"开始下载 {total_files} 个文件 (总计 {format_size(total_size)})")
    print_info("按 Ctrl+C 可中断，已下载的文件会自动保留\n")

    # 初始化进度信息
    progress_info = {
        'downloaded': 0,
        'total': total_size,
        'current_file': '',
        'completed': set(),
        'total_files': total_files,
        'start_time': time.time(),
        'failed': [],
        'speed': 0
    }

    # 预检已下载的文件
    for blob in blobs:
        dest_file = os.path.join(blobs_dir, blob['filename'])
        if os.path.exists(dest_file):
            # 检查大小是否匹配
            if os.path.getsize(dest_file) == blob['size']:
                progress_info['completed'].add(blob['filename'])
                progress_info['downloaded'] += blob['size']
                print_success(f"跳过 (已存在): {blob['filename']}")

    remaining = total_files - len(progress_info['completed'])
    if remaining < total_files:
        print_info(f"将跳过 {len(progress_info['completed'])} 个已下载文件，剩余 {remaining} 个\n")

    # 多线程下载
    def download_task(blob):
        filename = blob['filename']
        dest_file = os.path.join(blobs_dir, filename)

        # 再次检查是否已下载
        if os.path.exists(dest_file) and os.path.getsize(dest_file) == blob['size']:
            return True, blob['filename'], 0

        return download_file(blob['url'], blobs_dir, filename, progress_info, resume)

    try:
        with ThreadPoolExecutor(max_workers=num_workers) as executor:
            futures = {
                executor.submit(download_task, blob): blob
                for blob in blobs
                if blob['filename'] not in progress_info['completed']
            }

            for future in as_completed(futures):
                success, filename, size = future.result()
                if not success:
                    progress_info['failed'].append(filename)

    except KeyboardInterrupt:
        print_warning("\n下载已中断 (Ctrl+C)")
        print_info("可以重新运行命令继续下载 (支持断点续传)")
        return False

    # 清空当前进度行并换行
    _progress_finish_line("")  # 这会清空当前行并换行

    # 检查是否有失败
    if progress_info['failed']:
        print_error(f"以下 {len(progress_info['failed'])} 个文件下载失败:")
        for f in progress_info['failed']:
            print(f"  - {f}")
        return False

    # 计算耗时
    elapsed = time.time() - progress_info['start_time']
    avg_speed = progress_info['downloaded'] / elapsed if elapsed > 0 else 0

    print_success(f"下载完成！")
    print_info(f"  - 文件数: {len(progress_info['completed'])}/{total_files}")
    print_info(f"  - 总大小: {format_size(progress_info['downloaded'])}")
    print_info(f"  - 耗时: {elapsed:.1f} 秒")
    print_info(f"  - 平均速度: {format_size(avg_speed)}/秒")

    return True


def print_install_instructions(model_name, output_dir):
    """打印安装说明"""
    print_header("=" * 60)
    print(f"{Colors.BOLD}安装到 Ollama (在目标离线机器上执行){Colors.ENDC}")
    print_header("=" * 60)

    print(f"""
{Colors.OKCYAN}Step 1:{Colors.ENDC} 传输整个目录到目标机器
  {Colors.WARNING}rsync -avP {output_dir}/ user@target:/path/to/  {Colors.ENDC}
  或通过 U盘/硬盘拷贝

{Colors.OKCYAN}Step 2:{Colors.ENDC} 安装 Ollama (如尚未安装)
  {Colors.WARNING}tar -I zstd -xf ollama-linux-amd64.tar.zst
  sudo mv bin/ollama /usr/bin/ollama{Colors.ENDC}

{Colors.OKCYAN}Step 3:{Colors.ENDC} 安装模型 (需要 sudo)
  {Colors.WARNING}export OLLAMA_MODELS=/path/to/ollama_models
  sudo oget install --model {model_name} --blobsPath {output_dir}/blobs
  {Colors.ENDC}
  或者直接:
  {Colors.WARNING}sudo python3 ollama_offline_downloader.py {model_name} --install --models-path ~/.ollama/models{Colors.ENDC}

{Colors.OKCYAN}Step 4:{Colors.ENDC} 运行模型
  {Colors.WARNING}ollama run {model_name}{Colors.ENDC}

{Colors.OKCYAN}目录结构:{Colors.ENDC}
  {output_dir}/
  ├── manifests/
  │   └── registry.ollama.ai/
  │       └── library/
  │           └── {model_name.split(':')[0]}/
  │               └── {model_name.split(':')[1] if ':' in model_name else 'latest'}
  └── blobs/
      ├── sha256-xxx1...
      └── sha256-xxx2...
""")


def install_to_ollama(model_name, blobs_path, models_path=None):
    """将下载的模型安装到 Ollama"""
    import hashlib
    import shutil

    if models_path is None:
        models_path = os.path.expanduser("~/.ollama/models")

    manifest_file = os.path.join(blobs_path, "manifest")
    if not os.path.exists(manifest_file):
        print_error(f"Manifest 文件不存在: {manifest_file}")
        return False

    # 解析模型名获取目录结构
    if ':' in model_name:
        base, tag = model_name.split(':', 1)
    else:
        base = model_name
        tag = 'latest'

    if '/' in base:
        namespace, model = base.split('/', 1)
    else:
        namespace = 'library'
        model = base

    # 创建目标目录
    manifest_dest_dir = os.path.join(models_path, "manifests", DEFAULT_REGISTRY, namespace, model)
    blobs_dest_dir = os.path.join(models_path, "blobs")

    os.makedirs(manifest_dest_dir, exist_ok=True)
    os.makedirs(blobs_dest_dir, exist_ok=True)

    # 复制 manifest
    manifest_dest = os.path.join(manifest_dest_dir, tag)
    shutil.copy2(manifest_file, manifest_dest)
    print_success(f"Manifest 已安装: {manifest_dest}")

    # 复制 blobs
    blobs_src_dir = os.path.join(blobs_path, "blobs")
    if os.path.exists(blobs_src_dir):
        for filename in os.listdir(blobs_src_dir):
            src = os.path.join(blobs_src_dir, filename)
            dst = os.path.join(blobs_dest_dir, filename)
            if os.path.isfile(src):
                shutil.copy2(src, dst)

    # 处理直接在 blobs_path 下的 blob 文件
    for filename in os.listdir(blobs_path):
        filepath = os.path.join(blobs_path, filename)
        if filename == "manifest" or os.path.isdir(filepath):
            continue

        # 计算 hash
        if filename.startswith("sha256-"):
            hashed_name = filename
        elif filename.startswith("sha256"):
            hashed_name = "sha256-" + filename[6:]
        else:
            # 需要计算 hash
            hasher = hashlib.sha256()
            with open(filepath, 'rb') as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    hasher.update(chunk)
            hashed_name = "sha256-" + hasher.hexdigest()

        dst = os.path.join(blobs_dest_dir, hashed_name)
        if not os.path.exists(dst):
            shutil.copy2(filepath, dst)

    print_success(f"模型已安装到 Ollama!")
    print_info(f"运行: {Colors.BOLD}ollama run {model_name}{Colors.ENDC}")

    return True


def main():
    parser = argparse.ArgumentParser(
        description="Ollama Offline Downloader - 自动下载 Ollama 模型到本地",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s gemma4:e4b                                    # 下载 gemma4:e4b
  %(prog)s gemma4:e4b --output ~/ollama_models          # 指定输出目录
  %(prog)s glm-5 --workers 8                            # 使用 8 线程
  %(prog)s qwen3:6b --install --models-path ~/.ollama/models  # 下载并安装

支持的模型格式:
  <model>:<tag>                  例如: gemma4:e4b, glm-5:latest
  <namespace>/<model>:<tag>      例如: huihui_ai/deepseek-r1:8b
"""
    )

    parser.add_argument('model', help="Ollama 模型名，如 gemma4:e4b, glm-5, qwen3:6b")
    parser.add_argument('--output', '-o', default=None,
                        help="输出目录 (默认: ./ollama_models/<model>)")
    parser.add_argument('--workers', '-w', type=int, default=4,
                        help="并行下载线程数 (默认: 4)")
    parser.add_argument('--install', action='store_true',
                        help="下载后直接安装到 Ollama (需要 sudo)")
    parser.add_argument('--models-path', default=None,
                        help="Ollama models 目录 (配合 --install 使用)")

    args = parser.parse_args()

    model_name = args.model

    # 确定输出目录
    if args.output:
        output_dir = os.path.abspath(args.output)
    else:
        # 默认: ./ollama_models/<model>:<tag>
        safe_name = model_name.replace(':', '_').replace('/', '_')
        output_dir = os.path.join(os.getcwd(), "ollama_models", safe_name)

    print_header(f"Ollama Offline Downloader")
    print(f"{Colors.OKCYAN}模型:{Colors.ENDC} {model_name}")
    print(f"{Colors.OKCYAN}输出:{Colors.ENDC} {output_dir}")
    print(f"{Colors.OKCYAN}线程:{Colors.ENDC} {args.workers}")

    # 获取 manifest 和 blobs
    manifest_path, blobs, manifest_url = fetch_manifest_json(model_name)

    if manifest_path is None:
        print_error("无法获取模型信息，请检查模型名是否正确")
        sys.exit(1)

    if not blobs:
        print_error("未找到任何可下载的文件")
        sys.exit(1)

    print_success(f"找到 {len(blobs)} 个文件待下载")

    # 下载所有文件
    success = download_all_files(blobs, output_dir, manifest_path, manifest_url,
                                  num_workers=args.workers, resume=True)

    if not success:
        sys.exit(1)

    # 打印安装说明
    print_install_instructions(model_name, output_dir)

    # 如果指定了 --install
    if args.install:
        print_header("执行安装...")
        if os.geteuid() != 0:
            print_warning("安装需要 root 权限，请使用 sudo")
            print_info(f"手动安装命令: sudo oget install --model {model_name} --blobsPath {output_dir}/blobs")
        else:
            success = install_to_ollama(model_name, output_dir, args.models_path)
            if success:
                print_success("安装完成！")
                print_info(f"运行: ollama run {model_name}")


if __name__ == "__main__":
    main()
