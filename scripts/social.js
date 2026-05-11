import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const statsFile = join(__dirname, '..', 'src', 'data', 'stats.yml');

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

// Load stats.yml (returns { latest, history })
// js-yaml parses unquoted YYYY-MM-DD as a Date, so normalize back to strings.
function loadStats() {
	if (existsSync(statsFile)) {
		try {
			const data = yaml.load(readFileSync(statsFile, 'utf-8'));
			const history = Array.isArray(data?.history) ? data.history : [];
			for (const entry of history) {
				if (entry?.date != null) entry.date = toDateString(entry.date);
			}
			return {
				latest: data?.latest ?? {},
				history,
			};
		} catch (error) {
			console.error(`Failed to parse ${statsFile}:`, error.message);
		}
	}
	return { latest: {}, history: [] };
}

// Write stats.yml in a stable, hand-editable form
function saveStats({ latest, history }) {
	const lines = ['latest:'];
	for (const key of platforms) {
		if (latest[key] != null) {
			lines.push(`  ${key}: ${latest[key]}`);
		}
	}
	lines.push('history:');
	for (const entry of history) {
		lines.push(`  - date: ${entry.date}`);
		for (const key of platforms) {
			if (entry[key] != null) {
				lines.push(`    ${key}: ${entry[key]}`);
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

// Fetch X followers using Puppeteer
async function getXFollowers(username, browser) {
	const page = await browser.newPage();
	try {
		await page.goto(`https://x.com/${username}`, {
			waitUntil: 'networkidle2',
			timeout: 30000,
		});

		await page.waitForSelector('a[href$="/verified_followers"]', { timeout: 15000 });

		const followers = await page.$eval(
			'a[href$="/verified_followers"]',
			(el) => el.textContent
		);

		const match = followers.match(/([\d,]+)/);
		if (match) {
			return parseInt(match[1].replace(/,/g, ''));
		}

		return null;
	} catch {
		return null;
	} finally {
		await page.close();
	}
}

// Fetch all follower counts
async function fetchFollowers(handles, browser) {
	const [mastodon, bluesky, x] = await Promise.all([
		handles.mastodon
			? getMastodonFollowers(handles.mastodon.instance, handles.mastodon.username)
			: Promise.resolve(null),
		handles.bluesky
			? getBlueskyFollowers(handles.bluesky.handle)
			: Promise.resolve(null),
		handles.x
			? getXFollowers(handles.x.username, browser)
			: Promise.resolve(null),
	]);

	return { x, mastodon, bluesky };
}

async function main() {
	const stats = loadStats();
	const today = new Date().toISOString().split('T')[0];

	// Skip the network if today is already recorded
	const existingToday = stats.history.find((entry) => entry.date === today);
	if (existingToday) {
		console.log(`Stats for ${today} already recorded.`);
		return;
	}

	console.log('Fetching follower counts…');

	let followers;
	let browser;
	try {
		browser = await puppeteer.launch({
			browser: 'firefox',
			protocol: 'webDriverBiDi',
		});
		followers = await fetchFollowers(handles, browser);
	} finally {
		if (browser) {
			await browser.close();
		}
	}

	const failed = platforms.filter((key) => followers[key] == null);
	if (failed.length > 0) {
		console.warn(`Warning: no data from ${failed.join(', ')}`);
	}

	// Backfill nulls from the most recent history entry
	const previous = stats.history.at(-1);
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

	const history = [...stats.history, entry].sort((a, b) => a.date.localeCompare(b.date));

	const latest = {};
	for (const key of platforms) {
		if (followers[key] != null) latest[key] = followers[key];
	}

	saveStats({ latest, history });
	console.log(`Wrote stats for ${today}.`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
