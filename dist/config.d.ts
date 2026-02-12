export interface ServiceConfig {
    name: string;
    image?: string;
    path?: string;
    dockerfile?: string;
    command?: string;
    ports: Record<string, number>;
    env?: Record<string, string>;
    healthcheck?: {
        test?: string;
        path?: string;
        interval?: string;
        retries?: number;
        start_period?: string;
    };
    depends_on?: Record<string, string>;
    volumes?: Record<string, string>;
    named_volumes?: Record<string, string>;
}
export interface MonorepoConfig {
    project: {
        name: string;
        worktree_dir: string;
    };
    ports: {
        offset: number;
        max_worktrees: number;
    };
    services: ServiceConfig[];
    kong_local?: {
        replacements: [string, string][];
    };
    hooks?: {
        post_create?: string[];
    };
}
export interface WorktreeConfig {
    name: string;
    branch: string;
    baseBranch: string;
    slot: number;
    projectRoot: string;
    worktreePath: string;
    monorepoConfig: MonorepoConfig;
}
export declare function findProjectRoot(): string;
export declare function loadMonorepoConfig(projectRoot: string): MonorepoConfig;
export declare function generateName(): string;
export declare function generateBranchName(worktreeName: string): string;
export declare function getExistingWorktrees(projectRoot: string): Array<{
    path: string;
    branch?: string;
}>;
export declare function getWorktreeConfig(options: {
    name?: string;
    branch?: string;
    baseBranch?: string;
}): WorktreeConfig;
export declare function configExists(projectRoot: string): boolean;
export declare function getWorktreeName(worktreePath: string): string;
export declare function generateConfigTemplate(projectName: string): string;
export declare function getServicePorts(config: MonorepoConfig, slot: number): Array<{
    service: string;
    port: string;
    base: number;
    host: number;
}>;
//# sourceMappingURL=config.d.ts.map