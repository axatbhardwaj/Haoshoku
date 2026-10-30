// Validate deployment data and reject runtime state/secret fields. Execution
// authority and current destination facts are checked by the Axstack selector.
export function validatePolicy(bytes) {
	let config;
	try {
		config = JSON.parse(bytes);
	} catch {
		throw new Error("fleet-config-json");
	}
	const keys = (value, allowed) =>
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).every((key) => allowed.includes(key));
	const text = (value) => typeof value === "string" && value.trim().length > 0;
	const bp = (value) => Number.isInteger(value) && value >= 0 && value <= 10000;
	const require = (condition) => {
		if (!condition)
			throw new Error("fleet-config-schema: invalid or unproven policy");
	};
	require(
		keys(config, [
			"schemaVersion",
			"hosts",
			"pool",
			"defaultOrder",
			"taskOrders",
			"balanceLimitBp",
			"routes",
		]) && config.schemaVersion === 1,
	);
	require(
		Array.isArray(config.hosts) &&
			config.hosts.length > 0 &&
			bp(config.balanceLimitBp),
	);
	const evidence = (fact, environmentId) =>
		fact === null ||
		(keys(fact, ["environmentId", "pointer", "observedAt"]) &&
			fact.environmentId === environmentId &&
			text(fact.pointer) &&
			Number.isSafeInteger(fact.observedAt) &&
			fact.observedAt >= 0);
	const ids = new Set();
	const environments = new Set();
	for (const host of config.hosts) {
		require(
			keys(host, ["id", "environmentId", "fallbackLimitBp", "capabilities"]) &&
				text(host.id) &&
				text(host.environmentId) &&
				bp(host.fallbackLimitBp) &&
				!ids.has(host.id) &&
				!environments.has(host.environmentId) &&
				keys(host.capabilities, Object.keys(host.capabilities ?? {})),
		);
		for (const fact of Object.values(host.capabilities)) {
			require(
				keys(fact, ["value", "evidence"]) &&
					[true, false, null].includes(fact.value) &&
					evidence(fact.evidence, host.environmentId) &&
					(fact.value !== true || fact.evidence !== null),
			);
		}
		ids.add(host.id);
		environments.add(host.environmentId);
	}
	const order = (list, complete) =>
		Array.isArray(list) &&
		list.every((id) => ids.has(id)) &&
		new Set(list).size === list.length &&
		(!complete || list.length === ids.size);
	require(
		order(config.defaultOrder, true) &&
			order(config.pool, false) &&
			keys(config.taskOrders, Object.keys(config.taskOrders ?? {})) &&
			Object.values(config.taskOrders).every((list) => order(list, true)),
	);
	require(Array.isArray(config.routes));
	const routes = new Set();
	for (const route of config.routes) {
		require(
			keys(route, [
				"id",
				"originEnvironmentId",
				"environmentId",
				"kind",
				"enabled",
				"evidence",
				"authorProof",
			]) &&
				text(route.id) &&
				!routes.has(route.id) &&
				environments.has(route.originEnvironmentId) &&
				environments.has(route.environmentId) &&
				["local", "remote", "remote-author-coordinator"].includes(route.kind) &&
				(route.kind === "local") ===
					(route.originEnvironmentId === route.environmentId) &&
				typeof route.enabled === "boolean" &&
				evidence(route.evidence, route.environmentId),
		);
		if (route.authorProof !== undefined) {
			const proof = route.authorProof;
			const versions = (v) =>
				keys(v, ["t3", "axstack"]) && text(v.t3) && text(v.axstack);
			require(
				keys(proof, [
					"originEnvironmentId",
					"environmentId",
					"originVersions",
					"destinationVersions",
					"evidence",
					"gatesPassed",
				]) &&
					proof.originEnvironmentId === route.originEnvironmentId &&
					proof.environmentId === route.environmentId &&
					versions(proof.originVersions) &&
					versions(proof.destinationVersions) &&
					evidence(proof.evidence, route.environmentId) &&
					proof.evidence !== null &&
					proof.gatesPassed === true,
			);
		}
		routes.add(route.id);
	}
}
