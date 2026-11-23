// Minimal 8-bit RGB/RGBA PNG decoder for Chrome screenshots (no dependencies).
import { inflateSync } from "node:zlib";

export function decodePng(buffer) {
	let offset = 8;
	let width = 0;
	let height = 0;
	let channels = 0;
	const data = [];
	while (offset < buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString("ascii", offset + 4, offset + 8);
		const body = buffer.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			if (body[8] !== 8) throw new Error("Only 8-bit PNG supported");
			channels = { 2: 3, 6: 4 }[body[9]];
			if (!channels) throw new Error("Only RGB/RGBA PNG supported");
		}
		if (type === "IDAT") data.push(body);
		offset += 12 + length;
	}
	const raw = inflateSync(Buffer.concat(data));
	const stride = width * channels;
	const out = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let x = 0; x < stride; x++) {
			const a = x >= channels ? out[y * stride + x - channels] : 0;
			const b = y > 0 ? out[(y - 1) * stride + x] : 0;
			const c =
				x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
			const p = a + b - c;
			const paeth =
				Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
					? a
					: Math.abs(p - b) <= Math.abs(p - c)
						? b
						: c;
			const predictor = [0, a, b, (a + b) >> 1, paeth][filter];
			out[y * stride + x] = (line[x] + predictor) & 255;
		}
	}
	return {
		pixel: (x, y) => {
			const i = Math.round(y) * stride + Math.round(x) * channels;
			return [out[i], out[i + 1], out[i + 2]];
		},
	};
}
