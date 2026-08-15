-- Application bindings
--
-- Custom shortcuts favour SUPER + single key. Where that slot held an Omarchy
-- default, the default is unbound and re-bound at SUPER CTRL SHIFT + the same
-- key -- the slot its replacement vacated, so nothing is lost.
--
-- An hl.unbind before each override is load-bearing: Hyprland keeps BOTH
-- bindings on a key otherwise and fires them together.

-- Omarchy defaults displaced by the bindings below.
hl.unbind("SUPER + F")
o.bind(
  "SUPER + CTRL + SHIFT + F",
  "Full screen",
  hl.dsp.window.fullscreen({ mode = "fullscreen" })
)
hl.unbind("SUPER + J")
o.bind("SUPER + CTRL + SHIFT + J", "Toggle window split", hl.dsp.layout("togglesplit"))
hl.unbind("SUPER + P")
o.bind("SUPER + CTRL + SHIFT + P", "Pseudo window", hl.dsp.window.pseudo())
hl.unbind("SUPER + T")
o.bind(
  "SUPER + CTRL + SHIFT + T",
  "Toggle window floating/tiling",
  hl.dsp.window.float({ action = "toggle" })
)
-- The owner intentionally leaves the former SUPER+W slot unbound.
hl.unbind("SUPER + W")
o.bind("SUPER + Q", "Close window", hl.dsp.window.close())

-- The X launcher is superseded, not relocated: the workspace toggle owns it.
hl.unbind("SUPER + SHIFT + X")

-- Applications
hl.unbind("SUPER + RETURN")
o.bind(
  "SUPER + RETURN",
  "Terminal",
  "uwsm-app -- xdg-terminal-exec --dir=\"$(omarchy-cmd-terminal-cwd)\""
)
o.bind("SUPER + E", "File manager", "uwsm-app -- nautilus --new-window")
o.bind("SUPER + N", "Editor", "omarchy-launch-editor")
o.bind("SUPER + Z", "Zed", "uwsm-app -- zeditor --new")
-- Always open a new Zed window on SUPER+Z, rather than focusing an existing one.

hl.unbind("SHIFT + SUPER + RETURN")
o.bind("SUPER + SHIFT + RETURN", "Browser", "omarchy-launch-browser")
hl.unbind("ALT + SHIFT + SUPER + F")
o.bind(
  "SUPER + ALT + SHIFT + F",
  "File manager (cwd)",
  "uwsm-app -- nautilus --new-window \"$(omarchy-cmd-terminal-cwd)\""
)
hl.unbind("SHIFT + SUPER + B")
o.bind("SUPER + SHIFT + B", "Browser", "omarchy-launch-browser")
hl.unbind("ALT + SHIFT + SUPER + B")
o.bind("SUPER + SHIFT + ALT + B", "Browser (private)", "omarchy-launch-browser --private")
hl.unbind("ALT + SHIFT + SUPER + M")
o.bind(
  "SUPER + SHIFT + ALT + M",
  "Music TUI",
  "omarchy-launch-or-focus-tui cliamp"
)
hl.unbind("SHIFT + SUPER + D")
o.bind("SUPER + SHIFT + D", "Docker", "omarchy-launch-tui lazydocker")
hl.unbind("SHIFT + SUPER + W")
o.bind(
  "SUPER + SHIFT + W",
  "Typora",
  "uwsm-app -- typora --enable-wayland-ime"
)

-- Deploy restores the stock bindings template, so personal deletion alone is
-- not durable: these stock launchers are deliberately deleted AND unbound.
-- Three are actively harmful if resurrected because the workspace module routes
-- them into hidden special workspaces:
--   SUPER SHIFT M      Spotify   -- launches invisibly into special:music
--   SUPER SHIFT SLASH  1Password -- launches invisibly into special:1password
--   SUPER SHIFT G      Signal    -- focuswindow reveals special:communication
--     with no way to dismiss it, which reads as a broken workspace toggle.
-- The stock SUPER SHIFT A ChatGPT web app is separately deleted and unbound;
-- Meta+I owns native Codex Desktop, with login-time placement by the helper.
-- SUPER SHIFT X is likewise deleted-and-unbound above because its special
-- workspace toggle owns that key.
hl.unbind("SUPER + ALT + RETURN")
hl.unbind("SUPER + SHIFT + A")
hl.unbind("SUPER + SHIFT + C")
hl.unbind("SUPER + SHIFT + F")
hl.unbind("SUPER + SHIFT + M")
hl.unbind("SUPER + SHIFT + N")
hl.unbind("SUPER + SHIFT + G")
hl.unbind("SUPER + SHIFT + O")
hl.unbind("SUPER + SHIFT + SLASH")
hl.unbind("SUPER + SHIFT + E")
hl.unbind("SUPER + SHIFT + Y")
hl.unbind("SUPER + SHIFT + P")

-- Web apps
-- If a web-app URL contains #, type it as ## to prevent Hyprland treating it as a comment.
o.bind(
  "SUPER + P",
  "Google Photos",
  "omarchy-launch-or-focus \"brave-photos\\.google\\.com__-Default\" \"haoshoku-chromium-flux --app=https://photos.google.com/\""
)

hl.unbind("ALT + SHIFT + SUPER + A")
o.bind(
  "SUPER + SHIFT + ALT + A",
  "Grok",
  "omarchy-launch-or-focus \"brave-grok\\.com__-Default\" \"haoshoku-chromium-flux --app=https://grok.com\""
)
hl.unbind("ALT + SHIFT + SUPER + G")
o.bind(
  "SUPER + SHIFT + ALT + G",
  "WhatsApp",
  "omarchy-launch-or-focus \"brave-web\\.whatsapp\\.com__-Default\" \"brave-origin --user-data-dir=$HOME/.config/brave-haoshoku/whatsapp --app=https://web.whatsapp.com/\""
)
-- X Post is ACTION-shaped, not APP-shaped: Brave Origin freezes the derived
-- app-id at window creation. After posting, X routes the window to /home, but
-- the class remains brave-x.com__compose_post-Default; focus-aware launching
-- would focus that stale home timeline forever, never reopen a composer, and
-- make the URL argument dead code. The criterion is intent, not whether the
-- URL bears a path: stable app destinations stay focus-aware, while one-shot
-- actions such as X Post stay launch-only.
hl.unbind("ALT + SHIFT + SUPER + X")
o.bind(
  "SUPER + SHIFT + ALT + X",
  "X Post",
  "omarchy-launch-webapp \"https://x.com/compose/post\""
)

-- CTRL SHIFT SUPER + G belongs to the communication special workspace (Signal
-- + WhatsApp), bound in the workspace module. Google Messages used the same
-- modifier set spelled SUPER SHIFT CTRL, so one keypress fired both binds and
-- toggled the workspace back off. Launch Google Messages from Walker.
hl.unbind("CTRL + SHIFT + SUPER + G")

-- Add extra bindings here, for example:
-- o.bind("SUPER + SHIFT + R", nil, "alacritty -e ssh your-server")

-- Logitech MX Keys examples:
-- o.bind("SUPER + SHIFT + S", nil, "omarchy-capture-screenshot") -- Print Screen
-- o.bind("SUPER + H", nil, "voxtype record toggle")              -- Dictation
-- o.bind("SUPER + PERIOD", nil, "omarchy-launch-walker -m symbols") -- Emoji
