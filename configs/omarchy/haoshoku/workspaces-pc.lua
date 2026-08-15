-- Haoshoku workspace behavior for Omarchy. Visual configuration remains Omarchy-owned.
-- Monitor-bound numbered workspace rules are intentionally omitted from this module;
-- hyprmoncfg owns monitor configuration and receives them through its PC profile.

-- GDK scaling is behavioral environment state from monitors-pc.conf, not a monitor rule.
hl.env("GDK_SCALE", "2")

o.exec_on_start("haoshoku-special-workspace numbered-login 7 kitty")
o.exec_on_start("haoshoku-special-workspace assistants")

-- Steam joins the games on 11 so alt-tabbing between a game and the Steam window keeps
-- working -- cyclenext is workspace-local, so they have to share a workspace to cycle.
-- Consequence, accepted: Steam usually runs, so 11 usually exists. It still disappears
-- when Steam closes, which is what the non-persistent hyprmoncfg rule buys here.
o.window("^[Ss]team$", { workspace = "11 silent" })
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
o.window("^t3code$", { workspace = "special:t3code silent" })
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
-- SUPER+2 deliberately no longer ensures Steam. Steam's window rule sends it to 11,
-- so "switch to 2 and launch Steam" would strand you on an empty workspace 2 while
-- the window opened elsewhere. Stock SUPER+2 still switches to workspace 2, and
-- Steam is reached with SUPER+SHIFT+G.
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
o.bind("SUPER + T", "Show/focus/hide T3 Code workspace", "haoshoku-special-workspace t3code")
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
