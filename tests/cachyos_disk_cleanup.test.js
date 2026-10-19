import { describe, expect, it } from "bun:test";
import { runCachyOSSetup } from "../src/os_scripts/cachyos.js";

// All host effects injected; exercise the same full Arch route as the fleet.
describe("Arch daily disk cleanup", () => {
  it.each(["pc", "laptop", "iobox"])("syncs cleanup during %s setup", async (deviceType) => {
    const events = [];
    const noop = async () => {};
    expect(await runCachyOSSetup({
      promptDeviceTypeImpl: noop, readDeviceTypeImpl: () => deviceType,
      startSudoSessionImpl: async () => noop,
      prepareArchPackageManagerImpl: async () => true,
      ensureRustToolchainImpl: noop, ensureAurHelperImpl: noop,
      installDevToolsImpl: noop, commandExistsImpl: async () => true,
      installSystemPackagesImpl: noop, installFlatpakAppsImpl: noop,
      configureUserAppsImpl: async () => events.push("apps"),
      configureTailscaleT3Impl: async () => true,
      configureFleetSshImpl: async () => true,
      syncWorktreeCleanupImpl: async () => events.push("cleanup"),
      configureBraveManagedPoliciesImpl: noop, configureHyprmoncfgImpl: noop,
      configureOmarchyWorkspacesImpl: noop, configureOmarchyPluginsImpl: noop,
      configureVoxtypeOsdImpl: noop, configureKdeConnectCommandsImpl: noop,
      configureOmarchyBarImpl: noop, configureOmazedImpl: noop,
      configureOmarchyAppearanceImpl: noop,
    })).toBe(true);
    expect(events).toEqual(["apps", "cleanup"]);
  });
});
