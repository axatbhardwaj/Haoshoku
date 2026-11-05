-- Physical app roles are shared with the shell resolver; Omarchy owns IDs.
local M = {}
local config = (os.getenv("XDG_CONFIG_HOME") or (os.getenv("HOME") .. "/.config"))
  .. "/haoshoku/workspace-monitors"

function M.id(slot)
  if not o.workspaces or o.workspaces.enabled == false or not o.workspaces.workspace_id then
    return nil
  end
  local file = io.open(config, "r")
  if not file then return nil end
  local role, local_slot
  for line in file:lines() do
    local number, monitor, mapped = line:match("^(%d+)\t([^\t]+)\t(%d+)$")
    if tonumber(number) == slot then
      if role then file:close(); return nil end
      role, local_slot = monitor, tonumber(mapped)
    end
  end
  file:close()
  local connected, internal = {}, {}
  for _, monitor in ipairs(hl.get_monitors()) do
    if not monitor.is_mirror then
      connected[#connected + 1] = monitor
      if monitor.name:match("^eDP") or monitor.name:match("^LVDS") or monitor.name:match("^DSI") then
        internal[#internal + 1] = monitor
      end
    end
  end
  local candidates = role == "@single" and (#internal == 1 and internal or connected) or connected
  local target
  for _, monitor in ipairs(candidates) do
    if role == "@single" or monitor.name == role then
      if target then return nil end
      target = monitor
    end
  end
  if not target or not local_slot or local_slot < 1 or local_slot > 10 then return nil end
  return o.workspaces.workspace_id(target, local_slot)
end

-- Resolve at map time, including after hotplug; never leave a stale numeric
-- window rule pointing at an unplugged monitor's block.
function M.window(class, slot)
  hl.on("window.open", function(window)
    if not window or window.class ~= class then return end
    local id = M.id(slot)
    if id then
      hl.dispatch(hl.dsp.window.move({ workspace = tostring(id), window = "address:" .. window.address, follow = false }))
    end
  end)
end

function M.rule(slot, rule)
  local applied = {}
  local function apply()
    local id = M.id(slot)
    if not id or applied[id] then return end
    local options = {}
    for key, value in pairs(rule) do options[key] = value end
    options.workspace = tostring(id)
    hl.workspace_rule(options)
    applied[id] = true
  end
  apply()
  hl.on("config.reloaded", apply)
  hl.on("monitor.added", apply)
end

return M
