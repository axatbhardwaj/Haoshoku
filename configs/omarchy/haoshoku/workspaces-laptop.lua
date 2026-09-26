-- Haoshoku workspace behavior for Omarchy. Visual configuration remains Omarchy-owned.
hl.workspace_rule({ workspace = "1", default = true, persistent = true })
hl.workspace_rule({ workspace = "2", persistent = true })
hl.workspace_rule({ workspace = "3", persistent = true })
hl.workspace_rule({ workspace = "4", persistent = true })
hl.workspace_rule({ workspace = "5", persistent = true })
hl.workspace_rule({ workspace = "6", persistent = true })
hl.workspace_rule({ workspace = "7", persistent = true })
hl.workspace_rule({ workspace = "8", persistent = true })
hl.workspace_rule({ workspace = "9", persistent = true })
hl.workspace_rule({ workspace = "10", persistent = true })

o.exec_on_start("haoshoku-default-browser")
o.exec_on_start("haoshoku-primary-app login")
require("hypr.haoshoku.primary_app")
o.exec_on_start("haoshoku-special-workspace numbered-login 7 ghostty")
o.exec_on_start("haoshoku-special-workspace assistants")
o.launch_on_start("/usr/bin/paseo")
-- Hyprland does not process XDG autostart, so
-- /etc/xdg/autostart/org.kde.kdeconnect.daemon.desktop never fires. Start explicitly
-- instead of relying on incidental D-Bus activation for phone sync after login.
o.exec_on_start("/usr/bin/kdeconnectd")
-- Steam lives in special:steam (Meta+S) and autostarts silently there at login; Omakade is the library you open with SUPER+2.
o.exec_on_start("[workspace special:steam silent] uwsm-app -- steam")

-- Steam (client) goes to special:steam. Omakade stays on 2 with the games so
-- alt-tabbing between a game, the library, and Omakade keeps working --
-- cyclenext is workspace-local, so they have to share a workspace to cycle.
-- Workspace 2 is a normal persistent workspace. A normal
-- workspace can become a solitary fullscreen workspace for Hyprland's direct scanout
-- path; a special workspace cannot because the workspace beneath it stays composited.
-- Games land on 2 via the `haoshoku-gaming-workspace place`
-- Steam launch-option wrapper (pid-tree watcher), not by class.
-- Omarchy's stock steam.lua floats every Steam window. tile must come after that
-- default (this overlay loads later) so Steam opens tiled in its special workspace.
o.window("^[Ss]team$", { workspace = "special:steam silent", tile = true })
o.window("^io\\.github\\.tsouth89\\.Omakade$", { workspace = "2 silent" })
o.window("^vesktop$", { workspace = "4 silent" })
o.window("^(teams-for-linux|TelegramDesktop|org\\.telegram\\.desktop)$", { workspace = "5 silent" })
o.window("^com\\.haoshoku\\.ws7$", { workspace = "7 silent" })
o.window("^brave-www\\.notion\\.so__-Default$", { workspace = "10 silent" })
o.window("^brave-x\\.com__-Default$", { workspace = "special:x" })
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
o.window("^chromium-defi$", { workspace = "special:browser-defi" })
o.window("^chromium-defi$", { border_color = "rgb(9762e2) rgb(9762e2)" })

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

-- Most are additive supersets of Omarchy's stock Super+number workspace binds.
-- Workspace 7 replaces its stock bind so one keypress focuses or creates its
-- owned Ghostty without dispatching two workspace actions.
-- Workspace 2 is the gaming workspace. Omakade starts silently at login; SUPER+2
-- focuses 2 and ensures Omakade. SUPER+SHIFT+G remains the gaming toggle that
-- focuses 2 and ensures Omakade (never Steam -- Steam lives in special:steam).
-- SUPER+S toggles the Steam special workspace; the stash toggle moves to
-- SUPER+ALT+S (SUPER+SHIFT+S still stashes the focused window).
hl.unbind("SUPER + code:10")
o.bind("SUPER + code:10", "Primary app", "haoshoku-primary-app focus")
hl.unbind("SUPER + code:15")
o.bind("SUPER + code:15", "Primary app", "haoshoku-primary-app focus")
o.bind(
  "SUPER + code:11",
  "Workspace 2 and Omakade",
  "haoshoku-special-workspace numbered 2 omakade"
)
o.bind(
  "SUPER + code:13",
  "Workspace 4 and Vesktop",
  "haoshoku-special-workspace numbered 4 vesktop"
)
o.bind(
  "SUPER + code:14",
  "Workspace 5 and chat",
  "haoshoku-special-workspace numbered 5 communication-numbered"
)
hl.unbind("SUPER + code:16")
o.bind(
  "SUPER + code:16",
  "Workspace 7 Ghostty",
  "haoshoku-special-workspace numbered 7 ghostty"
)
o.bind(
  "SUPER + code:19",
  "Workspace 10 and Notion",
  "haoshoku-special-workspace numbered 10 notion"
)

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
o.bind("SUPER + T", "Paseo", o.launch_sole("^Paseo$", "/usr/bin/paseo"))
o.bind("SUPER + SHIFT + T", "Show/focus/hide Twitch workspace", "haoshoku-special-workspace twitch")
o.bind("SUPER + M", "Show/focus/hide music workspace", "haoshoku-special-workspace music")
o.bind("SUPER + O", "Show/focus/hide 1Password workspace", "haoshoku-special-workspace 1password")
o.bind("SUPER + G", "Show/focus/hide communication workspace", "haoshoku-special-workspace communication")
o.bind("SUPER + B", "Toggle Flux Brave Origin workspace", "haoshoku-special-workspace browser-toggle flux")
o.bind("SUPER + D", "Toggle DeFi Brave Origin workspace", "haoshoku-special-workspace browser-toggle defi")
o.bind("SUPER + Y", "Show/focus/hide YouTube workspace", "haoshoku-special-workspace youtube")
o.bind("SUPER + J", "Show/focus/hide JioHotstar workspace", "haoshoku-special-workspace jiohotstar")
o.bind("SUPER + R", "Show/focus/hide Crunchyroll workspace", "haoshoku-special-workspace crunchyroll")
o.bind("SUPER + F", "Show/focus/hide Re:ANIME workspace", "haoshoku-special-workspace reanime")
o.bind("SUPER + S", "Show/focus/hide Steam workspace", "haoshoku-special-workspace steam")
o.bind("SUPER + ALT + S", "Toggle stash workspace", hl.dsp.workspace.toggle_special("stash"))
o.bind("SUPER + SHIFT + X", "Show/focus/hide X workspace", "haoshoku-special-workspace x")
-- bindings.lua unbinds SUPER+SHIFT+G; this module deliberately reclaims it.
-- hyprland.lua must require bindings before this workspace module so the later bind wins.
o.bind("SUPER + SHIFT + G", "Toggle gaming workspace", "haoshoku-gaming-workspace toggle")
hl.unbind("SUPER + SHIFT + S")
o.bind(
  "SUPER + SHIFT + S",
  "Stash focused window",
  hl.dsp.window.move({ workspace = "special:stash", follow = false })
)
