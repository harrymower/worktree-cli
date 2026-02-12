import { MonorepoConfig } from './config.js';
export interface ComposeOptions {
    worktreeName: string;
    slot: number;
    config: MonorepoConfig;
}
export declare function generateCompose(options: ComposeOptions): Record<string, unknown>;
export declare function writeComposeFile(filePath: string, compose: Record<string, unknown>): void;
//# sourceMappingURL=compose.d.ts.map