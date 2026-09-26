-- The executable is the only user setting. Its desktop entry supplies the window class.
local home = os.getenv("HOME")
local config_home = os.getenv("XDG_CONFIG_HOME") or (home .. "/.config")
local data_home = os.getenv("XDG_DATA_HOME") or (home .. "/.local/share")

local function first_line(path)
  local file = io.open(path, "r")
  if not file then
    return nil
  end
  local line = file:read("*l")
  file:close()
  return line
end

local app = first_line(config_home .. "/haoshoku/primary-app") or "stably-orca"
local name = app:match("([^/]+)$")
local class = name
for _, directory in ipairs({ data_home, "/usr/local/share", "/usr/share" }) do
  local file = io.open(directory .. "/applications/" .. name .. ".desktop", "r")
  if file then
    for line in file:lines() do
      class = line:match("^StartupWMClass=(.+)$") or class
    end
    file:close()
    break
  end
end

local escaped_class = class:gsub("([^%w])", "\\%1")
o.window("^" .. escaped_class .. "$", { workspace = "1 silent" })
