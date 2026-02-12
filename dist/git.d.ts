export interface GitExecOptions {
    cwd?: string;
    silent?: boolean;
}
export declare function gitExec(args: string[], options?: GitExecOptions): string;
export declare function fetchOrigin(cwd: string): void;
export declare function branchExists(branch: string, cwd: string): boolean;
export declare function getCurrentBranch(cwd: string): string;
export declare function hasUncommittedChanges(cwd: string): boolean;
export declare function createWorktree(worktreePath: string, branch: string, baseBranch: string, cwd: string): void;
export declare function removeWorktree(worktreePath: string, cwd: string): void;
export declare function deleteBranch(branch: string, cwd: string, deleteRemote?: boolean): void;
//# sourceMappingURL=git.d.ts.map