#!/usr/bin/env python3
"""Rewrite Caelestia's OSC palette file from the Zed Caelestia theme.

When no active Omarchy Kitty theme exists, fish's config.fish cats
~/.local/state/caelestia/sequences.txt at shell start. Deriving that fallback
from the Zed theme keeps terminal emulators and Zed on one palette.

Caelestia builds two palettes from the same wallpaper scheme: `term0`-`term15`
for terminals, and Catppuccin-named roles for the Zed theme. All sixteen ANSI
entries differ between them, which is why the terminals and Zed drifted apart.
This script resolves that drift toward Zed.

Re-run after Caelestia regenerates its scheme — `caelestia scheme set ...`
rewrites sequences.txt from `term0`-`term15` and undoes this.
"""

import json
import os
import re
import sys

HOME = os.path.expanduser("~")
THEME = os.path.join(HOME, ".config/zed/themes/caelestia.json")
OUT = os.path.join(HOME, ".local/state/caelestia/sequences.txt")

ANSI_ORDER = [
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "bright_black", "bright_red", "bright_green", "bright_yellow",
    "bright_blue", "bright_magenta", "bright_cyan", "bright_white",
]

# Caelestia accent extensions, rendered from primary/secondary/tertiary. The Zed
# theme has no equivalent, so these are carried over unchanged.
EXTENDED = {16: "#24BD5C", 17: "#24BD5C", 18: "#32653E"}

# The one index NOT taken from Zed. Caelestia's zed.json template maps
# terminal.ansi.black to `surface`, which is also the window background, so
# anything printed with SGR 30 would be invisible. Caelestia's own terminal
# palette avoids this with a lifted `term0`; that value is kept here.
OVERRIDES = {0: "#343434"}


def rgb(hex_color):
    """#rrggbb[aa] -> 'rr/gg/bb'. Alpha is dropped: OSC carries no alpha."""
    h = hex_color.lstrip("#")
    if len(h) not in (6, 8) or not re.fullmatch(r"[0-9a-fA-F]+", h):
        sys.exit(f"not a hex colour: {hex_color!r}")
    return f"{h[0:2]}/{h[2:4]}/{h[4:6]}"


def osc(code, value):
    return f"\x1b]{code};{value}\x1b\\"


style = json.load(open(THEME))["themes"][0]["style"]

parts = [
    osc(10, f"rgb:{rgb(style['terminal.foreground'])}"),          # foreground
    # terminal.background is #00000000 (Zed lets the window show through), so
    # the opaque window background is the real terminal background.
    osc(11, f"rgb:{rgb(style['background'])}"),                   # background
    osc(12, f"rgb:{rgb(style['border.focused'])}"),               # cursor
    osc(17, f"rgb:{rgb(style['border.focused'])}"),               # selection bg
]

for i, name in enumerate(ANSI_ORDER):
    color = OVERRIDES.get(i, style[f"terminal.ansi.{name}"])
    parts.append(osc(4, f"{i};rgb:{rgb(color)}"))

for i, color in EXTENDED.items():
    parts.append(osc(4, f"{i};rgb:{rgb(color)}"))

with open(OUT, "w") as fh:
    fh.write("".join(parts))

print(f"wrote {OUT} ({len(''.join(parts))} bytes)")
