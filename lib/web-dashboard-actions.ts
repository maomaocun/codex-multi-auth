import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getAccountPolicyKey } from "./account-policy.js";
import { ACCOUNT_LIMITS } from "./constants.js";
import { AnyAccountStorageSchema } from "./schemas.js";
import {
	bumpStorageAffinityGeneration, deduplicateAccounts, findMatchingAccountIndex,
	loadAccounts, normalizeAccountStorage, reconcilePinnedAccountIndex,
	withAccountStorageTransaction, saveAccounts, getStoragePath, type AccountStorageV3,
} from "./storage.js";
import { mergeImportedAccounts } from "./storage/import-export.js";
import { runWithGlobalStoragePath } from "./storage/path-state.js";
import { runAccountCommand } from "./codex-manager/commands/account.js";
import { runSwitchCommand } from "./codex-manager/commands/switch.js";
import { runUnpinCommand } from "./codex-manager/commands/unpin.js";
import { runWorkspaceCommand } from "./codex-manager/commands/workspace.js";
import { persistAndSyncSelectedAccount } from "./codex-manager/persist-selected-account.js";
import type { WebActionHandlers } from "./web-dashboard.js";

type Operation = {
	id: string;
	kind: "login" | "check";
	status: "running" | "awaiting-device" | "completed" | "failed" | "cancelled";
	code: string | null;
	url: string | null;
	error: string | null;
	startedAt: number;
	finishedAt: number | null;
};

export class WebActionError extends Error {
	constructor(public readonly code: string) { super(code); }
}

export interface WebAccountActionOptions {
	entrypoint: string;
	spawnProcess?: typeof spawn;
}

/** Each server owns its operations and child lifetimes; no process-global web state. */
export function createWebAccountActions(options: WebAccountActionOptions): WebActionHandlers {
	const operations = new Map<string, Operation>();
	const children = new Map<string, ChildProcess>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	let queue: Promise<unknown> = Promise.resolve();
	let disposed = false;
	const active = (kind: Operation["kind"]) => [...operations.values()].find(
		op => op.kind === kind && (op.status === "running" || op.status === "awaiting-device"),
	);
	const serialize = <T>(run: () => Promise<T>): Promise<T> => {
		const result = queue.then(() => runWithGlobalStoragePath(run));
		queue = result.catch(() => undefined);
		return result;
	};
	const resolveTarget = (storage: AccountStorageV3 | null, payload: Record<string, unknown>) => {
		const ref = payload.accountRef;
		if (typeof ref !== "string" || !/^sha256:[a-f0-9]{64}$/.test(ref)) throw new WebActionError("invalid_account");
		const index = storage?.accounts.findIndex(account => getAccountPolicyKey(account) === ref) ?? -1;
		const account = storage?.accounts[index];
		if (!account) throw new WebActionError("account_changed");
		return { index, account };
	};
	const capture = async (run: (log: (message: string) => void) => Promise<number>) => {
		// CLI diagnostics can contain account details. The web contract returns
		// stable error codes; raw credentials/child output never enter responses.
		const result = await run(() => undefined);
		if (result !== 0) throw new WebActionError("invalid_value");
		return { ok: true };
	};
	const launch = (args: string[], kind: Operation["kind"]): Record<string, unknown> => {
		if (disposed) throw new WebActionError("server_stopped");
		const pending = active("login") ?? active("check");
		if (pending) throw new WebActionError("operation_busy");
		for (const [id, op] of operations) {
			if (operations.size < 32) break;
			if (op.finishedAt !== null) operations.delete(id);
		}
		const operation: Operation = {
			id: randomUUID(), kind, status: "running", code: null, url: null, error: null,
			startedAt: Date.now(), finishedAt: null,
		};
		operations.set(operation.id, operation);
		const finish = (status: Operation["status"], error: string | null = null) => {
			if (operation.finishedAt !== null) return;
			operation.status = status;
			operation.error = error;
			operation.finishedAt = Date.now();
			operation.code = null;
			clearTimeout(timers.get(operation.id));
			timers.delete(operation.id);
			children.delete(operation.id);
		};
		let child: ChildProcess;
		try {
			child = (options.spawnProcess ?? spawn)(process.execPath, [options.entrypoint, ...args], {
				env: { ...process.env, CODEX_AUTH_NO_BROWSER: "1", CODEX_MULTI_AUTH_LOCALE: "en", NO_COLOR: "1" },
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch {
			finish("failed", "process_failed");
			return { operationId: operation.id };
		}
		children.set(operation.id, child);
		let output = "";
		const consume = (chunk: Buffer | string) => {
			output = (output + String(chunk)).slice(-32_768);
			if (kind !== "login" || operation.finishedAt !== null) return;
			const code = output.match(/\bCode:[ \t]*([A-Z0-9-]{4,32})\r?\n/);
			if (code) {
				operation.code = code[1] ?? null;
				operation.url = "https://auth.openai.com/codex/device";
				operation.status = "awaiting-device";
			}
		};
		child.stdout?.on("data", consume);
		child.stderr?.on("data", consume);
		child.once("error", () => finish("failed", "process_failed"));
		child.once("close", code => finish(code === 0 ? "completed" : "failed", code === 0 ? null : kind + "_failed"));
		const timer = setTimeout(() => {
			finish("failed", "operation_timeout");
			child.kill("SIGTERM");
		}, kind === "login" ? 16 * 60_000 : 5 * 60_000);
		timer.unref();
		timers.set(operation.id, timer);
		return { operationId: operation.id };
	};
	return {
		perform: (action, payload) => serialize(async () => {
			if (disposed) throw new WebActionError("server_stopped");
			if (action === "cancel") {
				const operation = operations.get(String(payload.operationId));
				if (!operation) throw new WebActionError("operation_missing");
				if (operation.finishedAt === null) {
					operation.status = "cancelled";
					operation.code = null;
					operation.finishedAt = Date.now();
					children.get(operation.id)?.kill("SIGTERM");
					children.delete(operation.id);
					clearTimeout(timers.get(operation.id));
					timers.delete(operation.id);
				}
				return { ok: true };
			}
			if (action === "check") return launch(["check", "accounts"], "check");
			const storage = await loadAccounts();
			if (action === "export") {
				if (payload.confirm !== true) throw new WebActionError("confirmation_required");
				if (!storage?.accounts.length) throw new WebActionError("no_accounts");
				return { ok: true, backup: storage };
			}
			if (action === "import") {
				if (active("login")) throw new WebActionError("operation_busy");
				const parsed = AnyAccountStorageSchema.safeParse(payload.backup);
				if (!parsed.success || !parsed.data.accounts.length) throw new WebActionError("invalid_backup");
				const imported = normalizeAccountStorage(parsed.data);
				if (!imported) throw new WebActionError("invalid_backup");
				return withAccountStorageTransaction(async (existing, persist) => {
					const result = mergeImportedAccounts({ existing, imported, maxAccounts: ACCOUNT_LIMITS.MAX_ACCOUNTS, deduplicateAccounts, findMatchingAccountIndex });
					await persist(result.newStorage);
					return { ok: true, imported: result.imported, total: result.total, skipped: result.skipped };
				});
			}
			if (action === "unpin") return capture(log => runUnpinCommand({ setStoragePath: () => undefined, loadAccounts, saveAccounts, getStoragePath, logInfo: log, logError: log }));
			const { index } = resolveTarget(storage, payload);
			const guardedLoad = async () => {
				const fresh = await loadAccounts();
				const resolved = resolveTarget(fresh, payload);
				if (resolved.index !== index) throw new WebActionError("account_changed");
				return fresh;
			};
			if (action === "switch") return capture(log => runSwitchCommand([String(index + 1)], {
				setStoragePath: () => undefined, loadAccounts: guardedLoad, persistAndSyncSelectedAccount,
				logInfo: log, logError: log, logWarn: log,
			}));
			if (action === "workspace") {
				return capture(log => runWorkspaceCommand([String(index + 1), String(payload.value ?? "")], {
					setStoragePath: () => undefined, loadAccounts: guardedLoad, saveAccounts, logInfo: log, logError: log,
				}));
			}
			if (action === "delete" || action === "enable" || action === "disable") {
				if (action === "delete" && payload.confirm !== true) throw new WebActionError("confirmation_required");
				if (active("login") || active("check")) throw new WebActionError("operation_busy");
				return withAccountStorageTransaction(async (fresh, persist) => {
					const target = resolveTarget(fresh, payload);
					if (!fresh) throw new WebActionError("account_changed");
					if (action === "delete") {
						const pinned = typeof fresh.pinnedAccountIndex === "number" ? fresh.accounts[fresh.pinnedAccountIndex] : undefined;
						fresh.accounts.splice(target.index, 1);
						const adjust = (n: number) => n > target.index ? n - 1 : Math.min(n, Math.max(0, fresh.accounts.length - 1));
						fresh.activeIndex = adjust(fresh.activeIndex);
						if (fresh.activeIndexByFamily) for (const family of Object.keys(fresh.activeIndexByFamily) as Array<keyof NonNullable<AccountStorageV3["activeIndexByFamily"]>>) {
							fresh.activeIndexByFamily[family] = adjust(fresh.activeIndexByFamily[family] ?? 0);
						}
						fresh.pinnedAccountIndex = reconcilePinnedAccountIndex(pinned, fresh.accounts);
					} else target.account.enabled = action === "enable";
					bumpStorageAffinityGeneration(fresh);
					await persist(fresh);
					return { ok: true };
				});
			}
			if (action === "account") {
				const subcommand = String(payload.subcommand ?? "");
				if (!["pause", "unpause", "drain", "undrain", "auto-prime", "priority", "weight", "note", "tag", "untag"].includes(subcommand)) throw new WebActionError("unknown_action");
				const args = [subcommand, String(index + 1)];
				if (subcommand === "weight" && (typeof payload.value !== "string" || !payload.value.trim() || !Number.isFinite(Number(payload.value)))) throw new WebActionError("invalid_value");
				if (["auto-prime", "priority", "weight", "note", "tag", "untag"].includes(subcommand)) args.push(String(payload.value ?? ""));
				return capture(log => runAccountCommand(args, { setStoragePath: () => undefined, loadAccounts: guardedLoad, logInfo: log, logError: log }));
			}
			throw new WebActionError("unknown_action");
		}),
		startLogin: payload => serialize(async () => {
			if (payload.index !== undefined && !payload.accountRef) throw new WebActionError("invalid_account");
			const args = ["login", "--device-auth", "--preserve-selection"];
			if (payload.accountRef !== undefined && payload.accountRef !== null) {
				const storage = await loadAccounts();
				const { account } = resolveTarget(storage, payload);
				// Pass a stable identity; a stale positional index must never re-login another account.
				const selector = [account.accountId, account.email].find(value => value && !/^[1-9]\d*$/.test(value) && storage?.accounts.filter(row => row.accountId === value || row.email === value).length === 1);
				if (!selector) throw new WebActionError("identity_missing");
				args.push("--account", selector);
			}
			return launch(args, "login");
		}),
		getOperation: id => Promise.resolve(operations.has(id) ? { ...operations.get(id) } : null),
		dispose: () => {
			disposed = true;
			for (const timer of timers.values()) clearTimeout(timer);
			for (const child of children.values()) child.kill("SIGTERM");
			timers.clear();
			children.clear();
			operations.clear();
		},
	};
}
