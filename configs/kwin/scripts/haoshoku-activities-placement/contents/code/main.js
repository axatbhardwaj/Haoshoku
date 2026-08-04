const outputByClass = {
	// Brave's generated WhatsApp PWA entry declares StartupWMClass=crx_hnpfjngllnobngcgfapefoaidbinmjnm,
	// but KWin measures the brave-* Wayland class below. Its -Default suffix makes
	// this machine- and profile-specific; moving PWA profiles silently breaks the
	// mapping. The Notion PWA class has the same constraint.
	"brave-dcokohelbbehjlcjjfmhfbpdgfjcoopf-Default": "DP-2",
	Spotify: "DP-2",
	"kitty-agents": "DP-2",
	// These two classes are produced by Brave's --class flag; the flag mechanism
	// was measured, while these exact production values were not observed live.
	"brave-flux": "DP-1",
	"brave-defi": "DP-1",
	steam: "DP-1",
	discord: "HDMI-A-1",
	"brave-hnpfjngllnobngcgfapefoaidbinmjnm-Default": "HDMI-A-1",
	"org.telegram.desktop": "HDMI-A-1",
	signal: "HDMI-A-1",
	"teams-for-linux": "HDMI-A-1",
};

workspace.windowAdded.connect((window) => {
	if (!window.normalWindow) return;

	const outputName = outputByClass[window.resourceClass];
	if (!outputName) return;

	const output = workspace.screens.find(
		(candidate) => candidate.name === outputName,
	);
	if (!output) return;

	const frame = window.frameGeometry;
	let destination = output.geometry;
	if (typeof workspace.clientArea === "function") {
		try {
			const workArea = workspace.clientArea(
				0,
				output,
				workspace.currentDesktop,
			);
			if (workArea) destination = workArea;
		} catch (e) {
			void e;
			// Keep the output geometry fallback when the work area is unavailable.
		}
	}
	window.frameGeometry = {
		x: destination.x,
		y: destination.y,
		width: Math.min(frame.width, destination.width),
		height: Math.min(frame.height, destination.height),
	};
});
