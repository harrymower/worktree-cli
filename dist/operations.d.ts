import { WorktreeConfig, MonorepoConfig } from './config.js';
export interface DevContext {
    projectRoot: string;
    workingDir: string;
    isWorktree: boolean;
    worktreeName: string | null;
    slot: number;
    composePath: string;
    composeProject: string;
    config: MonorepoConfig;
}
/**
 * Detect the current development context (main project or worktree).
 * Optionally override with an explicit worktree name.
 */
export declare function getDevContext(worktreeName?: string): DevContext;
export interface CreateWorktreeOptions {
    force?: boolean;
    skipHooks?: boolean;
}
export declare function createWorktree(config: WorktreeConfig, options?: CreateWorktreeOptions): boolean;
export declare function removeWorktree(name: string, options?: {
    deleteBranch?: boolean;
    deleteRemote?: boolean;
    removeVolumes?: boolean;
    force?: boolean;
}): boolean;
export declare function listWorktrees(detailed?: boolean): void;
export declare function cleanupAll(force?: boolean, removeVolumes?: boolean): void;
export declare function startDev(options: {
    worktreeName?: string;
    build?: boolean;
    services?: string[];
    localCli?: boolean;
    localSdk?: boolean;
}): Promise<boolean>;
export declare function stopDev(options: {
    worktreeName?: string;
    removeVolumes?: boolean;
    cleanYalc?: boolean;
}): boolean;
export declare function statusDev(worktreeName?: string): void;
export declare function logsDev(options: {
    worktreeName?: string;
    services?: string[];
}): void;
/**
 * Print shell configuration for local development
 */
export declare function printEnvConfig(options: {
    worktreeName?: string;
    localCli?: boolean;
    useExport?: boolean;
}): void;
//# sourceMappingURL=operations.d.ts.map