import { afterEach, describe, expect, it } from "vitest";
import { startWebServer } from "../lib/web-dashboard.js";
import { Script } from "node:vm";
import { renderDashboardHtml } from "../lib/web-dashboard-html.js";

const handles: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
	while (handles.length) await handles.pop()!.close();
});

describe("web dashboard server", () => {
	it("embeds valid browser JavaScript and escapes hostile config strings", () => {
		const html = renderDashboardHtml('</script><script>alert(1)</script>$&__CMA_CLIENT__', "en");
		expect(html.match(/<script>/g)).toHaveLength(1);
		const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
		expect(script).toBeTruthy();
		expect(() => new Script(script!)).not.toThrow();
		expect(script).toContain('"locale":"en"');
	});

	it("serves the live dashboard and JSON status on loopback", async () => {
		const handle = await startWebServer({
			host: "127.0.0.1",
			port: 0,
			refreshMs: 1000,
			getStatus: async () => ({ accountCount: 2, accounts: [] }),
		});
		handles.push(handle);
		const html = await (await fetch(handle.url)).text();
		const status = await (await fetch(new URL("api/status?token=" + handle.token, handle.url))).json();
		expect(html).toContain("Codex Multi-Auth");
		expect(html).toContain("账号池管理");
		expect(handle.token).toHaveLength(64);
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

	it("routes protected management actions and operation status", async () => {
		const handle = await startWebServer({
			host: "127.0.0.1",
			port: 0,
			token: "fixture-token",
			getStatus: async () => ({ ok: true }),
			actions: {
				perform: async (action) => ({ ok: true, action }),
				startLogin: async () => ({ operationId: "fixture-operation", status: "starting" }),
				getOperation: async (id) => id === "fixture-operation" ? { status: "awaiting-device", code: "ABCD-EFGH" } : null,
			},
		});
		handles.push(handle);
		const base = handle.url.split("?")[0]!;
		const action = await fetch(base + "api/actions?token=fixture-token", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "switch", index: 2 }),
		});
		const login = await fetch(base + "api/actions?token=fixture-token", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "login" }),
		});
		const operation = await fetch(base + "api/operations/fixture-operation?token=fixture-token");
		expect(await action.json()).toEqual({ ok: true, action: "switch" });
		expect(await login.json()).toMatchObject({ operationId: "fixture-operation" });
		expect(await operation.json()).toMatchObject({ code: "ABCD-EFGH" });
	});

	it("serves monitor overview, health and CSV through the same token", async () => {
		let started = 0; let stopped = 0;
		const monitor = { start: () => { started += 1; }, stop: () => { stopped += 1; }, status: () => ({ ready: true, files: 2 }), report: () => ({ summary: { totalTokens: 3 }, models: [{ key: "gpt-6.1-sol", totalTokens: 3 }], sessions: [], meta: { ready: true } }) };
		const handle = await startWebServer({ host: "127.0.0.1", port: 0, token: "monitor-token", getStatus: async () => ({}), monitor }); handles.push(handle);
		const base = handle.url.split("?")[0]!; const auth = "?token=monitor-token";
		expect(started).toBe(1);
		expect(await (await fetch(base + "api/monitor/health" + auth)).json()).toMatchObject({ ready: true });
		expect(await (await fetch(base + "api/monitor/overview" + auth)).json()).toMatchObject({ summary: { totalTokens: 3 } });
		const csv = await fetch(base + "api/monitor/export.csv" + auth); expect(csv.status).toBe(200); expect(await csv.text()).toContain("gpt-6.1-sol");
		await handle.close(); expect(stopped).toBe(1);
	});

	it("rejects cross-origin mutation, non-JSON bodies and unauthorized actions", async () => {
		let called = false;
		const handle = await startWebServer({
			port: 0, getStatus: async () => ({}), actions: { perform: async () => { called = true; return { ok: true }; } },
		});
		handles.push(handle);
		const base = handle.url.split("?")[0]!;
		const url = base + "api/actions?token=" + handle.token;
		expect((await fetch(url, { method: "POST", headers: { origin: "https://untrusted.example", "content-type": "application/json" }, body: "{}" })).status).toBe(403);
		expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(415);
		expect((await fetch(base + "api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
		expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "[]" })).status).toBe(400);
		expect(called).toBe(false);
	});

	it("does not expose unexpected backend diagnostics and disposes operation children on close", async () => {
		let disposed = false;
		const handle = await startWebServer({
			port: 0, getStatus: async () => ({}), actions: {
				perform: async () => { throw Error("refresh_token=private-test-value"); },
				dispose: () => { disposed = true; },
			},
		});
		const response = await fetch(handle.url.replace("?", "api/actions?"), { method: "POST", headers: { "content-type": "application/json" }, body: '{"action":"test"}' });
		expect(await response.json()).toEqual({ error: "operation_failed" });
		await handle.close();
		expect(disposed).toBe(true);
	});
});
