import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..");
const pcOverlay = path.join(
	root,
	"configs",
	"omarchy",
	"haoshoku",
	"workspaces-pc.lua",
);
const luaInterpreter = Bun.which("lua5.4") ?? Bun.which("lua");

const luaHarness = `
local overlay = arg[1]
local bindings, unbinds, layouts, rules, events = {}, {}, {}, {}, {}
local active_id = 1
local gaps = { top = 7, right = 17, bottom = 11, left = 13 }

local function action(kind, value)
  return function()
    table.insert(events, { kind = kind, value = value })
  end
end

hl = {
  bind = function() end,
  unbind = function(chord) table.insert(unbinds, chord) end,
  workspace_rule = function(rule) table.insert(rules, rule) end,
  get_active_workspace = function() return { id = active_id } end,
  get_config = function(key)
    assert(key == "general.gaps_in", "unexpected config lookup: " .. key)
    return gaps
  end,
  exec_cmd = function(command) table.insert(events, { kind = "exec", value = command }) end,
  layout = {
    register = function(name, provider) layouts[name] = provider end,
  },
  dsp = {
    focus = function(options) return action("focus", options.monitor) end,
    exec_cmd = function(command) return action("exec", command) end,
    layout = function(command) return action("layout", command) end,
    group = { toggle = function() return action("group", "toggle") end },
    workspace = { toggle_special = function(name) return action("special", name) end },
    window = {
      move = function() return action("window", "move") end,
      close = function() return action("window", "close") end,
      float = function() return action("window", "float") end,
      pseudo = function() return action("window", "pseudo") end,
    },
  },
}

o = {
  bind = function(chord, description, callback)
    bindings[chord] = bindings[chord] or {}
    table.insert(bindings[chord], { description = description, callback = callback })
  end,
  exec_on_start = function() end,
  launch_on_start = function() end,
  launch_sole = function() return action("launch", "sole") end,
  window = function() end,
}

dofile(overlay)

local expected_monitors = {
  ["SUPER + F1"] = "DP-2",
  ["SUPER + F2"] = "DP-1",
  ["SUPER + F3"] = "HDMI-A-1",
}
for chord, monitor in pairs(expected_monitors) do
  assert(bindings[chord] and #bindings[chord] == 1, chord .. " must have exactly one binding")
  events = {}
  bindings[chord][1].callback()
  assert(#events == 1 and events[1].kind == "focus" and events[1].value == monitor,
    chord .. " must focus " .. monitor)
end

local layout_name, provider = next(layouts)
assert(layout_name and not next(layouts, layout_name), "exactly one Lua layout must be registered")
assert(type(provider.recalculate) == "function", "layout must expose recalculate(ctx)")

local layout_workspaces = {}
for _, rule in ipairs(rules) do
  if rule.layout then layout_workspaces[rule.workspace] = rule.layout end
end
for _, workspace in ipairs({ "6", "7", "10" }) do
  assert(layout_workspaces[workspace] == "lua:" .. layout_name,
    "workspace " .. workspace .. " must select lua:" .. layout_name)
end
for workspace, _ in pairs(layout_workspaces) do
  assert(workspace == "6" or workspace == "7" or workspace == "10",
    "unexpected layout workspace " .. workspace)
end

local area = { x = 20, y = 30, w = 1200, h = 1000 }
for count = 1, 4 do
  local boxes, targets = {}, {}
  for index = 1, count do
    targets[index] = {
      place = function(_, box)
        boxes[index] = {
          x = math.floor(box.x + 0.5),
          y = math.floor(box.y + 0.5),
          w = math.floor(box.w + 0.5),
          h = math.floor(box.h + 0.5),
        }
      end,
    }
  end
  provider.recalculate({ area = area, targets = targets })
  assert(#boxes == count, "layout must place every target for count " .. count)

  local visible = {}
  for index, box in ipairs(boxes) do
    local top = math.abs(box.y - area.y) < 2 and 0 or gaps.top
    local bottom = math.abs(box.y + box.h - area.y - area.h) < 2 and 0 or gaps.bottom
    local left = math.abs(box.x - area.x) < 2 and 0 or gaps.left
    local right = math.abs(box.x + box.w - area.x - area.w) < 2 and 0 or gaps.right
    visible[index] = {
      x = box.x + left,
      y = box.y + top,
      w = box.w - left - right,
      h = box.h - top - bottom,
    }
    assert(visible[index].x == area.x and visible[index].w == area.w,
      "row must retain full usable width")
    if index > 1 then
      local previous = visible[index - 1]
      assert(previous.y + previous.h <= visible[index].y,
        "visible rows must not overlap")
      assert(math.abs(previous.h - visible[index].h) <= 1,
        "visible row heights must differ by at most one pixel: count=" .. count ..
          " index=" .. index .. " previous=" .. previous.h .. " current=" .. visible[index].h)
    end
  end
end

assert(bindings["SUPER + L"] and #bindings["SUPER + L"] == 1,
  "SUPER + L must have exactly one replacement binding")
assert(unbinds[#unbinds] == "SUPER + L", "SUPER + L must be unbound before replacement")
for _, workspace in ipairs({ 6, 7, 10 }) do
  active_id, events = workspace, {}
  bindings["SUPER + L"][1].callback()
  assert(#events == 0, "SUPER + L must be a no-op on workspace " .. workspace)
end
active_id, events = 5, {}
bindings["SUPER + L"][1].callback()
assert(#events == 1 and events[1].kind == "exec" and
  events[1].value == "omarchy-hyprland-workspace-layout-toggle",
  "SUPER + L must retain the stock toggle elsewhere")
`;

describe("PC monitor focus and portrait rows", () => {
	(luaInterpreter ? it : it.skip)(
		"executes the fixed-focus, equal-visible-row, and guarded-toggle behavior",
		() => {
			if (!luaInterpreter) return;

			const result = Bun.spawnSync([luaInterpreter, "-", pcOverlay], {
				stdin: Buffer.from(luaHarness),
				stdout: "pipe",
				stderr: "pipe",
			});

			expect(result.exitCode, result.stderr.toString()).toBe(0);
		},
	);

	it("records the SUPER+L reclaim and the ownership carve-out", () => {
		const swaps = JSON.parse(
			fs.readFileSync(
				path.join(root, "configs", "omarchy", "keybinding-swaps.json"),
				"utf8",
			),
		).swaps;
		expect(
			swaps.filter(
				(entry) =>
					entry.config_file === "configs/omarchy/haoshoku/workspaces-pc.lua" &&
					entry.hl_unbind === 'hl.unbind("SUPER + L")' &&
					entry.reason === "reclaimed_by_overlay",
			),
		).toHaveLength(1);

		const guidance = fs.readFileSync(
			path.join(root, "configs", "omarchy", "CLAUDE.md"),
			"utf8",
		);
		expect(guidance).toMatch(
			/Haoshoku owns the\s+layout preference for numbered workspaces 6, 7, and 10/,
		);
		expect(guidance).toContain("hyprmoncfg retains sole ownership");
	});
});
