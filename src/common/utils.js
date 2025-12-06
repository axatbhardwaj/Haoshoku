import { spawn } from "bun";
import chalk from "chalk";

export const log = {
  info: (msg) => console.log(chalk.blue(msg)),
  success: (msg) => console.log(chalk.green(msg)),
  warning: (msg) => console.log(chalk.yellow(msg)),
  error: (msg) => console.error(chalk.red(msg)),
  dim: (msg) => console.log(chalk.dim(msg)),
};

export async function runCommand(
  command,
  options = { check: true }
) {
  log.dim(`Executing: ${command}`);

    // Auto-detect shell usage if not explicitly set
    const useShell = options.shell || ["|", "&&", ";", ">", "<", "*", "?", "$", '"', "'"].some(char => command.includes(char));

  try {
      const proc = spawn(useShell ? ["sh", "-c", command] : command.split(" "), {
      cwd: options.cwd,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    if (options.check && exitCode !== 0) {
      log.error(`Command '${command}' failed with exit code ${exitCode}`);
      return false;
    }
    return exitCode === 0;
  } catch (error) {
    log.error(`Failed to execute command: ${command}`);
    console.error(error);
    return false;
  }
}

export async function commandExists(command) {
  const proc = spawn(["which", command], { stdout: "ignore", stderr: "ignore" });
  const exitCode = await proc.exited;
  return exitCode === 0;
}
