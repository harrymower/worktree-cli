import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { parse as parseToml } from 'toml';
import { execSync } from 'child_process';
const DEFAULT_CONFIG = {
    project: {
        name: 'project',
        worktree_dir: '.worktrees',
    },
    ports: {
        offset: 1000,
        max_worktrees: 5,
    },
    services: [],
};
export function findProjectRoot() {
    let current = process.cwd();
    while (current !== dirname(current)) {
        if (existsSync(join(current, '.git'))) {
            return current;
        }
        current = dirname(current);
    }
    throw new Error('Could not find project root (no .git directory found)');
}
export function loadMonorepoConfig(projectRoot) {
    const configPath = join(projectRoot, 'worktree.toml');
    if (!existsSync(configPath)) {
        console.warn('No worktree.toml found, using defaults');
        return DEFAULT_CONFIG;
    }
    const content = readFileSync(configPath, 'utf-8');
    const parsed = parseToml(content);
    return {
        project: {
            ...DEFAULT_CONFIG.project,
            ...parsed.project,
        },
        ports: {
            ...DEFAULT_CONFIG.ports,
            ...parsed.ports,
        },
        services: parsed.services || [],
        kong_local: parsed.kong_local,
        hooks: parsed.hooks,
    };
}
export function generateName() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let i = 0; i < 4; i++) {
        suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `wt-${suffix}`;
}
export function generateBranchName(worktreeName) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `worktree/${worktreeName}-${date}`;
}
export function getExistingWorktrees(projectRoot) {
    try {
        const output = execSync('git worktree list --porcelain', {
            cwd: projectRoot,
            encoding: 'utf-8',
        });
        const worktrees = [];
        let current = {};
        for (const line of output.trim().split('\n')) {
            if (line.startsWith('worktree ')) {
                if (current.path)
                    worktrees.push(current);
                current = { path: line.slice(9) };
            }
            else if (line.startsWith('branch ')) {
                current.branch = line.slice(7);
            }
        }
        if (current.path)
            worktrees.push(current);
        return worktrees;
    }
    catch {
        return [];
    }
}
export function getWorktreeConfig(options) {
    const projectRoot = findProjectRoot();
    const config = loadMonorepoConfig(projectRoot);
    const name = options.name ?? generateName();
    const branch = options.branch ?? generateBranchName(name);
    const baseBranch = options.baseBranch ?? 'main';
    const worktreesDir = join(projectRoot, config.project.worktree_dir);
    const worktreePath = join(worktreesDir, name);
    // Slot is assigned during createWorktree
    return {
        name,
        branch,
        baseBranch,
        slot: 0,
        projectRoot,
        worktreePath,
        monorepoConfig: config,
    };
}
export function configExists(projectRoot) {
    return existsSync(join(projectRoot, 'worktree.toml'));
}
export function getWorktreeName(worktreePath) {
    const parts = worktreePath.split(/[/\\]/);
    return parts[parts.length - 1];
}
export function generateConfigTemplate(projectName) {
    return `# Worktree CLI configuration for ${projectName}

[project]
name = "${projectName}"
worktree_dir = ".worktrees"

[ports]
offset = 1000
max_worktrees = 5

# Define services below. Each [[services]] block defines a Docker Compose service.
# Worktree N gets host ports: basePort + (N * offset)
# Container ports always use the base port.

# Example:
# [[services]]
# name = "api"
# path = "api"
# dockerfile = "Dockerfile.dev"
# command = "npm run dev"
# [services.ports]
#   main = 3000
# [services.env]
#   PORT = "3000"
#   NODE_ENV = "development"
# [services.healthcheck]
#   path = "/health"
#   interval = "10s"
#   retries = 5
#   start_period = "30s"
# [services.volumes]
#   "api/src" = "/app/src:ro"

[hooks]
post_create = ["npm install"]
`;
}
export function getServicePorts(config, slot) {
    const results = [];
    for (const service of config.services) {
        for (const [portName, basePort] of Object.entries(service.ports)) {
            results.push({
                service: service.name,
                port: portName,
                base: basePort,
                host: basePort + (slot * config.ports.offset),
            });
        }
    }
    return results;
}
//# sourceMappingURL=config.js.map