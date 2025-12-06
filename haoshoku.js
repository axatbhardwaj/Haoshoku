#!/usr/bin/env bun
import { Command } from "commander";
import prompts from "prompts";
import { log } from "./src/common/utils.js";
import { runCachyOSSetup } from "./src/os_scripts/cachyos.js";
import { runDebianServerSetup } from "./src/os_scripts/debian_server.js";

import fs from "fs";

const program = new Command();

program
  .name("haoshoku")
  .description("Haoshoku: Color of the Supreme King. Dominate your setup.")
  .version("2.0.0");

function detectOS() {
  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf-8");
    const lines = osRelease.split("\n");
    const info = {};
    for (const line of lines) {
      const [key, value] = line.split("=");
      if (key && value) {
        info[key] = value.replace(/"/g, "");
      }
    }

    const id = info["ID"] ? info["ID"].toLowerCase() : "";
    const idLike = info["ID_LIKE"] ? info["ID_LIKE"].toLowerCase() : "";

    if (id.includes("cachyos") || idLike.includes("arch")) {
      return "cachyos";
    }
    if (id.includes("debian") || idLike.includes("debian")) {
      return "debian-server";
    }
  } catch (e) {
    // Ignore error if file doesn't exist
  }
  return null;
}

program
  .option("--os <type>", "Specify the target OS (cachyos, debian-server)")
  .action(async (options) => {
    let osType = options.os;

    if (!osType) {
      const detected = detectOS();
      if (detected) {
        log.info(`Detected OS: ${detected}`);
        osType = detected;
      } else {
        const response = await prompts({
          type: "select",
          name: "os",
          message: "Select the target operating system:",
          choices: [
            { title: "CachyOS", value: "cachyos" },
            { title: "Debian Server", value: "debian-server" },
          ],
        });
        osType = response.os;
      }
    }

    if (!osType) {
      log.error("No OS selected. Exiting.");
      process.exit(1);
    }

    log.info(`Starting setup for: ${osType}`);

    switch (osType) {
      case "cachyos":
        await runCachyOSSetup();
        break;
      case "debian-server":
        await runDebianServerSetup();
        break;
      default:
        log.error(`Unsupported OS: ${osType}`);
        process.exit(1);
    }
  });

program.parse(process.argv);
