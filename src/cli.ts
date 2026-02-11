import { writeFileSync } from 'fs';
import { join, basename } from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  getWorktreeConfig,
  findProjectRoot,
  generateConfigTemplate,
  configExists,
} from './config.js';
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  cleanupAll,
  startDev,
  stopDev,
  statusDev,
  logsDev,
  printEnvConfig,
} from './operations.js';

const program = new Command();

program
  .name('worktree')
  .description('CLI for managing ephemeral Git worktrees with Docker Compose orchestration')
  .version('0.2.0');

program
  .command('init')
  .description('Initialize worktree.toml configuration in the current project')
  .option('-f, --force', 'Overwrite existing worktree.toml')
  .option('-n, --name <name>', 'Project name (defaults to directory name)')
  .action((options) => {
    try {
      const projectRoot = findProjectRoot();
      const configPath = join(projectRoot, 'worktree.toml');

      if (configExists(projectRoot) && !options.force) {
        console.log(chalk.yellow('worktree.toml already exists.'));
        console.log(chalk.dim('Use --force to overwrite.'));
        process.exit(1);
      }

      const projectName = options.name ?? basename(projectRoot);
      const template = generateConfigTemplate(projectName);

      writeFileSync(configPath, template);

      console.log();
      console.log(chalk.green.bold('Initialized worktree.toml'));
      console.log(chalk.dim('─'.repeat(40)));
      console.log(`  Project: ${chalk.white(projectName)}`);
      console.log(`  Config:  ${chalk.white(configPath)}`);
      console.log();
      console.log(chalk.dim('Next steps:'));
      console.log(chalk.cyan('  1. Edit worktree.toml to define your services'));
      console.log(chalk.cyan('  2. Add .worktrees/ to .gitignore'));
      console.log(chalk.cyan('  3. Run: worktree create'));
      console.log();
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('create')
  .description('Create a new worktree with isolated Docker Compose environment')
  .option('-n, --name <name>', 'Worktree name (auto-generated if not provided)')
  .option('-b, --branch <branch>', 'Branch name (auto-generated if not provided)')
  .option('--base <branch>', 'Base branch to create from', 'main')
  .option('-f, --force', 'Replace existing worktree if it exists')
  .option('--skip-hooks', 'Skip post-create hooks (e.g., npm install)')
  .option('--code', 'Open worktree in VS Code after creation')
  .action(async (options) => {
    try {
      const config = getWorktreeConfig({
        name: options.name,
        branch: options.branch,
        baseBranch: options.base,
      });

      const success = createWorktree(config, {
        force: options.force,
        skipHooks: options.skipHooks,
      });

      if (success && options.code) {
        const { execSync } = await import('child_process');
        try {
          execSync(`code "${config.worktreePath}"`, { stdio: 'inherit' });
        } catch {
          console.log(chalk.yellow('Could not open VS Code automatically'));
        }
      }

      process.exit(success ? 0 : 1);
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('remove')
  .description('Remove a worktree and its Docker Compose environment')
  .requiredOption('-n, --name <name>', 'Worktree name to remove')
  .option('-d, --delete-branch', 'Also delete the Git branch')
  .option('--delete-remote', 'Also delete the remote branch (requires --delete-branch)')
  .option('-v, --volumes', 'Also remove Docker volumes')
  .option('-f, --force', 'Skip confirmation, discard uncommitted changes')
  .action((options) => {
    try {
      const success = removeWorktree(options.name, {
        deleteBranch: options.deleteBranch,
        deleteRemote: options.deleteRemote,
        removeVolumes: options.volumes,
        force: options.force,
      });

      process.exit(success ? 0 : 1);
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all worktrees with slot and port information')
  .option('-d, --detailed', 'Show ports, service URLs, and git status')
  .action((options) => {
    try {
      listWorktrees(options.detailed);
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('cleanup')
  .description('Remove ALL worktrees (except main)')
  .option('-f, --force', 'Skip confirmation, discard uncommitted changes')
  .option('-v, --volumes', 'Also remove Docker volumes')
  .action((options) => {
    try {
      cleanupAll(options.force, options.volumes);
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('dev')
  .description('Start Docker Compose development environment')
  .option('-n, --name <name>', 'Worktree name (auto-detects from current directory)')
  .option('--build', 'Rebuild Docker images before starting')
  .option('--services <services>', 'Comma-separated list of services to start')
  .option('--stop', 'Stop the development environment (alias for worktree stop)')
  .option('--local', 'Use local CLI and SDK (equivalent to --local-cli --local-sdk)')
  .option('--local-cli', 'Configure CLI to run from source (ts-node)')
  .option('--local-sdk', 'Link local SDK via yalc')
  .action(async (options) => {
    try {
      if (options.stop) {
        const success = stopDev({ worktreeName: options.name });
        process.exit(success ? 0 : 1);
      }

      const services = options.services
        ? options.services.split(',').map((s: string) => s.trim())
        : undefined;

      // --local enables both --local-cli and --local-sdk
      const localCli = options.local || options.localCli;
      const localSdk = options.local || options.localSdk;

      const success = await startDev({
        worktreeName: options.name,
        build: options.build,
        services,
        localCli,
        localSdk,
      });
      process.exit(success ? 0 : 1);
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop Docker Compose development environment')
  .option('-n, --name <name>', 'Worktree name (auto-detects from current directory)')
  .option('-v, --volumes', 'Also remove Docker volumes')
  .option('--clean', 'Also remove yalc links and restore published packages')
  .action((options) => {
    try {
      const success = stopDev({
        worktreeName: options.name,
        removeVolumes: options.volumes,
        cleanYalc: options.clean,
      });
      process.exit(success ? 0 : 1);
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show Docker Compose service status and port mappings')
  .option('-n, --name <name>', 'Worktree name (auto-detects from current directory)')
  .action((options) => {
    try {
      statusDev(options.name);
      process.exit(0);
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('logs')
  .description('Tail Docker Compose service logs')
  .option('-n, --name <name>', 'Worktree name (auto-detects from current directory)')
  .option('--services <services>', 'Comma-separated list of services to show logs for')
  .action((options) => {
    try {
      const services = options.services
        ? options.services.split(',').map((s: string) => s.trim())
        : undefined;

      logsDev({
        worktreeName: options.name,
        services,
      });
      process.exit(0);
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('env')
  .description('Output shell configuration for local development (use with eval)')
  .option('-n, --name <name>', 'Worktree name (auto-detects from current directory)')
  .option('--local-cli', 'Include CLI alias to run from source')
  .option('--export', 'Use export syntax (for sourcing in scripts)')
  .action((options) => {
    try {
      printEnvConfig({
        worktreeName: options.name,
        localCli: options.localCli,
        useExport: options.export,
      });
      process.exit(0);
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

export { program };
