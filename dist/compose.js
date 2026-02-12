import { writeFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { calculateHostPort } from './ports.js';
export function generateCompose(options) {
    const { worktreeName, slot, config } = options;
    const { offset } = config.ports;
    const isMain = slot === 0;
    const prefix = isMain ? config.project.name : `wt-${worktreeName}`;
    const networkName = prefix;
    const services = {};
    const volumes = {};
    for (const service of config.services) {
        const svc = {};
        svc.container_name = `${prefix}-${service.name}`;
        // Image or build context
        if (service.image) {
            svc.image = service.image;
        }
        else if (service.path) {
            svc.build = {
                context: `./${service.path}`,
                dockerfile: service.dockerfile || 'Dockerfile',
            };
        }
        // Command override
        if (service.command) {
            svc.command = service.command;
        }
        // Port mappings: hostPort:containerPort
        if (service.ports && Object.keys(service.ports).length > 0) {
            svc.ports = Object.entries(service.ports).map(([, basePort]) => {
                const hostPort = calculateHostPort(basePort, slot, offset);
                return `${hostPort}:${basePort}`;
            });
        }
        // Environment variables
        if (service.env) {
            const env = {};
            for (const [key, value] of Object.entries(service.env)) {
                let resolved = value;
                // Resolve {serviceName.portName.host} → host-mapped port for browser-facing env vars
                resolved = resolved.replace(/\{(\w+)\.(\w+)\.host\}/g, (match, svcName, portName) => {
                    const targetSvc = config.services.find(s => s.name === svcName);
                    if (targetSvc?.ports[portName] !== undefined) {
                        return String(calculateHostPort(targetSvc.ports[portName], slot, offset));
                    }
                    return match;
                });
                env[key] = resolved;
            }
            svc.environment = env;
        }
        // Volumes (bind mounts + named volumes)
        const svcVolumes = [];
        if (service.volumes) {
            for (const [hostPath, containerPath] of Object.entries(service.volumes)) {
                svcVolumes.push(`./${hostPath}:${containerPath}`);
            }
        }
        if (service.named_volumes) {
            for (const [volumeName, mountPath] of Object.entries(service.named_volumes)) {
                const qualifiedName = isMain ? volumeName : `wt-${worktreeName}-${volumeName}`;
                svcVolumes.push(`${qualifiedName}:${mountPath}`);
                volumes[qualifiedName] = {};
            }
        }
        if (svcVolumes.length > 0) {
            svc.volumes = svcVolumes;
        }
        // Healthcheck
        if (service.healthcheck) {
            if (service.healthcheck.path && service.ports?.main !== undefined) {
                // HTTP healthcheck against the service's main port (container-internal)
                svc.healthcheck = {
                    test: ['CMD', 'curl', '-f', `http://localhost:${service.ports.main}${service.healthcheck.path}`],
                    interval: service.healthcheck.interval || '10s',
                    retries: service.healthcheck.retries || 5,
                    start_period: service.healthcheck.start_period || '30s',
                };
            }
            else if (service.healthcheck.test) {
                // Shell-based healthcheck
                svc.healthcheck = {
                    test: ['CMD-SHELL', service.healthcheck.test],
                    interval: service.healthcheck.interval || '10s',
                    retries: service.healthcheck.retries || 5,
                    start_period: service.healthcheck.start_period || '30s',
                };
            }
        }
        // Dependencies
        if (service.depends_on) {
            const deps = {};
            for (const [depName, condition] of Object.entries(service.depends_on)) {
                deps[depName] = { condition };
            }
            svc.depends_on = deps;
        }
        // Network
        svc.networks = [networkName];
        services[service.name] = svc;
    }
    const compose = {
        version: '3.8',
        services,
        networks: {
            [networkName]: { driver: 'bridge' },
        },
    };
    if (Object.keys(volumes).length > 0) {
        compose.volumes = volumes;
    }
    return compose;
}
export function writeComposeFile(filePath, compose) {
    const yamlStr = yaml.dump(compose, {
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
    });
    writeFileSync(filePath, yamlStr);
}
//# sourceMappingURL=compose.js.map