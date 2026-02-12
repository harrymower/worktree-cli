import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { findProjectRoot, loadMonorepoConfig, getExistingWorktrees, getWorktreeName, getServicePorts, } from './config.js';
import { fetchOrigin, createWorktree as gitCreateWorktree, removeWorktree as gitRemoveWorktree, getCurrentBranch, hasUncommittedChanges, deleteBranch, } from './git.js';
import { assignSlot, releaseSlot, getSlot, loadSlots } from './ports.js';
import { generateCompose, writeComposeFile } from './compose.js';
import { dockerComposeUp, dockerComposeDown, dockerComposeLogs, dockerComposePs, isDockerAvailable, getContainerIp, waitForContainerHealthy, } from './docker.js';
import crypto from 'crypto';
// ── Logging helpers ──────────────────────────────────────────────────
function log(message) {
    console.log(message);
}
function logSuccess(message) {
    console.log(chalk.green('✓ ' + message));
}
function logWarning(message) {
    console.log(chalk.yellow('⚠ ' + message));
}
function logError(message) {
    console.log(chalk.red('✗ ' + message));
}
function logDim(message) {
    console.log(chalk.dim(message));
}
/**
 * Detect the real project root, handling being inside a worktree.
 * Worktrees live under {projectRoot}/.worktrees/{name}/.
 */
function findRealProjectRoot() {
    const cwd = process.cwd().replace(/\\/g, '/');
    // Check if .worktrees is in the path
    const idx = cwd.indexOf('/.worktrees/');
    if (idx !== -1) {
        const projectRoot = cwd.slice(0, idx);
        const afterWorktrees = cwd.slice(idx + '/.worktrees/'.length);
        const worktreeName = afterWorktrees.split('/')[0];
        return { projectRoot, isInWorktree: true, worktreeName };
    }
    return { projectRoot: findProjectRoot(), isInWorktree: false, worktreeName: null };
}
function getComposeFilename(worktreeName) {
    if (!worktreeName) {
        return 'docker-compose.yml';
    }
    return `docker-compose.wt-${worktreeName}.yml`;
}
function getComposePath(projectRoot, config, worktreeName) {
    if (!worktreeName) {
        return join(projectRoot, 'docker-compose.yml');
    }
    return join(projectRoot, config.project.worktree_dir, worktreeName, getComposeFilename(worktreeName));
}
function getComposeProject(config, worktreeName) {
    return worktreeName ? `wt-${worktreeName}` : config.project.name;
}
/**
 * Detect the current development context (main project or worktree).
 * Optionally override with an explicit worktree name.
 */
export function getDevContext(worktreeName) {
    const { projectRoot, isInWorktree, worktreeName: detectedName } = findRealProjectRoot();
    const config = loadMonorepoConfig(projectRoot);
    // Explicit name takes precedence
    const effectiveName = worktreeName ?? detectedName;
    if (effectiveName) {
        const worktreePath = join(projectRoot, config.project.worktree_dir, effectiveName);
        if (!existsSync(worktreePath)) {
            throw new Error(`Worktree '${effectiveName}' not found at ${worktreePath}`);
        }
        const slot = getSlot(projectRoot, config.project.worktree_dir, effectiveName);
        if (slot === null) {
            throw new Error(`No slot assigned for worktree '${effectiveName}'. Was it created with this CLI?`);
        }
        return {
            projectRoot,
            workingDir: worktreePath,
            isWorktree: true,
            worktreeName: effectiveName,
            slot,
            composePath: getComposePath(projectRoot, config, effectiveName),
            composeProject: getComposeProject(config, effectiveName),
            config,
        };
    }
    // Main project (slot 0)
    return {
        projectRoot,
        workingDir: projectRoot,
        isWorktree: false,
        worktreeName: null,
        slot: 0,
        composePath: getComposePath(projectRoot, config, null),
        composeProject: getComposeProject(config, null),
        config,
    };
}
// ── Git safe.directory ───────────────────────────────────────────────
function addToGitSafeDirectory(worktreePath) {
    try {
        const safeDirectories = execSync('git config --global --get-all safe.directory 2>/dev/null || true', {
            encoding: 'utf-8',
        }).trim().split('\n').filter(Boolean);
        if (!safeDirectories.includes(worktreePath)) {
            execSync(`git config --global --add safe.directory "${worktreePath}"`, { stdio: 'pipe' });
            logSuccess('Added worktree to git safe.directory');
        }
    }
    catch {
        logWarning('Could not add worktree to git safe.directory');
    }
}
export function createWorktree(config, options = {}) {
    const { force = false, skipHooks = false } = options;
    const { name, branch, baseBranch, projectRoot, worktreePath, monorepoConfig } = config;
    // Assign a slot for port allocation
    let slot;
    try {
        slot = assignSlot(projectRoot, monorepoConfig.project.worktree_dir, name, monorepoConfig.ports.max_worktrees);
    }
    catch (error) {
        logError(`${error}`);
        return false;
    }
    const ports = getServicePorts(monorepoConfig, slot);
    console.log();
    console.log(chalk.cyan.bold('Creating Worktree'));
    console.log(chalk.dim('─'.repeat(40)));
    console.log(`  Name:   ${chalk.white(name)}`);
    console.log(`  Branch: ${chalk.white(branch)}`);
    console.log(`  Slot:   ${chalk.white(String(slot))}`);
    console.log(`  Path:   ${chalk.white(worktreePath)}`);
    console.log();
    console.log(chalk.bold('  Ports:'));
    for (const p of ports) {
        console.log(`    ${p.service}/${p.port}: ${chalk.white(String(p.host))} → ${p.base}`);
    }
    console.log();
    // Check if worktree already exists
    if (existsSync(worktreePath)) {
        if (force) {
            logWarning('Removing existing worktree...');
            gitRemoveWorktree(worktreePath, projectRoot);
        }
        else {
            logError(`Worktree already exists: ${worktreePath}`);
            log('Use --force to replace it, or remove it first.');
            releaseSlot(projectRoot, monorepoConfig.project.worktree_dir, name);
            return false;
        }
    }
    // Ensure worktrees directory exists
    const worktreesDir = dirname(worktreePath);
    if (!existsSync(worktreesDir)) {
        mkdirSync(worktreesDir, { recursive: true });
    }
    // Fetch latest
    logDim('Fetching latest from remote...');
    try {
        fetchOrigin(projectRoot);
    }
    catch {
        logWarning('Could not fetch from remote (continuing anyway)');
    }
    // Create git worktree
    try {
        gitCreateWorktree(worktreePath, branch, baseBranch, projectRoot);
        logSuccess('Git worktree created');
    }
    catch (error) {
        logError(`Failed to create worktree: ${error}`);
        releaseSlot(projectRoot, monorepoConfig.project.worktree_dir, name);
        return false;
    }
    addToGitSafeDirectory(worktreePath);
    // Copy .env.local if exists
    const envLocalSrc = join(projectRoot, '.env.local');
    const envLocalDst = join(worktreePath, '.env.local');
    if (existsSync(envLocalSrc) && !existsSync(envLocalDst)) {
        copyFileSync(envLocalSrc, envLocalDst);
        logSuccess('Copied .env.local');
    }
    // Generate Docker Compose file for this worktree
    try {
        const compose = generateCompose({
            worktreeName: name,
            slot,
            config: monorepoConfig,
        });
        const composeFilename = getComposeFilename(name);
        const composePath = join(worktreePath, composeFilename);
        writeComposeFile(composePath, compose);
        logSuccess(`Generated ${composeFilename}`);
    }
    catch (error) {
        logWarning(`Could not generate docker-compose.yml: ${error}`);
    }
    // Run post-create hooks
    if (!skipHooks) {
        runPostCreateHooks(config);
    }
    else {
        logDim('Skipping post-create hooks (--skip-hooks)');
    }
    // Print success message
    printSuccessMessage(config, slot);
    return true;
}
function runPostCreateHooks(config) {
    const { worktreePath, monorepoConfig } = config;
    const hooks = monorepoConfig.hooks?.post_create;
    if (!hooks || hooks.length === 0)
        return;
    logDim('Running post-create hooks...');
    for (const hook of hooks) {
        try {
            logDim(`  → ${hook}`);
            const output = execSync(hook, {
                cwd: worktreePath,
                stdio: 'pipe',
                shell: '/bin/sh',
                encoding: 'utf-8',
            });
            if (output?.trim()) {
                console.log(output);
            }
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logWarning(`Hook failed: ${hook} — ${errorMsg}`);
        }
    }
    logSuccess('Post-create hooks completed');
}
function printSuccessMessage(config, slot) {
    const { name, branch, worktreePath, monorepoConfig } = config;
    const ports = getServicePorts(monorepoConfig, slot);
    console.log();
    console.log(chalk.green.bold('Worktree Ready!'));
    console.log(chalk.dim('─'.repeat(40)));
    console.log(`  ${chalk.bold('Name:')}   ${name}`);
    console.log(`  ${chalk.bold('Path:')}   ${worktreePath}`);
    console.log(`  ${chalk.bold('Branch:')} ${branch}`);
    console.log(`  ${chalk.bold('Slot:')}   ${slot}`);
    console.log();
    console.log(`  ${chalk.bold('To work in this worktree:')}`);
    console.log(chalk.cyan(`    cd ${worktreePath}`));
    console.log();
    console.log(`  ${chalk.bold('Service URLs:')}`);
    for (const p of ports) {
        console.log(`    ${p.service}/${p.port}: http://localhost:${p.host}`);
    }
    console.log();
    console.log(`  ${chalk.bold('Start the dev stack:')}`);
    console.log(chalk.cyan(`    worktree dev -n ${name}`));
    console.log();
}
export function removeWorktree(name, options = {}) {
    const projectRoot = findProjectRoot();
    const config = loadMonorepoConfig(projectRoot);
    const worktreesDir = join(projectRoot, config.project.worktree_dir);
    const worktreePath = join(worktreesDir, name);
    if (!existsSync(worktreePath)) {
        logWarning(`Worktree does not exist: ${worktreePath}`);
        return true;
    }
    // Get branch name before removal
    let branchName = '';
    try {
        branchName = getCurrentBranch(worktreePath);
    }
    catch {
        // Ignore
    }
    console.log();
    console.log(chalk.yellow.bold('Removing Worktree'));
    console.log(chalk.dim('─'.repeat(40)));
    console.log(`  Name:   ${name}`);
    console.log(`  Branch: ${branchName || 'unknown'}`);
    console.log(`  Path:   ${worktreePath}`);
    console.log();
    // Check for uncommitted changes
    if (!options.force) {
        try {
            if (hasUncommittedChanges(worktreePath)) {
                logWarning('Worktree has uncommitted changes!');
                log('Use --force to discard changes, or commit them first.');
                return false;
            }
        }
        catch {
            // Ignore
        }
    }
    // Stop Docker Compose services if running
    const composeFilename = getComposeFilename(name);
    const composePath = join(worktreePath, composeFilename);
    if (existsSync(composePath)) {
        logDim('Stopping Docker Compose services...');
        try {
            dockerComposeDown({
                composePath,
                projectName: `wt-${name}`,
                removeVolumes: options.removeVolumes,
            });
            logSuccess('Docker Compose services stopped');
        }
        catch {
            logWarning('Could not stop Docker Compose services (may not be running)');
        }
    }
    // Remove git worktree
    logDim('Removing git worktree...');
    gitRemoveWorktree(worktreePath, projectRoot);
    logSuccess('Git worktree removed');
    // Release the port slot
    releaseSlot(projectRoot, config.project.worktree_dir, name);
    logSuccess('Port slot released');
    // Delete branch
    if (options.deleteBranch && branchName) {
        logDim(`Deleting branch: ${branchName}`);
        deleteBranch(branchName, projectRoot, options.deleteRemote);
        logSuccess('Branch deleted');
    }
    console.log();
    console.log(chalk.green.bold('Cleanup complete!'));
    return true;
}
export function listWorktrees(detailed = false) {
    const projectRoot = findProjectRoot();
    const config = loadMonorepoConfig(projectRoot);
    const worktreesDir = join(projectRoot, config.project.worktree_dir);
    const slots = loadSlots(projectRoot, config.project.worktree_dir);
    console.log();
    console.log(chalk.cyan.bold(`${config.project.name} Worktrees`));
    console.log(chalk.dim('─'.repeat(50)));
    const worktrees = getExistingWorktrees(projectRoot);
    let wtCount = 0;
    const normalizedProjectRoot = projectRoot.replace(/\\/g, '/').toLowerCase();
    for (const wt of worktrees) {
        const normalizedWtPath = wt.path.replace(/\\/g, '/').toLowerCase();
        const isMain = normalizedWtPath === normalizedProjectRoot;
        const name = isMain ? null : getWorktreeName(wt.path);
        if (isMain) {
            console.log(`${chalk.bold.white('[MAIN]')} ${wt.branch || 'unknown'} ${chalk.dim('(slot 0)')}`);
        }
        else {
            const slot = name ? (slots[name] ?? '?') : '?';
            console.log(`${chalk.bold.magenta(`[${name}]`)} ${wt.branch || 'unknown'} ${chalk.dim(`(slot ${slot})`)}`);
            wtCount++;
        }
        console.log(chalk.dim(`       Path: ${wt.path}`));
        if (detailed && name) {
            const slot = slots[name];
            if (slot !== undefined) {
                const ports = getServicePorts(config, slot);
                for (const p of ports) {
                    console.log(chalk.dim(`       ${p.service}/${p.port}: http://localhost:${p.host}`));
                }
            }
            try {
                const hasChanges = hasUncommittedChanges(wt.path);
                if (hasChanges) {
                    console.log(chalk.yellow('       Status: has uncommitted changes'));
                }
                else {
                    console.log(chalk.dim('       Status: clean'));
                }
            }
            catch {
                console.log(chalk.dim('       Status: unknown'));
            }
        }
        console.log();
    }
    console.log(`${chalk.bold('Total worktrees:')} ${wtCount}`);
    console.log(`${chalk.bold('Max slots:')} ${config.ports.max_worktrees}`);
    if (wtCount === 0) {
        console.log();
        console.log(chalk.dim('No worktrees. Create one with:'));
        console.log(chalk.yellow('  worktree create'));
    }
}
export function cleanupAll(force = false, removeVolumes = false) {
    const projectRoot = findProjectRoot();
    const config = loadMonorepoConfig(projectRoot);
    const worktreesDir = join(projectRoot, config.project.worktree_dir);
    const worktrees = getExistingWorktrees(projectRoot);
    let removed = 0;
    const normalizedProjectRoot = projectRoot.replace(/\\/g, '/').toLowerCase();
    const normalizedWorktreesDir = worktreesDir.replace(/\\/g, '/').toLowerCase();
    for (const wt of worktrees) {
        const normalizedWtPath = wt.path.replace(/\\/g, '/').toLowerCase();
        if (normalizedWtPath === normalizedProjectRoot)
            continue;
        if (normalizedWtPath.startsWith(normalizedWorktreesDir)) {
            const name = getWorktreeName(wt.path);
            logDim(`Removing ${name}...`);
            removeWorktree(name, { force, removeVolumes });
            removed++;
        }
    }
    if (removed === 0) {
        logWarning('No worktrees to clean up.');
    }
    else {
        console.log();
        console.log(chalk.green.bold(`Cleaned up ${removed} worktree(s).`));
    }
}
// ── Docker Compose dev workflow ──────────────────────────────────────
export async function startDev(options) {
    if (!isDockerAvailable()) {
        logError('Docker Compose is not available. Install Docker Desktop or docker-compose-plugin.');
        return false;
    }
    const context = getDevContext(options.worktreeName);
    console.log();
    console.log(chalk.cyan.bold('Starting Development Environment'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log(`  ${chalk.bold('Context:')}  ${context.isWorktree ? chalk.magenta(`[${context.worktreeName}]`) : chalk.white('[MAIN]')}`);
    console.log(`  ${chalk.bold('Slot:')}     ${context.slot}`);
    console.log(`  ${chalk.bold('Path:')}     ${context.workingDir}`);
    console.log(`  ${chalk.bold('Compose:')}  ${context.composePath}`);
    console.log();
    // For worktrees, ensure docker-compose.yml exists (regenerate if needed)
    if (context.isWorktree) {
        const compose = generateCompose({
            worktreeName: context.worktreeName,
            slot: context.slot,
            config: context.config,
        });
        writeComposeFile(context.composePath, compose);
        logSuccess('Docker Compose file generated');
    }
    // Print port table
    const ports = getServicePorts(context.config, context.slot);
    console.log(chalk.bold('  Service URLs:'));
    for (const p of ports) {
        console.log(`    ${p.service}/${p.port}: ${chalk.cyan(`http://localhost:${p.host}`)}`);
    }
    console.log();
    // Setup local CLI/SDK if requested
    if (options.localCli || options.localSdk) {
        setupLocalDev(context, {
            localCli: options.localCli,
            localSdk: options.localSdk,
        });
    }
    try {
        dockerComposeUp({
            composePath: context.composePath,
            projectName: context.composeProject,
            build: options.build,
            services: options.services,
        });
        console.log();
        logSuccess('Development environment started!');
        // Wait for services to be healthy and get container IPs
        const prefix = context.isWorktree ? `wt-${context.worktreeName}` : context.config.project.name;
        const neo4jContainer = `${prefix}-neo4j`;
        const coreApiContainer = `${prefix}-core-api`;
        const networkName = prefix;
        logDim('Waiting for services to be healthy...');
        // Wait for neo4j to be healthy first
        const neo4jHealthy = waitForContainerHealthy(neo4jContainer, 90000);
        if (!neo4jHealthy) {
            logWarning('Neo4j did not become healthy in time');
        }
        // Wait for core-api to be healthy
        const coreApiHealthy = waitForContainerHealthy(coreApiContainer, 60000);
        if (!coreApiHealthy) {
            logWarning('core-api did not become healthy in time');
        }
        // Get container IPs (don't pass networkName - container is typically on only one network)
        const neo4jIp = getContainerIp(neo4jContainer);
        const coreApiIp = getContainerIp(coreApiContainer);
        if (coreApiIp) {
            console.log();
            console.log(chalk.bold('  Container IPs (for devcontainer access):'));
            if (neo4jIp) {
                console.log(`    neo4j:    ${chalk.cyan(neo4jIp)}:7687`);
            }
            console.log(`    core-api: ${chalk.cyan(coreApiIp)}:3000`);
            // Create test user and API key
            logDim('Creating test user and API key...');
            const apiKeyFile = join(context.workingDir, 'core-api/.test-api-key');
            const apiKeyPepper = 'local-development-pepper-minimum-32-chars-here';
            const neo4jUri = neo4jIp ? `bolt://${neo4jIp}:7687` : 'bolt://neo4j:7687';
            const apiKey = await createTestUser(neo4jUri, apiKeyPepper, apiKeyFile);
            if (apiKey) {
                logSuccess('Test user created');
                console.log();
                console.log(chalk.bold.green('  Environment Configuration:'));
                console.log(chalk.dim('  ─────────────────────────────────────────────'));
                console.log(`  ${chalk.bold('MX_API_URL')}=${chalk.cyan(`http://${coreApiIp}:3000`)}`);
                console.log(`  ${chalk.bold('MX_API_KEY')}=${chalk.dim(apiKey.substring(0, 40))}...`);
                console.log();
                console.log(chalk.bold('  Quick setup:'));
                console.log(chalk.cyan(`    eval "$(worktree env)"`));
                console.log();
                console.log(chalk.bold('  Or manually:'));
                console.log(chalk.cyan(`    export MX_API_URL=http://${coreApiIp}:3000`));
                console.log(chalk.cyan(`    export MX_API_KEY=$(cat core-api/.test-api-key)`));
            }
            else {
                logWarning('Could not create test user. Create manually with create-user script.');
            }
        }
        console.log();
        console.log(chalk.bold('Commands:'));
        const nameFlag = context.isWorktree ? ` -n ${context.worktreeName}` : '';
        console.log(`  ${chalk.cyan(`worktree stop${nameFlag}`)}     Stop the environment`);
        console.log(`  ${chalk.cyan(`worktree status${nameFlag}`)}   Show container status`);
        console.log(`  ${chalk.cyan(`worktree logs${nameFlag}`)}     Tail service logs`);
        console.log();
        return true;
    }
    catch (error) {
        logError(`Failed to start: ${error}`);
        return false;
    }
}
export function stopDev(options) {
    const context = getDevContext(options.worktreeName);
    console.log();
    console.log(chalk.yellow.bold('Stopping Development Environment'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log(`  ${chalk.bold('Context:')} ${context.isWorktree ? chalk.magenta(`[${context.worktreeName}]`) : chalk.white('[MAIN]')}`);
    console.log();
    if (!existsSync(context.composePath)) {
        logWarning('No docker-compose.yml found. Nothing to stop.');
        return true;
    }
    try {
        dockerComposeDown({
            composePath: context.composePath,
            projectName: context.composeProject,
            removeVolumes: options.removeVolumes,
        });
        console.log();
        logSuccess('Development environment stopped.');
        // Clean up yalc links if requested
        if (options.cleanYalc) {
            cleanupLocalDev(context);
        }
        console.log();
        return true;
    }
    catch (error) {
        logError(`Failed to stop: ${error}`);
        return false;
    }
}
export function statusDev(worktreeName) {
    const context = getDevContext(worktreeName);
    console.log();
    console.log(chalk.cyan.bold('Development Environment Status'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log(`  ${chalk.bold('Context:')} ${context.isWorktree ? chalk.magenta(`[${context.worktreeName}]`) : chalk.white('[MAIN]')}`);
    console.log(`  ${chalk.bold('Slot:')}    ${context.slot}`);
    console.log();
    if (!existsSync(context.composePath)) {
        logWarning('No docker-compose.yml found.');
        log(`Run ${chalk.cyan('worktree dev')} to start the environment.`);
        return;
    }
    // Show port table
    const ports = getServicePorts(context.config, context.slot);
    console.log(chalk.bold('Port Mapping:'));
    console.log(chalk.dim('  Service/Port          Host → Container'));
    for (const p of ports) {
        const label = `${p.service}/${p.port}`.padEnd(22);
        console.log(`  ${label} ${p.host} → ${p.base}`);
    }
    console.log();
    // Show docker compose ps output
    console.log(chalk.bold('Containers:'));
    const psOutput = dockerComposePs({
        composePath: context.composePath,
        projectName: context.composeProject,
    });
    if (psOutput.trim()) {
        console.log(psOutput);
    }
    else {
        logDim('  No containers running.');
    }
    console.log();
}
export function logsDev(options) {
    const context = getDevContext(options.worktreeName);
    if (!existsSync(context.composePath)) {
        logWarning('No docker-compose.yml found.');
        log(`Run ${chalk.cyan('worktree dev')} to start the environment.`);
        return;
    }
    console.log();
    console.log(chalk.cyan.bold('Development Logs'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log(`  ${chalk.bold('Context:')} ${context.isWorktree ? chalk.magenta(`[${context.worktreeName}]`) : chalk.white('[MAIN]')}`);
    console.log(chalk.dim('  Press Ctrl+C to stop following logs'));
    console.log();
    dockerComposeLogs({
        composePath: context.composePath,
        projectName: context.composeProject,
        follow: true,
        services: options.services,
    });
}
// ── Local development helpers ────────────────────────────────────────
/**
 * Check if yalc is installed
 */
function isYalcAvailable() {
    try {
        execSync('yalc --version', { stdio: 'pipe' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Setup local CLI and/or SDK development
 */
function setupLocalDev(context, options) {
    console.log(chalk.bold('  Local Development Setup:'));
    if (options.localSdk) {
        if (!isYalcAvailable()) {
            logWarning('yalc is not installed. Install with: npm install -g yalc');
            log('         Skipping SDK linking.');
        }
        else {
            // Try to link SDK from releases/sdk-generator/output/typescript-sdk
            const sdkPath = join(context.projectRoot, 'releases/sdk-generator/output/typescript-sdk');
            const cliPath = join(context.projectRoot, 'cli');
            if (existsSync(sdkPath)) {
                logDim('  Publishing local SDK to yalc...');
                try {
                    execSync('yalc publish', { cwd: sdkPath, stdio: 'pipe' });
                    logSuccess('SDK published to yalc');
                }
                catch (error) {
                    logWarning(`Could not publish SDK: ${error}`);
                }
                // Link SDK to CLI
                if (existsSync(cliPath)) {
                    logDim('  Linking SDK to CLI...');
                    try {
                        execSync('yalc add @memnexus-ai/typescript-sdk', { cwd: cliPath, stdio: 'pipe' });
                        logSuccess('SDK linked to CLI');
                    }
                    catch (error) {
                        logWarning(`Could not link SDK to CLI: ${error}`);
                    }
                }
            }
            else {
                logWarning('SDK not found. Generate it first:');
                log('         cd releases/sdk-generator && npm run sdk:generate');
            }
        }
    }
    if (options.localCli) {
        // Just print instructions - actual alias is done via `worktree env`
        logSuccess('Local CLI mode enabled');
        log('         Use: eval "$(worktree env --local-cli)"');
        log('         Or run directly: cd cli && npm run dev:cli -- <args>');
    }
    console.log();
}
/**
 * Cleanup local development setup (remove yalc links)
 */
function cleanupLocalDev(context) {
    console.log();
    logDim('Cleaning up local development links...');
    const cliPath = join(context.projectRoot, 'cli');
    if (existsSync(cliPath)) {
        // Check if yalc.lock exists
        const yalcLock = join(cliPath, 'yalc.lock');
        if (existsSync(yalcLock)) {
            try {
                execSync('yalc remove --all', { cwd: cliPath, stdio: 'pipe' });
                execSync('npm install', { cwd: cliPath, stdio: 'pipe' });
                logSuccess('Removed yalc links and restored published packages');
            }
            catch (error) {
                logWarning(`Could not clean up yalc links: ${error}`);
            }
        }
        else {
            logDim('  No yalc links found.');
        }
    }
}
/**
 * Create a test user in Neo4j with a valid API key
 * Returns the API key if successful, null otherwise
 */
async function createTestUser(neo4jUri, apiKeyPepper, outputPath) {
    // We'll use a script approach since neo4j-driver may not be installed
    // Generate the API key components
    const keyId = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('hex');
    const apiKey = `${keyId}.${secret}`;
    // Hash the secret with the pepper
    const hashedSecret = crypto.createHmac('sha256', apiKeyPepper).update(secret).digest('hex');
    const userId = 'test-user-local';
    const userEmail = 'test@memnexus.local';
    // Create a Cypher query to run via docker exec
    const cypherQuery = `
    MERGE (u:User {id: '${userId}'})
    ON CREATE SET
      u.email = '${userEmail}',
      u.name = 'Test User',
      u.createdAt = datetime(),
      u.updatedAt = datetime()
    ON MATCH SET
      u.updatedAt = datetime()
    WITH u
    OPTIONAL MATCH (u)-[r:HAS_API_KEY]->(oldKey:ApiKey)
    DELETE r, oldKey
    WITH u
    CREATE (k:ApiKey {
      id: '${keyId}',
      userId: '${userId}',
      hash: '${hashedSecret}',
      label: 'Test API Key',
      status: 'active',
      createdAt: datetime(),
      usageCount: 0
    })
    CREATE (u)-[:HAS_API_KEY]->(k)
    RETURN u.id as userId, k.id as keyId
  `.replace(/\n/g, ' ').trim();
    try {
        // Extract container name from URI (bolt://container:port -> container)
        const containerMatch = neo4jUri.match(/bolt:\/\/([^:]+)/);
        if (!containerMatch) {
            logWarning('Could not parse Neo4j URI');
            return null;
        }
        // Run cypher-shell via docker exec on the neo4j container
        // The container name follows the pattern: wt-{worktreeName}-neo4j or memnexus-neo4j
        const cmd = `docker exec -i $(docker ps --filter "name=neo4j" --format "{{.Names}}" | head -1) cypher-shell -u neo4j -p localdevpassword "${cypherQuery}"`;
        execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' });
        // Save the API key to file
        const { writeFileSync } = await import('fs');
        writeFileSync(outputPath, apiKey);
        return apiKey;
    }
    catch (error) {
        logWarning(`Could not create test user: ${error}`);
        return null;
    }
}
/**
 * Print shell configuration for local development
 */
export function printEnvConfig(options) {
    const context = getDevContext(options.worktreeName);
    // Get container IP for core-api (works from devcontainer)
    const prefix = context.isWorktree ? `wt-${context.worktreeName}` : context.config.project.name;
    const coreApiContainer = `${prefix}-core-api`;
    // Don't pass networkName - container is typically on only one network
    const coreApiIp = getContainerIp(coreApiContainer);
    // Use container IP if available, otherwise fall back to localhost with port mapping
    let apiUrl;
    if (coreApiIp) {
        apiUrl = `http://${coreApiIp}:3000`;
    }
    else {
        const ports = getServicePorts(context.config, context.slot);
        const apiPort = ports.find((p) => p.service === 'core-api' && p.port === 'main');
        apiUrl = apiPort ? `http://localhost:${apiPort.host}` : 'http://localhost:3000';
    }
    const exportPrefix = options.useExport ? 'export ' : '';
    // Output environment variables (for eval)
    console.log(`${exportPrefix}MX_API_URL="${apiUrl}"`);
    // Try to find API key
    const apiKeyFile = join(context.workingDir, 'core-api/.test-api-key');
    if (existsSync(apiKeyFile)) {
        try {
            const apiKey = readFileSync(apiKeyFile, 'utf-8').trim();
            if (apiKey) {
                console.log(`${exportPrefix}MX_API_KEY="${apiKey}"`);
            }
        }
        catch {
            // Ignore
        }
    }
    // Add CLI alias if requested
    if (options.localCli) {
        const cliPath = join(context.projectRoot, 'cli');
        console.log(`alias mx='npx ts-node "${cliPath}/src/index.ts"'`);
    }
    // Add helpful comment
    console.log();
    console.log('# Usage: eval "$(worktree env)"');
    if (options.localCli) {
        console.log('# CLI alias "mx" now runs from source');
    }
}
//# sourceMappingURL=operations.js.map