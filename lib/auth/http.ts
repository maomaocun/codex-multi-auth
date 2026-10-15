import { fetch as undiciFetch } from "undici";
import {
	applyProxyCompatibleInit,
	extractRequestUrl,
	type ProxyCompatibleRequestInit,
} from "../request/url-rewriting.js";

type AuthFetchInput = Parameters<typeof globalThis.fetch>[0];
type AuthFetchInit = Parameters<typeof globalThis.fetch>[1];

// Keep test and embedding overrides of globalThis.fetch working, while using
// the package's own Undici implementation whenever a proxy dispatcher is
// attached. Node 22's built-in fetch and this package's Undici 8 dispatcher
// have different handler contracts and cannot safely be mixed.
const initialGlobalFetch = globalThis.fetch;

function isTestDouble(fetchImpl: typeof globalThis.fetch): boolean {
	const candidate = fetchImpl as typeof fetchImpl & {
		_isMockFunction?: boolean;
		mock?: unknown;
	};
	return candidate._isMockFunction === true || candidate.mock !== undefined;
}

export function fetchAuth(
	input: AuthFetchInput,
	init?: AuthFetchInit,
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

	return (baseFetch as typeof globalThis.fetch)(
		input,
		proxiedInit as RequestInit,
	);
}
