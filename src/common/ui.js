import chalk from "chalk";
import figlet from "figlet";
import gradient from "gradient-string";
import ora from "ora";

/**
 * Generates the application banner string.
 * @returns {string} The colored banner string.
 */
export function getBanner() {
  const art = figlet.textSync("HAOSHOKU", { horizontalLayout: "full" });
  const banner = gradient.pastel.multiline(art) + "\n" + 
                 chalk.dim("  Haoshoku: Color of the Supreme King. Dominate your setup.\n");
  return banner;
}

/**
 * Displays the application banner.
 */
export function showBanner() {
  console.log(getBanner());
}

/**
 * Wraps an asynchronous function with a spinner.
 * @param {string} text - The text to display next to the spinner.
 * @param {Function} asyncFn - The async function to execute.
 * @returns {Promise<any>} - The result of the async function.
 */
export async function withSpinner(text, asyncFn) {
	const spinner = ora(text).start();
	try {
		const result = await asyncFn();
		spinner.succeed(chalk.green(`${text}`));
		return result;
	} catch (error) {
		spinner.fail(chalk.red(`${text} failed`));
		throw error;
	}
}
