import { afterEach, describe, expect, it } from "vitest";
import { startWebServer } from "../lib/web-dashboard.js";

const handles: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
	while (handles.length) await handles.pop()!.close();
});

describe("web dashboard server", () => {
	it("serves the live dashboard and JSON status on loopback", async () => {
		const handle = await startWebServer({
			host: "127.0.0.1",
			port: 0,
			refreshMs: 1000,
			getStatus: async () => ({ accountCount: 2, accounts: [] }),
		});
		handles.push(handle);
		const html = await (await fetch(handle.url)).text();
		const status = await (await fetch(new URL("api/status", handle.url))).json();
		expect(html).toContain("Codex Multi-Auth");
		expect(html).toContain("号池实时监控");
		expect(status).toMatchObject({ accountCount: 2 });
	});

	it("requires a token when bound beyond loopback", async () => {
		await expect(startWebServer({
			host: "0.0.0.0",
			port: 0,
			getStatus: async () => ({}),
		})).rejects.toThrow("requires a token");
	});

	it("protects API and dashboard routes with a token", async () => {
		const handle = await startWebServer({
			host: "127.0.0.1",
			port: 0,
			token: "fixture-token",
			getStatus: async () => ({ ok: true }),
		});
		handles.push(handle);
		const unauthorized = await fetch(handle.url.split("?")[0]!);
		const authorized = await fetch(handle.url.split("?")[0]! + "?token=fixture-token");
		expect(unauthorized.status).toBe(401);
		expect(authorized.status).toBe(200);
	});
});
