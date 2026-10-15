import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { OutputLocale } from "./locale.js";
import { WebActionError } from "./web-dashboard-actions.js";
import { renderDashboardHtml } from "./web-dashboard-html.js";

export interface WebStatusSnapshot {
	[key: string]: unknown;
}

export interface WebServerOptions {
	host?: string;
	port?: number;
	token?: string | null;
	refreshMs?: number;
	getStatus: () => Promise<WebStatusSnapshot>;
	locale?: OutputLocale;
	actions?: WebActionHandlers;
	openBrowser?: (url: string) => void;
}

export interface WebActionHandlers {
	perform: (action: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
	startLogin?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
	getOperation?: (operationId: string) => Promise<Record<string, unknown> | null>;
	dispose?: () => void;
}

export interface WebServerHandle {
	server: Server;
	url: string;
	token: string | null;
	close: () => Promise<void>;
}

function isLoopbackHost(host: string): boolean {
	const normalized = host.trim().toLowerCase();
	return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

function parsePort(value: string | undefined): number {
	const port = value === undefined ? 4317 : Number(value);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error("Web port must be an integer between 0 and 65535.");
	}
	return port;
}

function unauthorized(response: ServerResponse): void {
	response.writeHead(401, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"www-authenticate": "Bearer",
	});
	response.end(JSON.stringify({ error: "Unauthorized" }));
}

function authorized(request: IncomingMessage, token: string | null, url: URL): boolean {
	if (!token) return true;
	const header = request.headers.authorization;
	const bearer = typeof header === "string" && header.startsWith("Bearer ")
		? header.slice("Bearer ".length).trim()
		: "";
	const equal = (value: string) => {
		const candidate = Buffer.from(value);
		const expected = Buffer.from(token);
		return candidate.length === expected.length && timingSafeEqual(candidate, expected);
	};
	return equal(bearer) || equal(url.searchParams.get("token") ?? "");
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	response.end(JSON.stringify(value));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		size += buffer.length;
		if (size > 4 * 1024 * 1024) throw new WebActionError("body_too_large");
		chunks.push(buffer);
	}
	let parsed: unknown;
	try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
	catch { throw new WebActionError("invalid_json"); }
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new WebActionError("invalid_json");
	return parsed as Record<string, unknown>;
}

function openBrowserDefault(url: string): void {
	const command = process.platform === "darwin"
		? { file: "open", args: [url] }
		: process.platform === "win32"
			? { file: "cmd", args: ["/c", "start", "", url] }
			: { file: "xdg-open", args: [url] };
	try {
		const child = spawn(command.file, command.args, {
			detached: true,
			stdio: "ignore",
		});
		child.on("error", () => undefined);
		child.unref();
	} catch {
		// The server remains usable when no graphical opener is installed.
	}
}

function parseArgs(args: string[]): { host: string; port: number; token: string | null; refreshMs: number; noOpen: boolean } {
	let host = "127.0.0.1";
	let port = 4317;
	let token = (process.env.CODEX_MULTI_AUTH_WEB_TOKEN ?? "").trim() || null;
	let refreshMs = 5000;
	let noOpen = false;
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i] ?? "";
		const next = () => {
			const value = args[i + 1];
			if (!value || value.startsWith("--")) throw new Error("Missing value for " + arg);
			i += 1;
			return value;
		};
		if (arg === "--host") host = (next() ?? "").trim();
		else if (arg.startsWith("--host=")) host = arg.slice("--host=".length).trim();
		else if (arg === "--port") port = parsePort(next());
		else if (arg.startsWith("--port=")) port = parsePort(arg.slice("--port=".length));
		else if (arg === "--token") token = (next() ?? "").trim() || null;
		else if (arg.startsWith("--token=")) token = arg.slice("--token=".length).trim() || null;
		else if (arg === "--interval") refreshMs = Number(next());
		else if (arg.startsWith("--interval=")) refreshMs = Number(arg.slice("--interval=".length));
		else if (arg === "--no-open") noOpen = true;
		else if (arg === "--help" || arg === "-h") {
			throw new Error("Usage: codex-multi-auth web [--host 127.0.0.1] [--port 4317] [--token <token>] [--interval <ms>] [--no-open]");
		} else {
			throw new Error("Unknown web option: " + arg);
		}
	}
	if (!host) throw new Error("Web host cannot be empty.");
	if (!Number.isFinite(refreshMs) || refreshMs < 1000) throw new Error("Web refresh interval must be at least 1000 ms.");
	if (!isLoopbackHost(host) && !token) {
		throw new Error("Binding the web dashboard beyond loopback requires --token or CODEX_MULTI_AUTH_WEB_TOKEN.");
	}
	return { host, port, token, refreshMs: Math.round(refreshMs), noOpen };
}

export async function startWebServer(options: WebServerOptions): Promise<WebServerHandle> {
	const host = options.host?.trim() || "127.0.0.1";
	const port = options.port ?? 4317;
	const refreshMs = Math.max(1000, options.refreshMs ?? 5000);
	if (!isLoopbackHost(host) && !options.token?.trim()) {
		throw new Error("Binding the web dashboard beyond loopback requires a token.");
	}
	const token = options.token?.trim() || randomBytes(32).toString("hex");
	let refreshPromise: Promise<WebStatusSnapshot> | null = null;
	const clients = new Set<ServerResponse>();
	const refresh = async (): Promise<WebStatusSnapshot> => {
		if (!refreshPromise) {
			refreshPromise = options.getStatus().finally(() => {
				refreshPromise = null;
			});
		}
		return await refreshPromise;
	};
	const broadcast = (snapshot: WebStatusSnapshot) => {
		const message = "data: " + JSON.stringify(snapshot) + "\n\n";
		for (const client of clients) {
			try {
				if (client.writableLength > 1024 * 1024) { client.end(); clients.delete(client); }
				else client.write(message);
			} catch { clients.delete(client); }
		}
	};
	// The request handler intentionally awaits the status read before answering;
	// this keeps one response atomic while the server continues accepting SSE
	// connections. Node's callback type is void-returning, so mark the promise
	// boundary explicitly for the linter.
	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	const server = createServer(async (request, response) => {
		response.setHeader("referrer-policy", "no-referrer");
		response.setHeader("x-frame-options", "DENY");
		let requestUrl: URL;
		try { requestUrl = new URL(request.url ?? "/", "http://" + (request.headers.host ?? host)); }
		catch { sendJson(response, { error: "invalid_request" }, 400); return; }
		const requestHost = requestUrl.hostname.replace(/^\[|\]$/g, "");
		if (!(requestHost === host || isLoopbackHost(requestHost) || (["0.0.0.0", "::"].includes(host) && isIP(requestHost)))) {
			sendJson(response, { error: "invalid_host" }, 403); return;
		}
		const origin = request.headers.origin;
		if (origin && origin !== requestUrl.origin) { sendJson(response, { error: "invalid_origin" }, 403); return; }
		if (!authorized(request, token, requestUrl)) {
			unauthorized(response);
			return;
		}
		if (request.method !== "GET" && !(request.method === "POST" && requestUrl.pathname === "/api/actions")) {
			sendJson(response, { error: "method_not_allowed" }, 405); return;
		}
		if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
			response.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				"content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
			});
			response.end(renderDashboardHtml(token, options.locale));
			return;
		}
		if (requestUrl.pathname === "/api/health") {
			sendJson(response, { ok: true, service: "codex-multi-auth-web" });
			return;
		}
		if (requestUrl.pathname === "/api/status") {
			try { sendJson(response, await refresh()); }
			catch { sendJson(response, { error: "status_unavailable" }, 503); }
			return;
		}
		if (requestUrl.pathname === "/api/actions" && request.method === "POST") {
			if (!options.actions) { sendJson(response, { error: "Actions are unavailable." }, 404); return; }
			if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
				sendJson(response, { error: "json_required" }, 415); return;
			}
			try {
				const body = await readJsonBody(request);
				const action = typeof body.action === "string" ? body.action : "";
				if (action === "login") {
					if (!options.actions.startLogin) { sendJson(response, { error: "Login action is unavailable." }, 503); return; }
					sendJson(response, await options.actions.startLogin(body), 202);
					return;
				}
				const result = await options.actions.perform(action, body);
				sendJson(response, result, result.operationId ? 202 : result.ok === false ? 400 : 200);
				if (!result.operationId) void refresh().then(broadcast).catch(() => undefined);
			} catch (error) {
				sendJson(response, { error: error instanceof WebActionError ? error.code : "operation_failed" }, 400);
			}
			return;
		}
		if (requestUrl.pathname.startsWith("/api/operations/") && request.method === "GET") {
			if (!options.actions?.getOperation) { sendJson(response, { error: "Operations are unavailable." }, 404); return; }
			try {
				const operationId = decodeURIComponent(requestUrl.pathname.slice("/api/operations/".length));
				const operation = await options.actions.getOperation(operationId);
				if (!operation) { sendJson(response, { error: "operation_missing" }, 404); return; }
				sendJson(response, operation);
			} catch { sendJson(response, { error: "operation_failed" }, 400); }
			return;
		}
		if (requestUrl.pathname === "/events") {
			if (clients.size >= 20) { sendJson(response, { error: "too_many_connections" }, 429); return; }
			response.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-store",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			});
			response.write("retry: " + refreshMs + "\n\n");
			clients.add(response);
			try { response.write("data: " + JSON.stringify(await refresh()) + "\n\n"); } catch { response.end(); clients.delete(response); }
			request.on("close", () => clients.delete(response));
			return;
		}
		sendJson(response, { error: "Not found" }, 404);
	});
	server.requestTimeout = 30_000;
	server.headersTimeout = 10_000;
	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
		const onListening = () => { server.off("error", onError); resolve(); };
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});
	const address = server.address();
	const actualPort = typeof address === "object" && address ? address.port : port;
	const hostForUrl = host.includes(":") && !host.startsWith("[") ? "[" + host + "]" : host;
	const baseUrl = "http://" + hostForUrl + ":" + actualPort + "/";
	const url = token ? baseUrl + "?token=" + encodeURIComponent(token) : baseUrl;
	const interval = setInterval(() => { void refresh().then(broadcast).catch(() => undefined); }, refreshMs);
	interval.unref();
	return {
		server,
		url,
		token,
		close: async () => {
			clearInterval(interval);
			options.actions?.dispose?.();
			for (const client of clients) client.end();
			clients.clear();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

export async function runWebCommand(
	args: string[],
	deps: { getStatus: () => Promise<WebStatusSnapshot>; actions?: WebActionHandlers; locale?: OutputLocale; logInfo?: (message: string) => void; openBrowser?: (url: string) => void },
): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		(deps.logInfo ?? ((message: string) => process.stdout.write(message + "\n")))("Usage: codex-multi-auth web [--host 127.0.0.1] [--port 4317] [--token <token>] [--interval <ms>] [--no-open]");
		return 0;
	}
	let parsed;
	try { parsed = parseArgs(args); }
	catch (error) {
		(deps.logInfo ?? ((message: string) => process.stderr.write(message + "\n")))(error instanceof Error ? error.message : String(error));
		return 1;
	}
	let handle: WebServerHandle;
	try {
		handle = await startWebServer({
			...parsed,
			getStatus: deps.getStatus,
			actions: deps.actions,
			locale: deps.locale,
			openBrowser: deps.openBrowser,
		});
	} catch (error) {
		(deps.logInfo ?? ((message: string) => process.stderr.write(message + "\n")))(error instanceof Error ? error.message : String(error));
		return 1;
	}
	const logInfo = deps.logInfo ?? ((message: string) => process.stdout.write(message + "\n"));
	logInfo((deps.locale === "zh" ? "Codex Multi-Auth 网页：" : "Codex Multi-Auth web dashboard: ") + handle.url);
	logInfo(deps.locale === "zh" ? "实时刷新间隔：" + parsed.refreshMs + " ms；按 Ctrl-C 停止。" : "Refresh interval: " + parsed.refreshMs + " ms; Ctrl-C to stop.");
	if (!parsed.noOpen) (deps.openBrowser ?? openBrowserDefault)(handle.url);
	return await new Promise<number>((resolve) => {
		let stopped = false;
		const stop = () => {
			if (stopped) return;
			stopped = true;
			process.removeListener("SIGINT", stop);
			process.removeListener("SIGTERM", stop);
			void handle.close().finally(() => resolve(0));
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
}

export function parseWebCommandArgs(args: string[]): { host: string; port: number; token: string | null; refreshMs: number; openBrowser: boolean } {
	const parsed = parseArgs(args);
	return { ...parsed, openBrowser: !parsed.noOpen };
}
