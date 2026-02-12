interface SlotMap {
    [worktreeName: string]: number;
}
export declare function loadSlots(projectRoot: string, worktreeDir: string): SlotMap;
export declare function assignSlot(projectRoot: string, worktreeDir: string, worktreeName: string, maxWorktrees: number): number;
export declare function releaseSlot(projectRoot: string, worktreeDir: string, worktreeName: string): void;
export declare function getSlot(projectRoot: string, worktreeDir: string, worktreeName: string): number | null;
export declare function calculateHostPort(basePort: number, slot: number, offset: number): number;
export {};
//# sourceMappingURL=ports.d.ts.map