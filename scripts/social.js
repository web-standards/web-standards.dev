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
const yellow = '\x1b[33m'; // Warnings

const dateFormat = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	timeZone: 'UTC',
});

// Social media handles
const handles = {
	x: { name: 'X', username: 'webstandardsdev' },
	mastodon: { name: 'Mastodon', instance: 'mastodon.social', username: 'webstandards_dev' },
	bluesky: { name: 'Bluesky', handle: 'web-standards.dev' },
};

const platforms = Object.keys(handles);
const platformNames = Object.fromEntries(platforms.map((key) => [key, handles[key].name]));
const platformColors = { x: black, mastodon: violet, bluesky: blue };

// Distribute a total width among segments using the largest-remainder method
// so the segment widths always sum to exactly totalWidth
function distributeWidths(counts, totalWidth) {
	const total = counts.reduce((a, b) => a + b, 0);
	const exact = counts.map((c) => total > 0 ? (c / total) * totalWidth : 0);
	const floored = exact.map(Math.floor);
	let remainder = totalWidth - floored.reduce((a, b) => a + b, 0);
	const remainders = exact.map((e, i) => ({ i, r: e - floored[i] }));
	remainders.sort((a, b) => b.r - a.r);
	for (const { i } of remainders) {
		if (remainder <= 0) break;
		floored[i]++;
		remainder--;
	}
	return floored;
}

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
	const page = await browser.newPage();
	try {
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

		// Parse number from text like "102 Followers"
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

// Main
async function main() {
	const cache = loadCache();
	const today = new Date().toISOString().split('T')[0];

	if (cache[today]) {
		console.log('Using cached data for today.\n');
	} else {
		process.stdout.write('Fetching follower counts…');

		let browser;
		try {
			browser = await puppeteer.launch({
				browser: 'firefox',
				protocol: 'webDriverBiDi',
			});

			// Fetch fresh data for today
			const followers = await fetchFollowers(handles, browser);

			// Warn about platforms that returned no data
			const failed = platforms.filter((key) => followers[key] == null);
			if (failed.length > 0) {
				process.stdout.write('\r' + ' '.repeat(30) + '\r');
				console.warn(`${yellow}Warning: no data from ${failed.map((key) => platformNames[key]).join(', ')}${reset}`);
			}

			// Fill in null counts from the most recent cached value
			const previous = Object.values(cache)
				.sort((a, b) => a.date.localeCompare(b.date))
				.at(-1);
			if (previous) {
				for (const key of platforms) {
					if (followers[key] == null && previous[key] != null) {
						followers[key] = previous[key];
					}
				}
			}

			// Only cache if at least one platform has data
			if (platforms.some((key) => followers[key] != null)) {
				cache[today] = { date: today, ...followers };
			}
		} finally {
			if (browser) {
				await browser.close();
			}
		}

		// Clear progress line
		process.stdout.write('\r' + ' '.repeat(30) + '\r');

		// Save updated cache
		saveCache(cache);
	}

	// Get all cached days sorted by date
	const showAll = process.argv[2] === 'all';
	let stats = Object.values(cache).sort((a, b) => a.date.localeCompare(b.date));

	// Backfill nulls from the nearest previous entry
	for (let i = 1; i < stats.length; i++) {
		for (const key of platforms) {
			if (stats[i][key] == null && stats[i - 1][key] != null) {
				stats[i][key] = stats[i - 1][key];
			}
		}
	}

	if (stats.length === 0) {
		console.log('No data yet. Run the script to collect follower counts.\n');
		return;
	}

	// Filter to last two weeks unless "all" is passed
	if (!showAll) {
		const twoWeeksAgo = new Date();
		twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
		const cutoff = twoWeeksAgo.toISOString().split('T')[0];
		stats = stats.filter((s) => s.date >= cutoff);
	}

	// Find max for scaling (total of all platforms)
	const maxFollowers = Math.max(
		...stats.map((s) => platforms.reduce((sum, key) => sum + (s[key] || 0), 0)),
		1
	);
	const barWidth = 40;
	const dateLabelWidth = 6;

	console.log('Social media followers\n');

	// Legend
	console.log(`${dim}Legend${reset} ${black}█${reset} X  ${violet}█${reset} Mastodon  ${blue}█${reset} Bluesky\n`);

	for (const day of stats) {
		const dateText = dateFormat.format(new Date(day.date));
		const label = `${dim}${dateText}${reset}`.padEnd(dateLabelWidth + dim.length + reset.length);

		const counts = platforms.map((key) => day[key] || 0);
		const total = counts.reduce((a, b) => a + b, 0);

		const filledWidth = Math.round((total / maxFollowers) * barWidth);
		const emptyWidth = barWidth - filledWidth;

		const widths = distributeWidths(counts, filledWidth);

		const bar = platforms.map((key, i) =>
			`${platformColors[key]}${'█'.repeat(widths[i])}${reset}`
		).join('') + `${dim}${'░'.repeat(emptyWidth)}${reset}`;

		console.log(`${label} ${bar} ${total}`);
	}

	// Show latest numbers below each section
	const latest = stats[stats.length - 1];
	if (latest && platforms.some((key) => latest[key])) {
		const counts = platforms.map((key) => latest[key] || 0);
		const total = counts.reduce((a, b) => a + b, 0);
		const filledWidth = Math.round((total / maxFollowers) * barWidth);

		const widths = distributeWidths(counts, filledWidth);

		const labels = platforms.map((key, i) => {
			const value = widths[i] > 0 ? String(counts[i]).padEnd(widths[i]) : '';
			return `${platformColors[key]}${value}${reset}`;
		}).join('');

		const labelPad = ''.padEnd(dateLabelWidth);
		console.log(`${labelPad} ${labels}`);
	}

	console.log();
}

main().catch(console.error);
