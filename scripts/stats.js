import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const statsFile = join(__dirname, '..', 'src', 'data', 'stats.yml');

// ANSI colors
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const black = '\x1b[90m'; // X
const violet = '\x1b[35m'; // Mastodon
const blue = '\x1b[34m'; // Bluesky

const dateFormat = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	timeZone: 'UTC',
});

const platforms = ['x', 'mastodon', 'bluesky'];
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

function loadHistory() {
	if (!existsSync(statsFile)) return [];
	const data = yamlLoad(readFileSync(statsFile, 'utf-8'));
	const history = Array.isArray(data) ? data : [];
	// js-yaml parses unquoted YYYY-MM-DD as a Date, so normalize back to strings.
	for (const entry of history) {
		if (entry?.date instanceof Date) {
			entry.date = entry.date.toISOString().split('T')[0];
		}
	}
	return history;
}

function main() {
	const showAll = process.argv[2] === 'all';
	let stats = loadHistory().sort((a, b) => a.date.localeCompare(b.date));

	// Backfill nulls from the nearest previous entry
	for (let i = 1; i < stats.length; i++) {
		for (const key of platforms) {
			if (stats[i][key] == null && stats[i - 1][key] != null) {
				stats[i][key] = stats[i - 1][key];
			}
		}
	}

	if (stats.length === 0) {
		console.log('No data yet. Run `npm run social` to collect follower counts.\n');
		return;
	}

	// Filter to last two weeks unless "all" is passed
	if (!showAll) {
		const twoWeeksAgo = new Date();
		twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
		const cutoff = twoWeeksAgo.toISOString().split('T')[0];
		stats = stats.filter((s) => s.date >= cutoff);
	}

	const maxFollowers = Math.max(
		...stats.map((s) => platforms.reduce((sum, key) => sum + (s[key] || 0), 0)),
		1
	);
	const barWidth = 40;
	const dateLabelWidth = 6;

	console.log('Social media followers\n');

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

	// Show latest numbers below the bars
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

main();
