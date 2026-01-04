import { spawn } from "bun";
import { resolve } from "path";
import { readFileSync, writeFileSync } from "fs";
import prompts from "prompts";
import chalk from "chalk";

const log = {
  info: (msg) => console.log(chalk.blue(msg)),
  success: (msg) => console.log(chalk.green(msg)),
  warning: (msg) => console.log(chalk.yellow(msg)),
  error: (msg) => console.error(chalk.red(msg)),
  dim: (msg) => console.log(chalk.dim(msg)),
};

async function runCommand(command, args, options = {}) {
  log.dim(`Executing: ${command} ${args.join(" ")}`);
  
  const proc = spawn([command, ...args], {
    cwd: options.cwd || process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
    ...options
  });

  const exitCode = await proc.exited;
  
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}`);
  }
}

async function isGitClean() {
  const proc = spawn(["git", "status", "--porcelain"], {
    stdout: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  return output.trim() === "";
}

async function main() {
  log.info("🚀 Starting release process...");

  // 1. Check git status
  if (!await isGitClean()) {
    log.error("Git working directory is not clean. Please commit or stash changes.");
    process.exit(1);
  }

  // 2. Read package.json
  const packagePath = resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
  const currentVersion = pkg.version;

  log.info(`Current version: ${chalk.bold(currentVersion)}`);

  // 3. Prompt for version
  const response = await prompts({
    type: 'select',
    name: 'bump',
    message: 'Select version bump',
    choices: [
      { title: 'Patch', value: 'patch' },
      { title: 'Minor', value: 'minor' },
      { title: 'Major', value: 'major' },
      { title: 'Custom', value: 'custom' }
    ]
  });

  if (!response.bump) process.exit(0);

  let newVersion;
  if (response.bump === 'custom') {
    const custom = await prompts({
      type: 'text',
      name: 'version',
      message: 'Enter version number',
      validate: value => /^\d+\.\d+\.\d+/.test(value) ? true : 'Invalid version format (x.y.z)'
    });
    newVersion = custom.version;
  } else {
    const [major, minor, patch] = currentVersion.split('.').map(Number);
    switch (response.bump) {
      case 'patch': newVersion = `${major}.${minor}.${patch + 1}`; break;
      case 'minor': newVersion = `${major}.${minor + 1}.0`; break;
      case 'major': newVersion = `${major + 1}.0.0`; break;
    }
  }

  if (!newVersion) process.exit(0);

  const confirm = await prompts({
    type: 'confirm',
    name: 'value',
    message: `Ready to release v${newVersion}?`,
    initial: true
  });

  if (!confirm.value) process.exit(0);

  try {
    // 4. Update package.json
    pkg.version = newVersion;
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
    log.success(`Updated package.json to v${newVersion}`);

    // 5. Git operations
    await runCommand("git", ["add", "package.json"]);
    await runCommand("git", ["commit", "-m", `chore: release v${newVersion}`]);
    await runCommand("git", ["tag", "-a", `v${newVersion}`, "-m", `Release v${newVersion}`]);
    
    log.info("Pushing to GitHub...");
    await runCommand("git", ["push", "--follow-tags"]);

    // 6. GitHub Release
    log.info("Creating GitHub Release...");
    await runCommand("gh", ["release", "create", `v${newVersion}`, "--generate-notes"]);

    log.success(`✨ Release v${newVersion} completed successfully!`);
    
  } catch (error) {
    log.error(error.message);
    log.warning("Release failed. You may need to manually revert changes.");
    process.exit(1);
  }
}

main().catch(console.error);
