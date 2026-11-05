import { afterEach, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const lua = Bun.which("lua5.4") ?? Bun.which("lua");
const homes = [];
afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true });
});

(lua ? it : it.skip)(
	"keeps stock number actions while Fn apps follow native monitor blocks and hotplug",
	() => {
		for (const device of ["io", "pc", "laptop"]) {
			const home = fs.mkdtempSync(
				path.join(os.tmpdir(), "haoshoku-lua-workspaces-"),
			);
			homes.push(home);
			fs.mkdirSync(`${home}/haoshoku`);
			fs.copyFileSync(
				`${root}/configs/omarchy/workspace-monitors-${device}`,
				`${home}/haoshoku/workspace-monitors`,
			);
			const moduleDir = `${root}/configs/omarchy/haoshoku`;
			const program = `
local bindings, events, moves, rules, unbound, placements = {}, {}, {}, {}, {}, {}
local rule_count = 0
local monitors = ${device === "io" ? '{{name="DP-1",block=3},{name="DP-2",block=4},{name="HDMI-A-1",block=2}}' : '{{name="eDP-1",block=0}}'}
local function action(options) return options end
hl = {
  get_monitors = function() return monitors end,
  on = function(name, fn) events[name] = events[name] or {}; table.insert(events[name], fn) end,
  dispatch = function(options) table.insert(moves, options) end,
  workspace_rule = function(rule)
    rules[rule.workspace] = rule
    -- Model persistent creation with another monitor focused. Without a monitor
    -- selector, Hyprland may create the empty workspace on that focused screen.
    placements[rule.workspace] = rule.monitor or "focused-other-screen"
    rule_count = rule_count + 1
  end,
  layout = {register = function() end},
  unbind = function(key)
    if key:find("code:") then
      local code=tonumber(key:match("code:(%d+)"))
      assert(${device === "io" ? "true" : "false"} and code >= 15 and code <= 19, "stock number action removed")
      table.insert(unbound,key)
    end
  end,
  dsp = {group={toggle=action}, workspace={toggle_special=action}, window={move=action}, focus=action},
}
o = {
  workspaces = {workspace_id=function(monitor, slot) return monitor.block * 10 + slot end},
  bind = function(key, _, command) assert(not bindings[key], "duplicate bind " .. key); bindings[key]=command end,
  window = function() end, exec_on_start=function() end, launch_sole=function() end,
}
package.preload["hypr.haoshoku.workspace_targets"] = function() return dofile(${JSON.stringify(`${moduleDir}/workspace_targets.lua`)}) end
package.preload["hypr.haoshoku.primary_app"] = function() return dofile(${JSON.stringify(`${moduleDir}/primary_app.lua`)}) end
dofile(${JSON.stringify(process.env.HAOSHOKU_RUNTIME_OVERLAY ?? `${moduleDir}/workspaces-${device}.lua`)})
local expected = {
  F1="haoshoku-primary-app focus 1", F2="haoshoku-special-workspace numbered 2 omakade",
  F4="haoshoku-special-workspace numbered 4 vesktop", F5="haoshoku-special-workspace numbered 5 communication-numbered",
  F6="haoshoku-primary-app focus 6", F7="haoshoku-special-workspace numbered 7 ghostty", F10="haoshoku-special-workspace numbered 10 notion",
}
for key, command in pairs(expected) do assert(bindings["SUPER + "..key] == command, "missing app shortcut "..key) end
assert(#unbound == ${device === "io" ? 15 : 0}, "wrong number cap")
for key in pairs(bindings) do assert(not key:find("code:"), "duplicate number action " .. key) end
for _, key in ipairs({"F3","F8","F9"}) do assert(not bindings["SUPER + "..key]) end
${device === "io" ? 'for n=1,3 do assert(bindings["SUPER + CTRL + F"..n]) end' : ""}
for id, monitor in pairs(placements) do
  local owner
  for _, connected in ipairs(monitors) do
    if math.floor((tonumber(id)-1)/10) == connected.block then owner=connected.name end
  end
  assert(monitor == owner, "persistent workspace initialized on wrong monitor")
end
local function emit(name) for _, fn in ipairs(events[name] or {}) do fn() end end
local function opened(class)
  for _, fn in ipairs(events["window.open"] or {}) do fn({class=class,address="0x1"}) end
end
for _, app in ipairs({{"com.t3tools.T3Code",${device === "io" ? 31 : 1}}, {"vesktop",${device === "io" ? 24 : 4}}, {"TelegramDesktop",${device === "io" ? 25 : 5}}, {"com.haoshoku.ws7",${device === "io" ? 42 : 7}}, {"brave-www.notion.so__-Default",${device === "io" ? 43 : 10}}}) do
  opened(app[1]); assert(moves[#moves].workspace == tostring(app[2]), "wrong physical app target")
end
${device === "io" ? 'assert(rules["41"].layout == "lua:haoshoku-portrait-rows"); assert(rules["42"].layout == "lua:haoshoku-portrait-rows"); assert(rules["43"].layout == "lua:haoshoku-portrait-rows")' : ""}
local count=#moves
local previous_rule_count=rule_count
monitors={}
emit("config.reloaded"); emit("monitor.added")
assert(rule_count==previous_rule_count, "disconnected role created a persistent workspace")
opened("vesktop"); assert(#moves==count, "disconnected monitor was guessed")
monitors=${device === "io" ? '{{name="HDMI-A-1",block=7}}' : '{{name="eDP-1",block=7}}'}
emit("monitor.added")
assert(placements["74"] == monitors[1].name, "hotplug persistent rule lost its owner")
opened("vesktop"); assert(moves[#moves].workspace == "74", "hotplug block was cached")
${
	device !== "io"
		? `monitors={{name="DP-8",block=7}}
emit("monitor.added")
assert(placements["74"] == "DP-8", "same-block connector change kept a stale monitor pin")`
		: ""
}
print("PASS ${device}")
`;
			const result = Bun.spawnSync([lua, "-e", program], {
				env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home },
			});
			expect(result.stderr.toString()).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.stdout.toString()).toContain(`PASS ${device}`);
		}
	},
);
