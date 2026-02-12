import { execSync } from 'child_process';
function buildBaseCmd(options) {
    let cmd = `docker compose -f "${options.composePath}"`;
    if (options.projectName) {
        cmd += ` -p "${options.projectName}"`;
    }
    return cmd;
}
export function dockerComposeUp(options) {
    let cmd = `${buildBaseCmd(options)} up`;
    if (options.build)
        cmd += ' --build';
    if (options.detach !== false)
        cmd += ' -d';
    if (options.services?.length) {
        cmd += ` ${options.services.join(' ')}`;
    }
    execSync(cmd, { stdio: 'inherit' });
}
export function dockerComposeDown(options) {
    let cmd = `${buildBaseCmd(options)} down`;
    if (options.removeVolumes)
        cmd += ' -v';
    execSync(cmd, { stdio: 'inherit' });
}
export function dockerComposeLogs(options) {
    let cmd = `${buildBaseCmd(options)} logs`;
    if (options.follow !== false)
        cmd += ' -f';
    if (options.services?.length) {
        cmd += ` ${options.services.join(' ')}`;
    }
    try {
        execSync(cmd, { stdio: 'inherit' });
    }
    catch {
        // User pressed Ctrl+C to stop following logs
    }
}
export function dockerComposePs(options) {
    const cmd = `${buildBaseCmd(options)} ps`;
    try {
        return execSync(cmd, { encoding: 'utf-8' });
    }
    catch {
        return '';
    }
}
export function isDockerAvailable() {
    try {
        execSync('docker compose version', { stdio: 'pipe', encoding: 'utf-8' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Get the IP address of a running container
 */
export function getContainerIp(containerName, networkName) {
    try {
        // Network names with dashes need special handling in Go templates
        // Use index function for network names with special characters
        let cmd;
        if (networkName) {
            cmd = `docker inspect ${containerName} --format '{{(index .NetworkSettings.Networks "${networkName}").IPAddress}}'`;
        }
        else {
            cmd = `docker inspect ${containerName} --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`;
        }
        const ip = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        return ip || null;
    }
    catch {
        return null;
    }
}
/**
 * Wait for a container to be healthy
 */
export function waitForContainerHealthy(containerName, timeoutMs = 60000) {
    const start = Date.now();
    const pollInterval = 2000;
    while (Date.now() - start < timeoutMs) {
        try {
            const status = execSync(`docker inspect ${containerName} --format '{{.State.Health.Status}}'`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            if (status === 'healthy') {
                return true;
            }
        }
        catch {
            // Container may not exist yet
        }
        // Sleep for poll interval
        execSync(`sleep ${pollInterval / 1000}`, { stdio: 'pipe' });
    }
    return false;
}
/**
 * Check if a container is running
 */
export function isContainerRunning(containerName) {
    try {
        const status = execSync(`docker inspect ${containerName} --format '{{.State.Running}}'`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        return status === 'true';
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=docker.js.map