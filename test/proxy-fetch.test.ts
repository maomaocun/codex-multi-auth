import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithProxy } from "../lib/request/proxy-fetch.js";
import { closeSharedProxyDispatchers } from "../lib/request/url-rewriting.js";

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	await closeSharedProxyDispatchers();
});

function configureProxy(proxyUrl: string): void {
	for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
		vi.stubEnv(key, proxyUrl);
	}
	vi.stubEnv("NO_PROXY", "");
	vi.stubEnv("no_proxy", "");
}

describe("proxy-aware fetch", () => {
	it("uses a real HTTP proxy with the package's compatible Undici fetch", async () => {
		let proxiedUrl: string | undefined;
		const proxy = createServer((request, response) => {
			proxiedUrl = request.url;
			response.end("ok");
		});
		await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
		const address = proxy.address();
		if (!address || typeof address === "string") throw new Error("Missing proxy address");
		configureProxy(`http://127.0.0.1:${address.port}`);
		try {
			const response = await fetchWithProxy("http://upstream.invalid/probe");
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("ok");
			expect(proxiedUrl).toBe("http://upstream.invalid/probe");
		} finally {
			await closeSharedProxyDispatchers();
			await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
		}
	});

	it("honors NO_PROXY and preserves a replaced global fetch", async () => {
		configureProxy("http://proxy.example:8080");
		vi.stubEnv("NO_PROXY", "upstream.example");
		vi.stubEnv("no_proxy", "upstream.example");
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);
		await fetchWithProxy("https://upstream.example/probe", { method: "GET" });
		expect(fetchMock).toHaveBeenCalledWith("https://upstream.example/probe", { method: "GET" });
	});
});
