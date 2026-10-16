import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebAccountActions } from "../lib/web-dashboard-actions.js";
import { getAccountPolicyKey, loadAccountPolicyStore } from "../lib/account-policy.js";
import { loadAccounts, saveAccounts, setStoragePath, type AccountStorageV3 } from "../lib/storage.js";
import { removeWithRetry } from "./helpers/remove-with-retry.js";

function pool(): AccountStorageV3 {
	return {
		version: 3, activeIndex: 2, pinnedAccountIndex: 2, activeIndexByFamily: { codex: 2 },
		accounts: ["alpha", "beta", "gamma"].map(id => ({ accountId: "acct_" + id, email: id + "@example.org", refreshToken: "test-refresh-" + id, addedAt: 10, lastUsed: 10 })),
	};
}

describe("web account management", () => {
	let root: string;
	let actions: ReturnType<typeof createWebAccountActions>;
	const child = () => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
	let processChild = child();
	const spawnProcess = vi.fn<typeof spawn>();
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "cma-web-actions-"));
		vi.stubEnv("CODEX_MULTI_AUTH_DIR", root);
		setStoragePath(null);
		await saveAccounts(pool());
		processChild = child();
		spawnProcess.mockReset().mockReturnValue(processChild as unknown as ReturnType<typeof spawn>);
		actions = createWebAccountActions({ entrypoint: "/fixture/manager.js", spawnProcess });
	});
	afterEach(async () => {
		actions.dispose?.();
		vi.unstubAllEnvs();
		setStoragePath(null);
		await removeWithRetry(root, { recursive: true, force: true });
	});
	const ref = (index: number) => getAccountPolicyKey(pool().accounts[index]!);

	it("persists pause, priority, weight, note, tags and auto-prime against stable identity", async () => {
		for (const [subcommand, value] of [["pause", ""], ["priority", "3"], ["weight", "2.5"], ["note", "中文备注"], ["tag", "batch"], ["auto-prime", "on"]]) {
			expect(await actions.perform("account", { accountRef: ref(1), subcommand, value })).toEqual({ ok: true });
		}
		const policy = (await loadAccountPolicyStore()).accounts[ref(1)];
		expect(policy).toMatchObject({ paused: true, priority: 3, weight: 2.5, note: "中文备注", tags: ["batch"], autoPrime: true });
		expect((await loadAccounts())?.pinnedAccountIndex).toBe(2);
	});

	it("removes a preceding account while preserving pin and family selection by identity", async () => {
		await expect(actions.perform("delete", { accountRef: ref(0) })).rejects.toThrow("confirmation_required");
		await actions.perform("delete", { accountRef: ref(0), confirm: true });
		const saved = await loadAccounts();
		expect(saved?.accounts.map(a => a.accountId)).toEqual(["acct_beta", "acct_gamma"]);
		expect(saved).toMatchObject({ activeIndex: 1, pinnedAccountIndex: 1, activeIndexByFamily: { codex: 1 } });
		expect(saved?.affinityGeneration).toBeGreaterThan(0);
		await expect(actions.perform("disable", { accountRef: ref(0) })).rejects.toThrow("account_changed");
	});

	it("rejects malformed values and does not write to a different positional account", async () => {
		await expect(actions.perform("account", { accountRef: ref(1), subcommand: "priority", value: "11" })).rejects.toThrow("invalid_value");
		await expect(actions.perform("account", { accountRef: ref(1), subcommand: "weight", value: "2garbage" })).rejects.toThrow("invalid_value");
		await expect(actions.perform("disable", { index: 1 })).rejects.toThrow("invalid_account");
		await actions.perform("disable", { accountRef: ref(1) });
		expect((await loadAccounts())?.accounts[1]?.enabled).toBe(false);
		await actions.perform("enable", { accountRef: ref(1) });
		expect((await loadAccounts())?.accounts[1]?.enabled).toBe(true);
	});

	it("merges backup accounts and keeps the existing pool and manual pin", async () => {
		await expect(actions.perform("import", { backup: { version: 3, accounts: [{ refreshToken: " " }] } })).rejects.toThrow("invalid_backup");
		const backup = pool();
		backup.accounts = [{ accountId: "acct_delta", refreshToken: "refresh-delta", addedAt: 11, lastUsed: 11 }];
		expect(await actions.perform("import", { backup })).toMatchObject({ ok: true, imported: 1, total: 4 });
		expect((await loadAccounts())?.pinnedAccountIndex).toBe(2);
		await expect(actions.perform("export", {})).rejects.toThrow("confirmation_required");
		const exported = await actions.perform("export", { confirm: true });
		expect(exported.backup).toMatchObject({ version: 3, accounts: expect.arrayContaining([expect.objectContaining({ accountId: "acct_delta" })]) });
	});

	it("re-authenticates the exact account with preserved selection and handles split device output", async () => {
		const result = await actions.startLogin!({ accountRef: ref(1) });
		expect(spawnProcess.mock.calls[0]?.[1]).toEqual(["/fixture/manager.js", "login", "--device-auth", "--preserve-selection", "--account", "acct_beta"]);
		processChild.stdout.write("Device auth login\nCo");
		processChild.stdout.write("de: ABCD-EFGH\n");
		expect(await actions.getOperation!(String(result.operationId))).toMatchObject({ status: "awaiting-device", code: "ABCD-EFGH" });
		await expect(actions.startLogin!({})).rejects.toThrow("operation_busy");
		processChild.emit("close", 0);
		expect(await actions.getOperation!(String(result.operationId))).toMatchObject({ status: "completed", code: null });
		expect((await loadAccounts())?.pinnedAccountIndex).toBe(2);
	});

	it("adds a single account, rejects obsolete index-only requests and cancels the login child", async () => {
		await expect(actions.startLogin!({ index: 2 })).rejects.toThrow("invalid_account");
		const result = await actions.startLogin!({});
		expect(spawnProcess.mock.calls[0]?.[1]).toEqual(["/fixture/manager.js", "login", "--device-auth", "--preserve-selection"]);
		await actions.perform("cancel", { operationId: result.operationId });
		expect(processChild.kill).toHaveBeenCalledWith("SIGTERM");
		expect(await actions.getOperation!(String(result.operationId))).toMatchObject({ status: "cancelled", code: null });
	});

	it("keeps credential-bearing child output private and cleans up on server shutdown", async () => {
		const result = await actions.perform("check", {});
		processChild.stderr.write("private refresh_token=test-secret-owner@example.org");
		processChild.emit("close", 1);
		const op = await actions.getOperation!(String(result.operationId));
		expect(op).toMatchObject({ status: "failed", error: "check_failed" });
		expect(JSON.stringify(op)).not.toContain("test-secret");
		await actions.startLogin!({});
		actions.dispose?.();
		expect(processChild.kill).toHaveBeenCalledWith("SIGTERM");
		await expect(actions.startLogin!({})).rejects.toThrow("server_stopped");
	});
});
