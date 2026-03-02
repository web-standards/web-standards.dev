import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(__dirname, '..', '.cache');
const cacheFile = join(cacheDir, 'social.json');

// ANSI colors
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const black = '\x1b[90m'; // X
const violet = '\x1b[35m'; // Mastodon
const blue = '\x1b[34m'; // Bluesky

const dateFormat = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
});

// Social media handles
const handles = {
	x: { username: 'webstandardsdev' },
	mastodon: { instance: 'mastodon.social', username: 'webstandards_dev' },
	bluesky: { handle: 'web-standards.dev' },
};

// Load cache
function loadCache() {
	try {
		if (existsSync(cacheFile)) {
			return JSON.parse(readFileSync(cacheFile, 'utf-8'));
		}
	} catch {
		// Ignore cache errors
	}
	return {};
}

// Save cache
function saveCache(cache) {
	try {
		if (!existsSync(cacheDir)) {
			mkdirSync(cacheDir, { recursive: true });
		}
		writeFileSync(cacheFile, JSON.stringify(cache, null, '\t'));
	} catch {
		// Ignore cache errors
	}
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
	try {
		const page = await browser.newPage();

		await page.goto(`https://x.com/${username}`, {
			waitUntil: 'networkidle2',
			timeout: 30000,
		});

		// Wait for the followers link to appear
		await page.waitForSelector('a[href$="/verified_followers"]', { timeout: 15000 });

		// Extract follower count from the link
		const followers = await page.$eval(
			'a[href$="/verified_followers"]',
			(el) => el.textContent
		);

		await page.close();

		// Parse number from text like "102 Followers"
		const match = followers.match(/([\d,]+)/);
		if (match) {
			return parseInt(match[1].replace(/,/g, ''));
		}

		return null;
	} catch {
		return null;
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

// Main
async function main() {
	const cache = loadCache();
	const today = new Date().toISOString().split('T')[0];

	process.stdout.write('Fetching follower counts…');

	let browser;
	try {
		browser = await puppeteer.launch({
			browser: 'firefox',
			protocol: 'webDriverBiDi',
		});

		// Fetch fresh data for today
		const followers = await fetchFollowers(handles, browser);
		cache[today] = { date: today, ...followers };
	} finally {
		if (browser) {
			await browser.close();
		}
	}

	// Clear progress line
	process.stdout.write('\r' + ' '.repeat(30) + '\r');

	// Save updated cache
	saveCache(cache);

	// Get all cached days sorted by date
	const stats = Object.values(cache).sort((a, b) => a.date.localeCompare(b.date));

	if (stats.length === 0) {
		console.log('No data yet. Run the script to collect follower counts.\n');
		return;
	}

	// Find max for scaling (total of all platforms)
	const maxFollowers = Math.max(
		...stats.map((s) => (s.x || 0) + (s.mastodon || 0) + (s.bluesky || 0)),
		1
	);
	const barWidth = 40;

	console.log('Social media followers\n');

	// Legend
	console.log(`${dim}Legend${reset} ${black}█${reset} X  ${violet}█${reset} Mastodon  ${blue}█${reset} Bluesky\n`);

	for (const day of stats) {
		const label = `${dim}${dateFormat.format(new Date(day.date))}${reset}`.padEnd(6 + dim.length + reset.length);

		const xCount = day.x || 0;
		const mastodonCount = day.mastodon || 0;
		const blueskyCount = day.bluesky || 0;
		const total = xCount + mastodonCount + blueskyCount;

		// Distribute total width among platforms using largest-remainder method
		// so the filled width is always consistent with the total count
		const filledWidth = Math.round((total / maxFollowers) * barWidth);
		const emptyWidth = barWidth - filledWidth;

		const counts = [xCount, mastodonCount, blueskyCount];
		const exact = counts.map((c) => total > 0 ? (c / total) * filledWidth : 0);
		const floored = exact.map(Math.floor);
		let remainder = filledWidth - floored.reduce((a, b) => a + b, 0);
		const remainders = exact.map((e, i) => ({ i, r: e - floored[i] }));
		remainders.sort((a, b) => b.r - a.r);
		for (const { i } of remainders) {
			if (remainder <= 0) break;
			floored[i]++;
			remainder--;
		}
		const [xWidth, mastodonWidth, blueskyWidth] = floored;

		const bar = `${black}${'█'.repeat(xWidth)}${reset}${violet}${'█'.repeat(mastodonWidth)}${reset}${blue}${'█'.repeat(blueskyWidth)}${reset}${dim}${'░'.repeat(emptyWidth)}${reset}`;
		console.log(`${label} ${bar} ${total}`);
	}

	// Show latest numbers below each section
	const latest = stats[stats.length - 1];
	if (latest && (latest.x || latest.mastodon || latest.bluesky)) {
		const latestX = latest.x || 0;
		const latestMastodon = latest.mastodon || 0;
		const latestBluesky = latest.bluesky || 0;

		const latestTotal = latestX + latestMastodon + latestBluesky;
		const latestFilledWidth = Math.round((latestTotal / maxFollowers) * barWidth);

		const latestCounts = [latestX, latestMastodon, latestBluesky];
		const latestExact = latestCounts.map((c) => latestTotal > 0 ? (c / latestTotal) * latestFilledWidth : 0);
		const latestFloored = latestExact.map(Math.floor);
		let latestRemainder = latestFilledWidth - latestFloored.reduce((a, b) => a + b, 0);
		const latestRemainders = latestExact.map((e, i) => ({ i, r: e - latestFloored[i] }));
		latestRemainders.sort((a, b) => b.r - a.r);
		for (const { i } of latestRemainders) {
			if (latestRemainder <= 0) break;
			latestFloored[i]++;
			latestRemainder--;
		}
		const [xWidth, mastodonWidth, blueskyWidth] = latestFloored;

		// Show each number at the start of its section
		const xLabel = xWidth > 0 ? String(latestX).padEnd(xWidth) : '';
		const mastodonLabel = mastodonWidth > 0 ? String(latestMastodon).padEnd(mastodonWidth) : '';
		const blueskyLabel = blueskyWidth > 0 ? String(latestBluesky).padEnd(blueskyWidth) : '';

		const labelPad = ''.padEnd(6);
		console.log(`${labelPad} ${black}${xLabel}${reset}${violet}${mastodonLabel}${reset}${blue}${blueskyLabel}${reset}`);
	}

	console.log();
}

main().catch(console.error);
