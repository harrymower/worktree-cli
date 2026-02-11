import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

interface SlotMap {
  [worktreeName: string]: number;
}

const SLOTS_FILENAME = '.slots.json';

function getSlotsFilePath(projectRoot: string, worktreeDir: string): string {
  return join(projectRoot, worktreeDir, SLOTS_FILENAME);
}

export function loadSlots(projectRoot: string, worktreeDir: string): SlotMap {
  const filePath = getSlotsFilePath(projectRoot, worktreeDir);
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSlots(projectRoot: string, worktreeDir: string, slots: SlotMap): void {
  const dir = join(projectRoot, worktreeDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getSlotsFilePath(projectRoot, worktreeDir), JSON.stringify(slots, null, 2));
}

export function assignSlot(
  projectRoot: string,
  worktreeDir: string,
  worktreeName: string,
  maxWorktrees: number,
): number {
  const slots = loadSlots(projectRoot, worktreeDir);
  if (slots[worktreeName] !== undefined) return slots[worktreeName];

  const usedSlots = new Set(Object.values(slots));
  for (let i = 1; i <= maxWorktrees; i++) {
    if (!usedSlots.has(i)) {
      slots[worktreeName] = i;
      saveSlots(projectRoot, worktreeDir, slots);
      return i;
    }
  }

  throw new Error(`No available slots (max: ${maxWorktrees}). Remove a worktree first.`);
}

export function releaseSlot(projectRoot: string, worktreeDir: string, worktreeName: string): void {
  const slots = loadSlots(projectRoot, worktreeDir);
  delete slots[worktreeName];
  saveSlots(projectRoot, worktreeDir, slots);
}

export function getSlot(projectRoot: string, worktreeDir: string, worktreeName: string): number | null {
  const slots = loadSlots(projectRoot, worktreeDir);
  return slots[worktreeName] ?? null;
}

export function calculateHostPort(basePort: number, slot: number, offset: number): number {
  return basePort + (slot * offset);
}
