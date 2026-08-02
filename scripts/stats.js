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

const monthFormat = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	timeZone: 'UTC',
});

const platforms = ['x', 'mastodon', 'bluesky'];
const platformColors = { x: black, mastodon: violet, bluesky: blue };

// Segment widths from cumulative boundaries on the global scale, so each
// segment only shifts when its own platform's count crosses a block
function segmentWidths(counts, maxFollowers, barWidth) {
	const boundaries = [0];
	let cumulative = 0;
	for (const count of counts) {
		cumulative += count;
		boundaries.push(Math.round((cumulative / maxFollowers) * barWidth));
	}
	return counts.map((_, i) => boundaries[i + 1] - boundaries[i]);
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

function parseDate(str) {
	return new Date(`${str}T00:00:00Z`);
}

// Compress daily entries into weekly/monthly buckets, keeping each period's
// last entry, labeled by its start, flagged partial if it hasn't ended yet
function bucketize(stats, mode) {
	const buckets = new Map();

	for (const entry of stats) {
		const date = parseDate(entry.date);
		let key, label, periodEnd;

		if (mode === 'week') {
			const monday = new Date(date);
			monday.setUTCDate(monday.getUTCDate() - ((date.getUTCDay() + 6) % 7));
			key = monday.toISOString().split('T')[0];
			label = dateFormat.format(monday);
			periodEnd = new Date(monday);
			periodEnd.setUTCDate(periodEnd.getUTCDate() + 6);
		} else {
			const year = date.getUTCFullYear();
			const month = date.getUTCMonth();
			key = `${year}-${month}`;
			label = monthFormat.format(date);
			periodEnd = new Date(Date.UTC(year, month + 1, 0));
		}

		buckets.set(key, { ...entry, label, partial: date < periodEnd });
	}

	return [...buckets.values()];
}

function main() {
	const mode = process.argv[2];
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

	// Filter to last two weeks unless a wider view is requested
	if (!mode) {
		const twoWeeksAgo = new Date();
		twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
		const cutoff = twoWeeksAgo.toISOString().split('T')[0];
		stats = stats.filter((s) => s.date >= cutoff);
	}

	// One row per day, or compressed into weeks/months
	let rows;
	if (mode === 'week' || mode === 'month') {
		rows = bucketize(stats, mode);
	} else {
		rows = stats.map((day) => ({
			...day,
			label: dateFormat.format(parseDate(day.date)),
			partial: false,
		}));
	}

	const maxFollowers = Math.max(
		...rows.map((r) => platforms.reduce((sum, key) => sum + (r[key] || 0), 0)),
		1
	);
	const barWidth = 40;
	const dateLabelWidth = 6;

	console.log('Social media followers\n');

	console.log(`${dim}Legend${reset} ${black}█${reset} X  ${violet}█${reset} Mastodon  ${blue}█${reset} Bluesky\n`);

	let anyPartial = false;
	for (const row of rows) {
		const label = `${dim}${row.label}${reset}`.padEnd(dateLabelWidth + dim.length + reset.length);

		const counts = platforms.map((key) => row[key] || 0);
		const total = counts.reduce((a, b) => a + b, 0);

		const widths = segmentWidths(counts, maxFollowers, barWidth);
		const filledWidth = widths.reduce((a, b) => a + b, 0);
		const emptyWidth = barWidth - filledWidth;

		const bar = platforms.map((key, i) =>
			`${platformColors[key]}${'█'.repeat(widths[i])}${reset}`
		).join('') + `${dim}${'░'.repeat(emptyWidth)}${reset}`;

		const marker = row.partial ? `${dim} *${reset}` : '';
		if (row.partial) anyPartial = true;

		console.log(`${label} ${bar} ${total}${marker}`);
	}

	// Show latest numbers below the bars
	const latest = rows[rows.length - 1];
	if (latest && platforms.some((key) => latest[key])) {
		const counts = platforms.map((key) => latest[key] || 0);

		const widths = segmentWidths(counts, maxFollowers, barWidth);

		const labels = platforms.map((key, i) => {
			const value = widths[i] > 0 ? String(counts[i]).padEnd(widths[i]) : '';
			return `${platformColors[key]}${value}${reset}`;
		}).join('');

		const labelPad = ''.padEnd(dateLabelWidth);
		console.log(`${labelPad} ${labels}`);
	}

	if (anyPartial) {
		const period = mode === 'week' ? 'week' : 'month';
		console.log(`\n${dim}* ${period} in progress${reset}`);
	}

	console.log();
}

main();
