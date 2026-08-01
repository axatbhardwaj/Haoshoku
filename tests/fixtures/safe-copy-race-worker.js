import fs from "node:fs";
import { safeCopyFile } from "../../src/common/utils.js";

const [src, dest, gate, ready, timestamp] = process.argv.slice(2);

fs.writeFileSync(ready, "ready");
while (fs.existsSync(gate)) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}

safeCopyFile(src, dest, { now: () => Number(timestamp) });
