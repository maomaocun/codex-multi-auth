import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionMonitor } from "../lib/codex-session-monitor.js";

const row = (type: string, payload: Record<string, unknown>, timestamp = "2026-10-15T00:00:00.000Z") => JSON.stringify({ type, timestamp, payload }) + "\n";
const waitFor = async (check: () => boolean) => { for (let i = 0; i < 220; i += 1) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error("monitor did not settle"); };

describe("Codex session monitor", () => {
	let root = "";
	let monitor: ReturnType<typeof createSessionMonitor> | null = null;
	afterEach(async () => { monitor?.stop(); if (root) await rm(root, { recursive: true, force: true }); });

	it("indexes token records, nested agents, task timing and deduplicates replayed responses", async () => {
		root = await mkdtemp(join(tmpdir(), "cma-session-monitor-"));
		const parent = row("session_meta", { id: "parent" }) + row("turn_context", { turn_id: "turn", model: "gpt-6.1-sol", service_tier: "standard" }) + row("token_usage_record", { thread_id: "parent", turn_id: "turn", response_id: "r1", usage: { input_tokens: 100, cached_input_tokens: 25, output_tokens: 20, reasoning_output_tokens: 5 } });
		const child = row("session_meta", { id: "child", parent_thread_id: "parent" }) + row("turn_context", { turn_id: "child-turn", model: "gpt-6-luna", service_tier: "priority" }) + row("token_usage_record", { thread_id: "child", turn_id: "child-turn", response_id: "r2", usage: { input_tokens: 40, cached_input_tokens: 10, output_tokens: 5 } });
		await writeFile(join(root, "rollout-parent.jsonl"), parent); await writeFile(join(root, "rollout-child.jsonl"), child); await writeFile(join(root, "rollout-replay.jsonl"), parent);
		monitor = createSessionMonitor({ sessionsDir: root, refreshMs: 1000 }); monitor.start(); await waitFor(() => Boolean(monitor?.status().ready && !monitor.status().scanning));
		const report = monitor.report({ period: "all" }) as { summary: Record<string, number>; models: Array<Record<string, unknown>>; sessions: Array<Record<string, unknown>>; timing: unknown };
		expect(report.summary).toMatchObject({ responses: 2, inputTokens: 140, outputTokens: 25, cachedInputTokens: 35, totalTokens: 165, rootTokens: 120, childTokens: 45 });
		expect(report.models.map(row => row.key)).toEqual(["gpt-6.1-sol", "gpt-6-luna"]);
		expect(report.sessions[0]).toMatchObject({ id: "parent", childCount: 1 });
	});

	it("does not block on partial append and rebuilds a replaced file", async () => {
		root = await mkdtemp(join(tmpdir(), "cma-session-monitor-")); const path = join(root, "rollout-root.jsonl");
		await writeFile(path, row("session_meta", { id: "root" }) + row("token_usage_record", { thread_id: "root", response_id: "a", usage: { input_tokens: 1, output_tokens: 1 } }));
		monitor = createSessionMonitor({ sessionsDir: root, refreshMs: 20 }); monitor.start(); await waitFor(() => Boolean(monitor?.status().ready && !monitor.status().scanning)); expect((monitor.report({ period: "all" }) as { summary: { totalTokens: number } }).summary.totalTokens).toBe(2);
		const partial = row("token_usage_record", { thread_id: "root", response_id: "b", usage: { input_tokens: 2, output_tokens: 2 } }); await appendFile(path, partial.slice(0, -2)); await new Promise(resolve => setTimeout(resolve, 1100)); expect((monitor.report({ period: "all" }) as { summary: { totalTokens: number } }).summary.totalTokens).toBe(2);
		await appendFile(path, partial.slice(-2)); await waitFor(() => (monitor!.report({ period: "all" }) as { summary: { totalTokens: number } }).summary.totalTokens === 6);
		await writeFile(path, row("session_meta", { id: "replacement" }) + row("token_usage_record", { thread_id: "replacement", response_id: "c", usage: { input_tokens: 3, output_tokens: 3 } })); await new Promise(resolve => setTimeout(resolve, 2500)); expect((monitor!.report({ period: "all" }) as { summary: { totalTokens: number } }).summary.totalTokens).toBe(6);
		expect((monitor.report({ period: "all" }) as { sessions: Array<{ id: string }> }).sessions[0]?.id).toBe("replacement");
	});
});
