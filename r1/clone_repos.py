#!/usr/bin/env python3
"""
Big Bang Repo Cloner
Downloads all repositories from repo.json and organizes them by project path.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

# Configuration
REPO_JSON = "/home/ubuntu/hermes/r1/repo.json"
OUTPUT_BASE = "./big-bang-repos"
MAX_WORKERS = 5  # Number of concurrent clones
CLONE_TIMEOUT = 300  # 5 minutes per repo

# ANSI colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"
BOLD = "\033[1m"


def print_header(text):
    print(f"\n{BOLD}{BLUE}{'=' * 60}{RESET}")
    print(f"{BOLD}{BLUE}{text}{RESET}")
    print(f"{BOLD}{BLUE}{'=' * 60}{RESET}\n")


def print_success(text):
    print(f"{GREEN}✓ {text}{RESET}")


def print_error(text):
    print(f"{RED}✗ {text}{RESET}")


def print_warning(text):
    print(f"{YELLOW}⚠ {text}{RESET}")


def print_info(text):
    print(f"{BLUE}ℹ {text}{RESET}")


def load_repos(json_path):
    """Load repository data from JSON file."""
    print_info(f"Loading repos from {json_path}")
    with open(json_path, 'r') as f:
        data = json.load(f)
    return data


def get_all_repos(data):
    """Extract all repos from the data structure."""
    repos = []
    
    # Direct projects
    for repo in data.get('direct_projects', []):
        repos.append({
            'path': repo['path_with_namespace'],
            'http_url': repo['http_url'],
            'ssh_url': repo.get('ssh_url', ''),
            'stars': repo.get('stars', 0),
            'type': 'direct'
        })
    
    # Subgroup repos
    for subgroup_name, subgroup_data in data.get('subgroups', {}).items():
        for repo in subgroup_data.get('repos', []):
            repos.append({
                'path': repo['path_with_namespace'],
                'http_url': repo['http_url'],
                'ssh_url': repo.get('ssh_url', ''),
                'stars': repo.get('stars', 0),
                'type': 'subgroup',
                'subgroup': subgroup_name
            })
    
    return repos


def get_clone_urls(repo_info):
    """Get clone URLs for a repo, trying HTTP first then SSH."""
    http_url = repo_info.get('http_url', '')
    ssh_url = repo_info.get('ssh_url', '')
    
    if http_url:
        return http_url
    elif ssh_url:
        return ssh_url
    else:
        return None


def clone_repo(repo_info, output_base, force=False):
    """
    Clone a single repository.
    Returns (success, message, repo_path)
    """
    path = repo_info['path']
    clone_url = get_clone_urls(repo_info)
    
    if not clone_url:
        return False, "No clone URL available", None
    
    # Create target directory path
    # big-bang/apps/sandbox/actions-runner-controller -> output_base/big-bang/apps/sandbox/actions-runner-controller
    target_dir = os.path.join(output_base, path.replace('/', os.sep))
    
    # Check if already exists
    if os.path.exists(target_dir):
        if force:
            print_warning(f"Removing existing directory for re-clone: {path}")
            import shutil
            shutil.rmtree(target_dir)
        else:
            return False, "Already exists (use --force to re-clone)", target_dir
    
    # Create parent directory
    os.makedirs(os.path.dirname(target_dir), exist_ok=True)
    
    # Clone the repo
    try:
        result = subprocess.run(
            ['git', 'clone', '--depth', '1', clone_url, target_dir],
            capture_output=True,
            text=True,
            timeout=CLONE_TIMEOUT
        )
        
        if result.returncode == 0:
            return True, "Cloned successfully", target_dir
        else:
            # Try without --depth if it fails
            try:
                result = subprocess.run(
                    ['git', 'clone', clone_url, target_dir],
                    capture_output=True,
                    text=True,
                    timeout=CLONE_TIMEOUT
                )
                if result.returncode == 0:
                    return True, "Cloned successfully (full history)", target_dir
            except:
                pass
            return False, result.stderr.strip()[:200], target_dir
            
    except subprocess.TimeoutExpired:
        return False, "Clone timeout", target_dir
    except Exception as e:
        return False, str(e), target_dir


def clone_repos_sequential(repos, output_base, force=False):
    """Clone repos one by one."""
    total = len(repos)
    success_count = 0
    fail_count = 0
    
    print_header(f"Cloning {total} Repositories (Sequential Mode)")
    
    for i, repo in enumerate(repos, 1):
        path = repo['path']
        print(f"\n[{i}/{total}] ", end="")
        print_info(f"Cloning {path}...")
        
        success, msg, repo_path = clone_repo(repo, output_base, force)
        
        if success:
            print_success(f"{path} -> {msg}")
            success_count += 1
        else:
            print_error(f"{path}: {msg}")
            fail_count += 1
    
    return success_count, fail_count


def clone_repos_parallel(repos, output_base, force=False, max_workers=None):
    """Clone repos in parallel using thread pool."""
    if max_workers is None:
        max_workers = MAX_WORKERS
    
    total = len(repos)
    success_count = 0
    fail_count = 0
    completed = 0
    
    print_header(f"Cloning {total} Repositories (Parallel Mode, {max_workers} workers)")
    
    def do_clone(repo):
        return clone_repo(repo, output_base, force)
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_repo = {executor.submit(do_clone, repo): repo for repo in repos}
        
        for future in as_completed(future_to_repo):
            completed += 1
            repo = future_to_repo[future]
            path = repo['path']
            
            try:
                success, msg, repo_path = future.result()
                
                if success:
                    print_success(f"[{completed}/{total}] {path}")
                    success_count += 1
                else:
                    print_error(f"[{completed}/{total}] {path}: {msg}")
                    fail_count += 1
                    
            except Exception as e:
                print_error(f"[{completed}/{total}] {path}: Exception - {str(e)}")
                fail_count += 1
    
    return success_count, fail_count


def show_summary(repos, output_base):
    """Show summary of what will be cloned."""
    total = len(repos)
    
    # Group by subgroup
    by_subgroup = {}
    direct_count = 0
    
    for repo in repos:
        if repo['type'] == 'direct':
            direct_count += 1
        else:
            sg = repo.get('subgroup', 'unknown')
            if sg not in by_subgroup:
                by_subgroup[sg] = 0
            by_subgroup[sg] += 1
    
    print_header("Clone Summary")
    print(f"{BOLD}Total Repositories:{RESET} {total}")
    print(f"{BOLD}Output Directory:{RESET} {os.path.abspath(output_base)}")
    print(f"\n{BOLD}Distribution:{RESET}")
    print(f"  Direct projects: {direct_count}")
    for sg in sorted(by_subgroup.keys()):
        print(f"  {sg}: {by_subgroup[sg]}")
    
    # Show top 10 by stars
    print(f"\n{BOLD}Top 10 by Stars:{RESET}")
    sorted_by_stars = sorted(repos, key=lambda x: x.get('stars', 0), reverse=True)[:10]
    for repo in sorted_by_stars:
        stars = repo.get('stars', 0)
        print(f"  {stars:>4} stars - {repo['path']}")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Clone Big Bang repositories from repo.json',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                    # Clone all repos (sequential)
  %(prog)s --parallel         # Clone all repos (parallel, 5 workers)
  %(prog)s --parallel -w 10    # Clone all repos (parallel, 10 workers)
  %(prog)s --force            # Re-clone even if directory exists
  %(prog)s --dry-run          # Show what would be cloned without cloning
  %(prog)s --subgroup apps    # Only clone repos from 'apps' subgroup
        """
    )
    
    parser.add_argument('--json', default=REPO_JSON, help='Path to repo.json file')
    parser.add_argument('--output', default=OUTPUT_BASE, help='Base output directory')
    parser.add_argument('--parallel', action='store_true', help='Use parallel cloning')
    parser.add_argument('-w', '--workers', type=int, default=MAX_WORKERS, help='Number of parallel workers')
    parser.add_argument('--force', action='store_true', help='Re-clone even if directory exists')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be cloned without cloning')
    parser.add_argument('--subgroup', help='Only clone repos from specific subgroup')
    parser.add_argument('--stars-threshold', type=int, default=0, help='Only clone repos with >= N stars')
    
    args = parser.parse_args()
    
    # Load repos
    if not os.path.exists(args.json):
        print_error(f"repo.json not found at {args.json}")
        sys.exit(1)
    
    data = load_repos(args.json)
    all_repos = get_all_repos(data)
    
    print_info(f"Found {len(all_repos)} repositories in JSON")
    
    # Filter if requested
    repos = all_repos
    if args.subgroup:
        repos = [r for r in repos if r.get('subgroup') == args.subgroup]
        print_info(f"Filtered to {len(repos)} repos in subgroup '{args.subgroup}'")
    
    if args.stars_threshold > 0:
        repos = [r for r in repos if r.get('stars', 0) >= args.stars_threshold]
        print_info(f"Filtered to {len(repos)} repos with >= {args.stars_threshold} stars")
    
    if not repos:
        print_warning("No repositories to clone after filtering")
        sys.exit(0)
    
    # Show summary
    show_summary(repos, args.output)
    
    if args.dry_run:
        print_warning("Dry run mode - no repositories will be cloned")
        sys.exit(0)
    
    # Confirm
    response = input(f"\n{BOLD}Proceed with cloning? [Y/n]: {RESET}")
    if response.lower() == 'n':
        print_info("Aborted")
        sys.exit(0)
    
    # Create output directory
    os.makedirs(args.output, exist_ok=True)
    
    # Clone
    start_time = time.time()
    
    if args.parallel:
        success, fail = clone_repos_parallel(repos, args.output, args.force, args.workers)
    else:
        success, fail = clone_repos_sequential(repos, args.output, args.force)
    
    elapsed = time.time() - start_time
    
    # Final summary
    print_header("Clone Complete")
    print(f"{BOLD}Total:{RESET} {len(repos)}")
    print_success(f"Success: {success}")
    if fail > 0:
        print_error(f"Failed: {fail}")
    print(f"{BOLD}Time:{RESET} {elapsed:.1f} seconds")
    print(f"{BOLD}Output Directory:{RESET} {os.path.abspath(args.output)}")
    
    if fail > 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
