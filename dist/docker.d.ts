export interface ComposeCommandOptions {
    composePath: string;
    projectName?: string;
}
export declare function dockerComposeUp(options: ComposeCommandOptions & {
    build?: boolean;
    detach?: boolean;
    services?: string[];
}): void;
export declare function dockerComposeDown(options: ComposeCommandOptions & {
    removeVolumes?: boolean;
}): void;
export declare function dockerComposeLogs(options: ComposeCommandOptions & {
    follow?: boolean;
    services?: string[];
}): void;
export declare function dockerComposePs(options: ComposeCommandOptions): string;
export declare function isDockerAvailable(): boolean;
/**
 * Get the IP address of a running container
 */
export declare function getContainerIp(containerName: string, networkName?: string): string | null;
/**
 * Wait for a container to be healthy
 */
export declare function waitForContainerHealthy(containerName: string, timeoutMs?: number): boolean;
/**
 * Check if a container is running
 */
export declare function isContainerRunning(containerName: string): boolean;
//# sourceMappingURL=docker.d.ts.map