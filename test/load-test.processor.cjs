'use strict';

const http = require('node:http');
const https = require('node:https');

const DEFAULT_BASIC_AUTH = 'Basic YWRtaW46cGFzc3dvcmQ=';

function getLoadTestTarget() {
	const target = process.env.DD_LOAD_TEST_TARGET;
	if (!target) {
		throw new Error('DD_LOAD_TEST_TARGET is not set');
	}
	return target;
}

function getAuthHeader() {
	return process.env.DD_LOAD_TEST_AUTH_HEADER || DEFAULT_BASIC_AUTH;
}

function buildApiUrl(pathname) {
	return new URL(pathname, getLoadTestTarget()).toString();
}

async function requestJson(pathname, options = {}) {
	const headers = {
		Accept: 'application/json',
		Authorization: getAuthHeader(),
		...(options.headers || {}),
	};

	let body;
	if (options.body !== undefined) {
		body = JSON.stringify(options.body);
		if (!headers['Content-Type'] && !headers['content-type']) {
			headers['Content-Type'] = 'application/json';
		}
	}

	const response = await fetch(buildApiUrl(pathname), {
		method: options.method || 'GET',
		headers,
		body,
	});

	const text = await response.text();
	let responseBody = null;
	if (text.length > 0) {
		try {
			responseBody = JSON.parse(text);
		} catch {
			responseBody = text;
		}
	}

	return {
		status: response.status,
		body: responseBody,
	};
}

function openSseConnection(timeoutMs = 5000) {
	return new Promise((resolve, reject) => {
		const targetUrl = new URL('/api/events/ui', getLoadTestTarget());
		const transport = targetUrl.protocol === 'https:' ? https : http;
		let settled = false;

		const settle = (error) => {
			if (settled) {
				return;
			}
			settled = true;
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		};

		const req = transport.request(
			targetUrl,
			{
				method: 'GET',
				headers: {
					Accept: 'text/event-stream',
					Authorization: getAuthHeader(),
					'Cache-Control': 'no-cache',
				},
			},
			(res) => {
				if (res.statusCode !== 200) {
					res.resume();
					settle(new Error(`Unexpected SSE status code: ${res.statusCode}`));
					return;
				}

				let buffer = '';
				const timeout = setTimeout(() => {
					req.destroy();
					settle(new Error('Timed out waiting for SSE dd:connected event'));
				}, timeoutMs);

				const complete = () => {
					clearTimeout(timeout);
					req.destroy();
					settle();
				};

				res.on('data', (chunk) => {
					buffer += chunk.toString('utf8');
					if (buffer.includes('event: dd:connected')) {
						complete();
					}
				});

				res.on('end', () => {
					clearTimeout(timeout);
					if (!settled) {
						settle(new Error('SSE stream ended before dd:connected event'));
					}
				});

				res.on('error', (error) => {
					clearTimeout(timeout);
					if (!settled) {
						settle(error);
					}
				});
			},
		);

		req.on('error', (error) => {
			if (!settled) {
				settle(error);
			}
		});

		req.end();
	});
}

async function probeSseReconnect() {
	await openSseConnection();
	await openSseConnection();
}

async function probeConnectedAgentLogs() {
	const agentsResponse = await requestJson('/api/agents');
	if (agentsResponse.status !== 200) {
		throw new Error(`Failed to list agents (status ${agentsResponse.status})`);
	}

	const agents = Array.isArray(agentsResponse.body) ? agentsResponse.body : [];
	const connectedAgent = agents.find(
		(agent) => agent && agent.connected === true && typeof agent.name === 'string',
	);

	// Agent log happy-path is optional in this environment.
	if (!connectedAgent) {
		return;
	}

	const logsResponse = await requestJson(
		`/api/agents/${encodeURIComponent(connectedAgent.name)}/log/entries?tail=100`,
	);
	if (logsResponse.status !== 200) {
		throw new Error(`Expected 200 from connected agent log endpoint, got ${logsResponse.status}`);
	}
}

function dropAuthorization(requestParams, _context, _events, next) {
	requestParams.headers = requestParams.headers || {};
	delete requestParams.headers.Authorization;
	delete requestParams.headers.authorization;
	next();
}

module.exports = {
	dropAuthorization,
	probeConnectedAgentLogs,
	probeSseReconnect,
};
