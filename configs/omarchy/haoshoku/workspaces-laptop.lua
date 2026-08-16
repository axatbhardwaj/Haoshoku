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

o.exec_on_start("haoshoku-special-workspace numbered-login 7 kitty")
o.exec_on_start("haoshoku-special-workspace assistants")

-- Steam joins the games on 2 so alt-tabbing between a game and the Steam window keeps
-- working -- cyclenext is workspace-local, so they have to share a workspace to cycle.
-- Workspace 2 is a normal persistent workspace. A normal workspace can become a
-- solitary fullscreen workspace for Hyprland's direct scanout path; a special workspace
-- cannot because the workspace beneath it stays composited.
o.window("^[Ss]team$", { workspace = "2 silent" })
o.window("^(discord|vesktop)$", { workspace = "4 silent" })
o.window("^(teams-for-linux|TelegramDesktop|org\\.telegram\\.desktop)$", { workspace = "5 silent" })
o.window("^haoshoku-ws7$", { workspace = "7 silent" })
o.window("^brave-www\\.notion\\.so__-Default$", { workspace = "10 silent" })
o.window("^brave-x\\.com__-Default$", { workspace = "special:x" })
o.window("^brave-youtube\\.com__-Default$", { workspace = "special:youtube" })
o.window("^brave-www\\.jiohotstar\\.com__-Default$", { workspace = "special:jiohotstar" })
o.window("^brave-www\\.crunchyroll\\.com__-Default$", { workspace = "special:crunchyroll" })
o.window("^brave-reanime\\.to__home-Default$", { workspace = "special:reanime" })
o.window("^brave-www\\.twitch\\.tv__-Default$", { workspace = "special:twitch" })
o.window("^chatgpt$", { workspace = "special:assistants silent" })
o.window("^t3code$", { workspace = "1 silent" })
o.window("^haoshoku-haki$", { workspace = "special:haki" })
o.window("^haoshoku-agents$", { workspace = "special:agents" })
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

-- These are additive supersets of Omarchy's stock Super+number workspace binds.
-- Workspace 2 is the gaming workspace, and Steam's window rule targets it. Stock
-- SUPER+2 switches straight to it. There is deliberately no `numbered 2 steam` bind:
-- 2 is always present, and a plain workspace switch must not launch Steam.
-- SUPER+SHIFT+G remains the toggle that ensures Steam.
o.bind(
  "SUPER + code:13",
  "Workspace 4 and Discord",
  "haoshoku-special-workspace numbered 4 discord"
)
o.bind(
  "SUPER + code:14",
  "Workspace 5 and chat",
  "haoshoku-special-workspace numbered 5 communication-numbered"
)
o.bind(
  "SUPER + code:16",
  "Workspace 7 and Kitty",
  "haoshoku-special-workspace numbered 7 kitty"
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

o.bind("SUPER + A", "Show/focus/hide Haki session", "haoshoku-special-workspace haki")
o.bind("SUPER + I", "Show/focus/hide ChatGPT workspace", "haoshoku-special-workspace assistants")
o.bind("SUPER + T", "Workspace 1 and T3 Code", "haoshoku-special-workspace numbered 1 t3code")
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
o.bind("SUPER + S", "Toggle stash workspace", hl.dsp.workspace.toggle_special("stash"))
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
