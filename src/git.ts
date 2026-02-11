import { execSync, ExecSyncOptions } from 'child_process';
import { existsSync, rmSync } from 'fs';

export interface GitExecOptions {
  cwd?: string;
  silent?: boolean;
}

export function gitExec(args: string[], options: GitExecOptions = {}): string {
  const execOptions: ExecSyncOptions = {
    cwd: options.cwd,
    encoding: 'utf-8',
    stdio: options.silent ? 'pipe' : 'inherit',
  };

  try {
    return execSync(`git ${args.join(' ')}`, execOptions) as string;
  } catch (error) {
    if (options.silent) return '';
    throw error;
  }
}

export function fetchOrigin(cwd: string): void {
  gitExec(['fetch', 'origin'], { cwd, silent: true });
}

export function branchExists(branch: string, cwd: string): boolean {
  const local = gitExec(['branch', '--list', branch], { cwd, silent: true });
  const remote = gitExec(['branch', '-r', '--list', `origin/${branch}`], { cwd, silent: true });
  return Boolean(local.trim() || remote.trim());
}

export function getCurrentBranch(cwd: string): string {
  return gitExec(['branch', '--show-current'], { cwd, silent: true }).trim();
}

export function hasUncommittedChanges(cwd: string): boolean {
  const status = gitExec(['status', '--porcelain'], { cwd, silent: true });
  return Boolean(status.trim());
}

export function createWorktree(
  worktreePath: string,
  branch: string,
  baseBranch: string,
  cwd: string
): void {
  if (branchExists(branch, cwd)) {
    gitExec(['worktree', 'add', worktreePath, branch], { cwd });
  } else {
    // Try to create from origin/baseBranch first, fall back to local baseBranch
    try {
      gitExec(['worktree', 'add', worktreePath, '-b', branch, `origin/${baseBranch}`], { cwd });
    } catch {
      // If origin/baseBranch doesn't exist, try local baseBranch
      gitExec(['worktree', 'add', worktreePath, '-b', branch, baseBranch], { cwd });
    }
  }
}

export function removeWorktree(worktreePath: string, cwd: string): void {
  gitExec(['worktree', 'remove', worktreePath, '--force'], { cwd, silent: true });
  gitExec(['worktree', 'prune'], { cwd, silent: true });

  // Fallback: manual removal if still exists
  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
  }
}

export function deleteBranch(branch: string, cwd: string, deleteRemote: boolean = false): void {
  gitExec(['branch', '-D', branch], { cwd, silent: true });

  if (deleteRemote) {
    gitExec(['push', 'origin', '--delete', branch], { cwd, silent: true });
  }
}
