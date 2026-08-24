function text(value) {
  return String(value || "").toLowerCase()
}

function itemNamed(item, name) {
  if (!item) return false
  return text(item.id).indexOf(name) !== -1
    || text(item.title).indexOf(name) !== -1
    || text(item.tooltipTitle).indexOf(name) !== -1
}

function entryId(entry) {
  if (typeof entry === "string") return entry
  if (entry && typeof entry === "object") {
    var id = entry.id
    if (id !== undefined && id !== null && String(id) !== "") return String(id)
  }
  return ""
}

function layoutHasWidget(layout, id) {
  var sections = ["left", "center", "right"]
  for (var s = 0; s < sections.length; s++) {
    var entries = layout && layout[sections[s]]
    if (!Array.isArray(entries)) continue
    for (var i = 0; i < entries.length; i++) {
      if (entryId(entries[i]) === id) return true
    }
  }
  return false
}

function normalizeEmbeddedWidgets(value) {
  if (!value || typeof value === "string" || typeof value.length !== "number") return []

  var result = []
  for (var i = 0; i < value.length; i++) {
    var entry = value[i]
    if (typeof entry === "string") {
      var stringId = entry.trim()
      if (stringId !== "") result.push({ id: stringId })
      continue
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    var id = String(entry.id || "").trim()
    if (id === "") continue

    var copy = {}
    for (var key in entry) copy[key] = entry[key]
    copy.id = id
    result.push(copy)
  }
  return result
}

function drawerItemCount(trayItems, embeddedWidgets) {
  var trayCount = Array.isArray(trayItems) ? trayItems.length : 0
  var embeddedCount = Array.isArray(embeddedWidgets) ? embeddedWidgets.length : 0
  return trayCount + embeddedCount
}

// LocalSend's item shows no state, offers only Open and Quit, and its primary
// click is a no-op, so Share > Receive is the whole surface. Hiding it by hand
// doesn't stick either: LocalSend picks a fresh tray id every launch.
function ownedByOmarchy(item, layout) {
  return itemNamed(item, "localsend")
    || (layoutHasWidget(layout, "omarchy.dropbox") && itemNamed(item, "dropbox"))
}

if (typeof module !== "undefined") {
  module.exports = {
    itemNamed: itemNamed,
    entryId: entryId,
    layoutHasWidget: layoutHasWidget,
    ownedByOmarchy: ownedByOmarchy,
    normalizeEmbeddedWidgets: normalizeEmbeddedWidgets,
    drawerItemCount: drawerItemCount
  }
}
