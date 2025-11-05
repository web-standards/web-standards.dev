#!/usr/bin/env node
/**
 * @fileoverview Cross-post a news item to Mastodon, Bluesky, and X (Twitter)
 * @description Reads post data from the news directory and posts to social media
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import sharp from 'sharp';
import {
	Client,
	MastodonStrategy,
} from '@humanwhocodes/crosspost';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Load post data from a news directory
 * @param {string} postPath - Path to the post directory (e.g., 'src/news/2025/11/harmonizer-color-palette-generator')
 * @returns {Promise<{ title: string, description: string, link: string, tags: string[], imageData?: Buffer, imageAlt?: string }>}
 */
async function loadPostData(postPath) {
	const fullPath = path.resolve(PROJECT_ROOT, postPath);
	const yamlPath = path.join(fullPath, 'index.yml');
	const mdPath = path.join(fullPath, 'index.md');

	if (!fs.existsSync(yamlPath)) {
		throw new Error(`YAML file not found: ${yamlPath}`);
	}

	if (!fs.existsSync(mdPath)) {
		throw new Error(`Markdown file not found: ${mdPath}`);
	}

	const yamlContent = fs.readFileSync(yamlPath, 'utf8');
	const mdContent = fs.readFileSync(mdPath, 'utf8').trim();

	const metadata = yaml.load(yamlContent);

	const result = {
		title: metadata.title,
		description: mdContent,
		link: metadata.link,
		tags: metadata.tags || [],
	};

	// Try to load and convert cover image
	const coverPath = path.join(fullPath, 'cover.avif');
	if (fs.existsSync(coverPath)) {
		try {
			// Convert AVIF to JPEG for better compatibility
			const jpegBuffer = await sharp(coverPath)
				.jpeg({ quality: 90 })
				.toBuffer();

			result.imageData = jpegBuffer;
			result.imageAlt = metadata.alt;
		} catch (error) {
			console.warn(`⚠️  Warning: Could not convert image: ${error.message}`);
		}
	}

	return result;
}

/**
 * Create a social media message from post data
 * @param {{ title: string, description: string, link: string, tags: string[] }} postData
 * @param {'mastodon'} platform
 * @returns {string}
 */
function createMessage(postData, platform) {
	const { title, description, link, tags } = postData;

	// Format hashtags
	const hashtags = tags
		.map(tag => `#${tag}`)
		.join(' ');

	// Build message parts: title. description #hashtags\n\nlink
	const hashtagsPart = hashtags ? ` ${hashtags}` : '';
	const linkPart = `\n\n${link}`;

	// Combine title and description
	const content = `${title}. ${description}`;

	// Build the final message: content + hashtags + link
	return `${content}${hashtagsPart}${linkPart}`;
}

/**
 * Initialize strategies based on environment variables
 * @returns {{ strategies: Array, platforms: string[] }}
 */
function initializeStrategies() {
	const strategies = [];
	const platforms = [];

	// Mastodon
	if (process.env.MASTODON_ACCESS_TOKEN && process.env.MASTODON_HOST) {
		strategies.push(
			new MastodonStrategy({
				accessToken: process.env.MASTODON_ACCESS_TOKEN,
				host: process.env.MASTODON_HOST,
			})
		);
		platforms.push('mastodon');
	}

	if (strategies.length === 0) {
		throw new Error(
			'No Mastodon credentials found. Please set MASTODON_ACCESS_TOKEN and MASTODON_HOST environment variables.'
		);
	}

	return { strategies, platforms };
}

/**
 * Post to social media using custom messages per platform
 * @param {Array} strategies - Array of strategy instances
 * @param {string[]} platforms - Array of platform names
 * @param {{ title: string, description: string, link: string, tags: string[], imageData?: Buffer, imageAlt?: string }} postData
 */
async function postToSocial(strategies, platforms, postData) {
	const client = new Client({ strategies });

	// Create platform-specific messages
	const entries = strategies.map((strategy, index) => {
		const platform = platforms[index];
		const message = createMessage(postData, platform);

		console.log(`\n📝 ${platform.charAt(0).toUpperCase() + platform.slice(1)} message:`);
		console.log(message);

		const entry = {
			message,
			strategyId: strategy.id,
		};

		// Add image if available
		if (postData.imageData) {
			console.log(`   📷 Image: ${postData.imageAlt || 'cover.jpeg'} (converted from AVIF)`);
			entry.images = [{
				data: postData.imageData,
				alt: postData.imageAlt || '',
			}];
		}

		return entry;
	});

	console.log('\nPosting to social media…\n');

	try {
		const results = await client.postTo(entries);

		// Process results
		for (const result of results) {
			if (result.success) {
				console.log(`✅ ${result.strategy}: Posted successfully`);
				if (result.url) {
					console.log(`   ${result.url}`);
				}
			} else {
				console.error(`❌ ${result.strategy}: Failed`);
				console.error(`   ${result.error.message}`);
			}
		}
	} catch (error) {
		console.error('❌ Error posting to social media:', error.message);
		process.exit(1);
	}
}

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {{ newsSlug?: string, isDryRun: boolean, showHelp: boolean }}
 */
function parseArgs(args) {
	const parsed = {
		newsSlug: null,
		isDryRun: false,
		showHelp: false,
	};

	for (const arg of args) {
		if (arg === '--help' || arg === '-h') {
			parsed.showHelp = true;
		} else if (arg === '--dry-run') {
			parsed.isDryRun = true;
		} else if (!arg.startsWith('--')) {
			parsed.newsSlug = arg.replace(/^src\/news\//, '');
		}
	}

	return parsed;
}

/**
 * Main function
 */
async function main() {
	const args = process.argv.slice(2);
	const { newsSlug, isDryRun, showHelp } = parseArgs(args);

	if (showHelp || !newsSlug) {
		console.log(
`Usage: node scripts/crosspost.js <slug> [options]

Arguments:
	<slug>		News slug (e.g., 2025/11/harmonizer-color-palette-generator)

Options:
	--dry-run	Show what would be posted without actually posting
	--help, -h	Show this help message

Environment Variables:
	Mastodon:
	MASTODON_ACCESS_TOKEN
	MASTODON_HOST

Examples:
	npm run crosspost -- 3000/01/post-slug
	npm run crosspost -- 3000/01/post-slug --dry-run
	node scripts/crosspost.js 3000/01/post-slug
	node scripts/crosspost.js 3000/01/post-slug --dry-run

Note:
	Cover images (cover.avif) are automatically included and converted to JPEG for better compatibility.`
		);
		process.exit(newsSlug ? 0 : 1);
	}

	const postPath = `src/news/${newsSlug}`;

	try {
		const postData = await loadPostData(postPath);

		if (isDryRun) {
			console.log('Dry run mode\n');
			const platforms = ['mastodon'];
			platforms.forEach(platform => {
				const message = createMessage(postData, platform);
				console.log(message);
				console.log('');
			});
		} else {
			console.log('\nInitializing social media strategies…');
			const { strategies, platforms } = initializeStrategies();
			console.log(`   Platforms: ${platforms.join(', ')}`);
			await postToSocial(strategies, platforms, postData);
			console.log('\nAll done!');
		}
	} catch (error) {
		console.error(`\nError: ${error.message}`);
		process.exit(1);
	}
}

main();
