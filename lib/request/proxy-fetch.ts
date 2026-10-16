import { fetch as undiciFetch } from "undici";
import {
	applyProxyCompatibleInit,
	extractRequestUrl,
	type ProxyCompatibleRequestInit,
} from "./url-rewriting.js";

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

// Respect test and embedding overrides. A proxy dispatcher from Undici 8 must
// use the same package's fetch; Node 22's built-in fetch has a different
// dispatcher handler contract.
const initialGlobalFetch = globalThis.fetch;

function isTestDouble(fetchImpl: typeof globalThis.fetch): boolean {
	const candidate = fetchImpl as typeof fetchImpl & {
		_isMockFunction?: boolean;
		mock?: unknown;
	};
	return candidate._isMockFunction === true || candidate.mock !== undefined;
}

export function fetchWithProxy(
	input: FetchInput,
	init?: FetchInit,
): ReturnType<typeof globalThis.fetch> {
	const url = extractRequestUrl(input as Request | string | URL);
	const proxiedInit = applyProxyCompatibleInit(
		url,
		init as ProxyCompatibleRequestInit | undefined,
	);
	const currentGlobalFetch = globalThis.fetch;
	const baseFetch =
		(currentGlobalFetch !== initialGlobalFetch || isTestDouble(currentGlobalFetch))
			? currentGlobalFetch
			: proxiedInit.dispatcher
				? undiciFetch
				: currentGlobalFetch;

	return (baseFetch as typeof globalThis.fetch)(input, proxiedInit as RequestInit);
}
