import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
export function gitExec(args, options = {}) {
    const execOptions = {
        cwd: options.cwd,
        encoding: 'utf-8',
        stdio: options.silent ? 'pipe' : 'inherit',
    };
    try {
        return execSync(`git ${args.join(' ')}`, execOptions);
    }
    catch (error) {
        if (options.silent)
            return '';
        throw error;
    }
}
export function fetchOrigin(cwd) {
    gitExec(['fetch', 'origin'], { cwd, silent: true });
}
export function branchExists(branch, cwd) {
    const local = gitExec(['branch', '--list', branch], { cwd, silent: true });
    const remote = gitExec(['branch', '-r', '--list', `origin/${branch}`], { cwd, silent: true });
    return Boolean(local.trim() || remote.trim());
}
export function getCurrentBranch(cwd) {
    return gitExec(['branch', '--show-current'], { cwd, silent: true }).trim();
}
export function hasUncommittedChanges(cwd) {
    const status = gitExec(['status', '--porcelain'], { cwd, silent: true });
    return Boolean(status.trim());
}
export function createWorktree(worktreePath, branch, baseBranch, cwd) {
    if (branchExists(branch, cwd)) {
        gitExec(['worktree', 'add', worktreePath, branch], { cwd });
    }
    else {
        // Try to create from origin/baseBranch first, fall back to local baseBranch
        try {
            gitExec(['worktree', 'add', worktreePath, '-b', branch, `origin/${baseBranch}`], { cwd });
        }
        catch {
            // If origin/baseBranch doesn't exist, try local baseBranch
            gitExec(['worktree', 'add', worktreePath, '-b', branch, baseBranch], { cwd });
        }
    }
}
export function removeWorktree(worktreePath, cwd) {
    gitExec(['worktree', 'remove', worktreePath, '--force'], { cwd, silent: true });
    gitExec(['worktree', 'prune'], { cwd, silent: true });
    // Fallback: manual removal if still exists
    if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
    }
}
export function deleteBranch(branch, cwd, deleteRemote = false) {
    gitExec(['branch', '-D', branch], { cwd, silent: true });
    if (deleteRemote) {
        gitExec(['push', 'origin', '--delete', branch], { cwd, silent: true });
    }
}
//# sourceMappingURL=git.js.map