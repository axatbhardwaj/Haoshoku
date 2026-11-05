-- Haoshoku workspace behavior for Omarchy. Visual configuration remains Omarchy-owned.
-- Omarchy owns monitor-local workspace numbering and number-key navigation.
local targets = require("hypr.haoshoku.workspace_targets")

local portrait_slots = { 6, 7, 10 }
local portrait_rows_layout = "haoshoku-portrait-rows"

hl.layout.register(portrait_rows_layout, {
  recalculate = function(ctx)
    local count = #ctx.targets
    if count == 0 then
      return
    end

    local gaps = hl.get_config("general.gaps_in")
    local visible_height =
      (ctx.area.h - (count - 1) * (gaps.top + gaps.bottom)) / count
    local y = ctx.area.y

    for index, target in ipairs(ctx.targets) do
      local height = visible_height
      if index > 1 then
        height = height + gaps.top
      end
      if index < count then
        height = height + gaps.bottom
      end

      target:place({ x = ctx.area.x, y = y, w = ctx.area.w, h = height })
      y = y + height
    end
  end,
})

for slot = 1, 10 do
  local rule = { persistent = true }
  if slot == 6 or slot == 7 or slot == 10 then
    rule.layout = "lua:" .. portrait_rows_layout
  end
  targets.rule(slot, rule)
end

o.exec_on_start("haoshoku-default-browser")
o.exec_on_start("haoshoku-primary-app login")
require("hypr.haoshoku.primary_app")
o.exec_on_start("haoshoku-special-workspace numbered-login 7 ghostty")
o.exec_on_start("haoshoku-special-workspace assistants")
-- Hyprland does not process XDG autostart, so
-- /etc/xdg/autostart/org.kde.kdeconnect.daemon.desktop never fires. Start explicitly
-- instead of relying on incidental D-Bus activation for phone sync after login.
o.exec_on_start("/usr/bin/kdeconnectd")
-- Steam lives in special:steam (Meta+S) and autostarts silently there at login; Omakade is the library you open with SUPER+F2.
o.exec_on_start("[workspace special:steam silent] uwsm-app -- steam")

-- Steam remains special; Omakade and games share physical slot 2.
-- Native workspace blocks and stock number binds remain Omarchy-owned.
o.window("^[Ss]team$", { workspace = "special:steam silent", tile = true })
targets.window("io.github.tsouth89.Omakade", 2)
targets.window("vesktop", 4)
targets.window("teams-for-linux", 5)
targets.window("TelegramDesktop", 5)
targets.window("org.telegram.desktop", 5)
targets.window("com.haoshoku.ws7", 7)
targets.window("brave-www.notion.so__-Default", 10)
o.window("^brave-x\\.com__-Default$", { workspace = "special:x" })
o.window("^brave-www\\.netflix\\.com__-Default$", { workspace = "special:netflix silent" })
o.window("^brave-youtube\\.com__-Default$", { workspace = "special:youtube" })
o.window("^brave-www\\.jiohotstar\\.com__-Default$", { workspace = "special:jiohotstar" })
o.window("^brave-www\\.crunchyroll\\.com__-Default$", { workspace = "special:crunchyroll" })
o.window("^brave-reanime\\.to__home-Default$", { workspace = "special:reanime" })
o.window("^brave-www\\.twitch\\.tv__-Default$", { workspace = "special:twitch" })
o.window("^chatgpt$", { workspace = "special:assistants silent" })
o.window("^com\\.anthropic\\.Claude$", { workspace = "special:assistants silent" })
o.window("^com\\.haoshoku\\.haki$", { workspace = "special:haki" })
o.window("^com\\.haoshoku\\.agents$", { workspace = "special:agents" })
o.window("^[Ss]potify$", { workspace = "special:music" })
o.window("^1[Pp]assword$", { workspace = "special:1password" })
o.window(
  "^(signal|Signal|brave-web\\.whatsapp\\.com__-Default)$",
  { workspace = "special:communication" }
)
o.window("^chromium-flux$", { workspace = "special:browser-flux" })

-- Portal file dialogs open TILED on the normal workspace underneath, so a
-- revealed special workspace draws over them and they appear to vanish -- the
-- upload or download picker is focused but invisible. Verified by driving
-- org.freedesktop.portal.Desktop over D-Bus: the window is class
-- xdg-desktop-portal-gtk, floating=false, on the underlying workspace.
--
-- `pin` is the load-bearing rule: a pinned floating window renders above
-- whichever workspace is showing, special included. Verified live -- the dialog
-- stayed hidden=false while special:communication was displayed on the same
-- monitor. `float` is required because pin only applies to floating windows.
--
-- Scoped to the portal only. Nautilus itself (Super+E) is a different class and
-- must not be pinned. A pinned dialog follows workspace switches until dismissed.
o.window("^xdg-desktop-portal-gtk$", { float = true })
o.window("^xdg-desktop-portal-gtk$", { pin = true })
o.window("^xdg-desktop-portal-gtk$", { center = true })

-- io uses five local slots; leave stock 1-5 actions and native ten-ID stride intact.
hl.unbind("SUPER + code:15")
hl.unbind("SUPER + SHIFT + code:15")
hl.unbind("SUPER + SHIFT + ALT + code:15")
hl.unbind("SUPER + code:16")
hl.unbind("SUPER + SHIFT + code:16")
hl.unbind("SUPER + SHIFT + ALT + code:16")
hl.unbind("SUPER + code:17")
hl.unbind("SUPER + SHIFT + code:17")
hl.unbind("SUPER + SHIFT + ALT + code:17")
hl.unbind("SUPER + code:18")
hl.unbind("SUPER + SHIFT + code:18")
hl.unbind("SUPER + SHIFT + ALT + code:18")
hl.unbind("SUPER + code:19")
hl.unbind("SUPER + SHIFT + code:19")
hl.unbind("SUPER + SHIFT + ALT + code:19")

-- Preferred app actions use function keys; stock Super+numbers stay untouched.
o.bind("SUPER + F1", "Primary app in center slot 1", "haoshoku-primary-app focus 1")
o.bind("SUPER + F2", "Gaming slot 2 and Omakade", "haoshoku-special-workspace numbered 2 omakade")
o.bind("SUPER + F4", "Right slot 4 and Vesktop", "haoshoku-special-workspace numbered 4 vesktop")
o.bind("SUPER + F5", "Right slot 5 and chat", "haoshoku-special-workspace numbered 5 communication-numbered")
o.bind("SUPER + F6", "Primary app in left slot 1", "haoshoku-primary-app focus 6")
o.bind("SUPER + F7", "Left slot 2 Ghostty", "haoshoku-special-workspace numbered 7 ghostty")
o.bind("SUPER + F10", "Left slot 3 and Notion", "haoshoku-special-workspace numbered 10 notion")

hl.unbind("SUPER + G")
o.bind("SUPER + CTRL + SHIFT + G", "Toggle window grouping", hl.dsp.group.toggle())
hl.unbind("SUPER + O")
o.bind(
  "SUPER + CTRL + SHIFT + O",
  "Pop window out (float & pin)",
  "omarchy-hyprland-window-pop"
)
hl.unbind("SUPER + S")
o.bind(
  "SUPER + CTRL + SHIFT + S",
  "Toggle scratchpad",
  hl.dsp.workspace.toggle_special("scratchpad")
)

o.bind("SUPER + I", "Show/focus/hide AI assistants workspace", "haoshoku-special-workspace assistants")
o.bind("SUPER + T", "T3 Code", o.launch_sole("^com\\.t3tools\\.T3Code$", "t3code"))
o.bind("SUPER + SHIFT + T", "Show/focus/hide Twitch workspace", "haoshoku-special-workspace twitch")
o.bind("SUPER + M", "Show/focus/hide music workspace", "haoshoku-special-workspace music")
o.bind("SUPER + O", "Show/focus/hide 1Password workspace", "haoshoku-special-workspace 1password")
o.bind("SUPER + G", "Show/focus/hide communication workspace", "haoshoku-special-workspace communication")
o.bind("SUPER + B", "Toggle Brave Origin workspace", "haoshoku-special-workspace browser-toggle flux")
o.bind("SUPER + Y", "Show/focus/hide YouTube workspace", "haoshoku-special-workspace youtube")
o.bind("SUPER + J", "Show/focus/hide JioHotstar workspace", "haoshoku-special-workspace jiohotstar")
o.bind("SUPER + R", "Show/focus/hide Crunchyroll workspace", "haoshoku-special-workspace crunchyroll")
o.bind("SUPER + F", "Show/focus/hide Re:ANIME workspace", "haoshoku-special-workspace reanime")
o.bind("SUPER + S", "Show/focus/hide Steam workspace", "haoshoku-special-workspace steam")
o.bind("SUPER + ALT + S", "Toggle stash workspace", hl.dsp.workspace.toggle_special("stash"))
o.bind("SUPER + SHIFT + X", "Show/focus/hide X workspace", "haoshoku-special-workspace x")
o.bind("SUPER + CTRL + F1", "Focus left portrait monitor", hl.dsp.focus({ monitor = "DP-2" }))
o.bind("SUPER + CTRL + F2", "Focus center monitor", hl.dsp.focus({ monitor = "DP-1" }))
o.bind("SUPER + CTRL + F3", "Focus right monitor", hl.dsp.focus({ monitor = "HDMI-A-1" }))
-- bindings.lua unbinds SUPER+SHIFT+G; this module deliberately reclaims it.
-- hyprland.lua must require bindings before this workspace module so the later bind wins.
o.bind("SUPER + SHIFT + G", "Toggle gaming workspace", "haoshoku-gaming-workspace toggle")
hl.unbind("SUPER + SHIFT + S")
o.bind(
  "SUPER + SHIFT + S",
  "Stash focused window",
  hl.dsp.window.move({ workspace = "special:stash", follow = false })
)

hl.unbind("SUPER + L")
o.bind("SUPER + L", "Toggle workspace layout", function()
  local workspace = hl.get_active_workspace()
  for _, slot in ipairs(portrait_slots) do
    if workspace and workspace.id == targets.id(slot) then return end
  end

  hl.exec_cmd("omarchy-hyprland-workspace-layout-toggle")
end)
