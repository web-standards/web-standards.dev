import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const statsFile = join(__dirname, '..', 'src', 'data', 'stats.yml');
const firefoxApp = '/Applications/Firefox.app';

// Social media handles
const handles = {
	x: { name: 'X', username: 'webstandardsdev' },
	mastodon: { name: 'Mastodon', instance: 'mastodon.social', username: 'webstandards_dev' },
	bluesky: { name: 'Bluesky', handle: 'web-standards.dev' },
};

const platforms = Object.keys(handles);

// Convert a value (Date or string) to a YYYY-MM-DD string
function toDateString(value) {
	if (value instanceof Date) return value.toISOString().split('T')[0];
	return String(value);
}

// Load stats.yml (returns an array of entries)
// js-yaml parses unquoted YYYY-MM-DD as a Date, so normalize back to strings.
function loadStats() {
	if (existsSync(statsFile)) {
		try {
			const data = yamlLoad(readFileSync(statsFile, 'utf-8'));
			const history = Array.isArray(data) ? data : [];
			for (const entry of history) {
				if (entry?.date != null) entry.date = toDateString(entry.date);
			}
			return history;
		} catch (error) {
			console.error(`Failed to parse ${statsFile}:`, error.message);
		}
	}
	return [];
}

// Write stats.yml in a stable, hand-editable form
function saveStats(history) {
	const lines = [];
	for (const entry of history) {
		lines.push(`- date: ${entry.date}`);
		for (const key of platforms) {
			if (entry[key] != null) {
				lines.push(`  ${key}: ${entry[key]}`);
			}
		}
	}
	writeFileSync(statsFile, lines.join('\n') + '\n');
}

// Fetch Mastodon followers
async function getMastodonFollowers(instance, username) {
	try {
		const lookupUrl = `https://${instance}/api/v1/accounts/lookup?acct=${username}`;
		const response = await fetch(lookupUrl, { signal: AbortSignal.timeout(10000) });

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const data = await response.json();
		return data.followers_count;
	} catch {
		return null;
	}
}

// Fetch Bluesky followers
async function getBlueskyFollowers(handle) {
	try {
		const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${handle}`;
		const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const data = await response.json();
		return data.followersCount;
	} catch {
		return null;
	}
}

// The count is rendered client-side, so poll until it shows up
async function readFollowerText(session, context, timeout = 15000) {
	const expression = `document.querySelector('a[href$="/verified_followers"]')?.textContent ?? null`;
	const deadline = Date.now() + timeout;

	while (Date.now() < deadline) {
		const { result } = await session.send('script.evaluate', { expression, target: { context }, awaitPromise: false });

		if (result?.value != null) {
			return result.value;
		}

		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	return null;
}

// Fetch X followers by driving Firefox
async function getXFollowers(username, session) {
	const url = `https://x.com/${username}`;
	let context;

	try {
		({ context } = await session.send('browsingContext.create', { type: 'tab' }));
		await session.send('browsingContext.navigate', { context, url, wait: 'complete' });

		const status = session.statuses.get(url) ?? session.statuses.get(`${url}/`);
		if (status !== 200) {
			throw new Error(`HTTP ${status}`);
		}

		const followers = await readFollowerText(session, context);
		if (followers === null) {
			throw new Error('Follower count never rendered');
		}

		const match = followers.match(/([\d,]+)/);
		if (!match) {
			throw new Error(`No count in ${JSON.stringify(followers)}`);
		}

		return parseInt(match[1].replace(/,/g, ''));
	} catch (error) {
		// X blocks scraping in ways that change over time, so say what happened
		console.error(`X: ${error.message}`);
		return null;
	} finally {
		if (context) {
			await session.send('browsingContext.close', { context }).catch(() => {});
		}
	}
}

// Wait for Firefox to record the port its remote agent picked
async function readBiDiServer(file, timeout = 30000) {
	const deadline = Date.now() + timeout;

	while (Date.now() < deadline) {
		if (existsSync(file)) {
			try {
				return JSON.parse(readFileSync(file, 'utf-8'));
			} catch {
				// Still being written, try again
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}

	throw new Error('Firefox did not start a WebDriver BiDi server');
}

// Open a WebDriver BiDi session: send commands, await replies by id, and keep track of response codes so a block gets reported rather than timed out on.
async function openSession(endpoint) {
	const socket = new WebSocket(endpoint);

	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', () => reject(new Error(`Could not reach ${endpoint}`)), { once: true });
	});

	let nextId = 1;
	const pending = new Map();
	const statuses = new Map();

	socket.addEventListener('message', (event) => {
		const message = JSON.parse(event.data);

		if (message.method === 'network.responseCompleted') {
			statuses.set(message.params.request.url, message.params.response.status);
		}

		const request = pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);

		if (message.type === 'error') {
			request.reject(new Error(`${message.error}: ${message.message}`));
		} else {
			request.resolve(message.result);
		}
	});

	const send = (method, params = {}) => new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		socket.send(JSON.stringify({ id, method, params }));
	});

	await send('session.new', { capabilities: {} });
	await send('session.subscribe', { events: ['network.responseCompleted'] });

	return { send, statuses, close: () => socket.close() };
}

// Start headless Firefox and connect to it; the port it settles on is reported inside the profile.
// Whatever --profile says, Gecko also reads ~/Library/Application Support/Firefox for its own bookkeeping, and macOS guards that folder.
// Firefox spawned from a terminal inherits the terminal as its responsible process and gets denied, so it goes through LaunchServices and answers for itself.
async function startFirefox() {
	if (!existsSync(firefoxApp)) {
		throw new Error(`${firefoxApp} not found`);
	}

	const profile = mkdtempSync(join(tmpdir(), 'social-firefox-'));

	const cleanup = () => {
		spawnSync('pkill', ['-f', profile]);
		rmSync(profile, { recursive: true, force: true });
	};

	try {
		spawnSync('open', ['-na', firefoxApp, '--args', '--headless', '--no-remote', '--profile', profile, '--remote-debugging-port=0']);

		const { ws_host: host, ws_port: port } = await readBiDiServer(join(profile, 'WebDriverBiDiServer.json'));

		const session = await openSession(`ws://${host}:${port}/session`);

		return {
			session,
			stop: () => {
				session.close();
				cleanup();
			},
		};
	} catch (error) {
		cleanup();
		throw error;
	}
}

// Fetch all follower counts
async function fetchFollowers(handles, session) {
	const [mastodon, bluesky, x] = await Promise.all([
		handles.mastodon
			? getMastodonFollowers(handles.mastodon.instance, handles.mastodon.username)
			: Promise.resolve(null),
		handles.bluesky
			? getBlueskyFollowers(handles.bluesky.handle)
			: Promise.resolve(null),
		handles.x
			? getXFollowers(handles.x.username, session)
			: Promise.resolve(null),
	]);

	return { x, mastodon, bluesky };
}

async function main() {
	const history = loadStats();
	const today = new Date().toISOString().split('T')[0];

	// Skip the network if today is already recorded
	const existingToday = history.find((entry) => entry.date === today);
	if (existingToday) {
		console.log(`Stats for ${today} already recorded.`);
		return;
	}

	console.log('Fetching follower counts…');

	let followers;
	let firefox;
	try {
		firefox = await startFirefox();
		followers = await fetchFollowers(handles, firefox.session);
	} finally {
		if (firefox) {
			firefox.stop();
		}
	}

	const failed = platforms.filter((key) => followers[key] == null);
	if (failed.length > 0) {
		console.warn(`Warning: no data from ${failed.join(', ')}`);
	}

	// Backfill nulls from the most recent history entry
	const previous = history.at(-1);
	if (previous) {
		for (const key of platforms) {
			if (followers[key] == null && previous[key] != null) {
				followers[key] = previous[key];
			}
		}
	}

	// Refuse to write if we have absolutely nothing
	if (platforms.every((key) => followers[key] == null)) {
		console.error('No data collected and no previous values to fall back on.');
		process.exitCode = 1;
		return;
	}

	const entry = { date: today };
	for (const key of platforms) {
		if (followers[key] != null) entry[key] = followers[key];
	}

	const updated = [...history, entry].sort((a, b) => a.date.localeCompare(b.date));

	saveStats(updated);
	console.log(`Wrote stats for ${today}.`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
