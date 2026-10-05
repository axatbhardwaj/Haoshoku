-- Line 1 of the setting is the executable; optional line 2 overrides the window
-- class. Otherwise the app's desktop entry supplies it.
local home = os.getenv("HOME")
local config_home = os.getenv("XDG_CONFIG_HOME") or (home .. "/.config")
local data_home = os.getenv("XDG_DATA_HOME") or (home .. "/.local/share")

local function first_lines(path)
  local file = io.open(path, "r")
  if not file then
    return nil
  end
  local app, class = file:read("*l"), file:read("*l")
  file:close()
  return app or "", class
end

local default_app, default_class = "t3code-nightly", "com.t3tools.T3Code"
local app, class = first_lines(config_home .. "/haoshoku/primary-app")
if not app then
  app, class = default_app, default_class
end
if not app:match("^[^%s]+$") or not app:match("([^/]+)$") or (class and class:match("%s")) then
  app, class = default_app, default_class
end
if class == "" then
  class = nil
end
local name = app:match("([^/]+)$")
if not class then
  for _, directory in ipairs({ data_home, "/usr/local/share", "/usr/share" }) do
    local file = io.open(directory .. "/applications/" .. name .. ".desktop", "r")
    if file then
      for line in file:lines() do
        class = line:match("^StartupWMClass=(.+)$")
        if class then
          break
        end
      end
      file:close()
      break
    end
  end
end
class = class or name

local escaped_class = class:gsub("([^%w])", "\\%1")
o.window("^" .. escaped_class .. "$", { workspace = "1 silent" })
