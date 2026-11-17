-- Replace any personal F9 pair after it loads; Superwhisper's native hold is none.
hl.unbind("F9")
o.bind_hold(
  "F9",
  "Start dictation",
  "omarchy-dictation start",
  "Stop dictation and paste",
  "omarchy-dictation stop"
)
