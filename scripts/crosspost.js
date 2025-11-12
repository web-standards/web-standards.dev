#!/usr/bin/env node
/**
 * @fileoverview Cross-post a news item to Mastodon
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

// Mastodon character limits
const MASTODON_CHAR_LIMIT = 500; // Default limit (many instances use 1000+)
const MASTODON_URL_LENGTH = 23; // URLs are counted as 23 characters

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
			console.warn(`⚠️ Warning: Could not convert image: ${error.message}`);
		}
	}

	return result;
}

/**
 * Calculate the character count for Mastodon
 * URLs are counted as 23 characters regardless of actual length
 * @param {string} message - The message to count
 * @returns {number} Character count
 */
function calculateMastodonLength(message) {
	// Replace URLs with placeholder of 23 characters
	const withPlaceholders = message.replace(/https?:\/\/[^\s]+/g, 'x'.repeat(MASTODON_URL_LENGTH));
	return withPlaceholders.length;
}

/**
 * Validate message length for Mastodon
 * @param {string} message - The message to validate
 * @param {number} limit - Character limit (default: 500)
 * @returns {{ valid: boolean, length: number, limit: number }}
 */
function validateMessageLength(message, limit = MASTODON_CHAR_LIMIT) {
	const length = calculateMastodonLength(message);
	return {
		valid: length <= limit,
		length,
		limit,
	};
}

/**
 * Create a social media message from post data
 * @param {{ title: string, description: string, link: string, tags: string[] }} postData
 * @param {'mastodon'} platform
 * @returns {string}
 */
function createMessage(postData, platform) {
	const { title, description, link, tags } = postData;

	// Remove backticks from description
	const plainDescription = description.replace(/`/g, '');

	// Format hashtags
	const hashtags = tags
		.map(tag => `#${tag}`)
		.join(' ');

	// Build message parts: title. description #hashtags\n\nlink
	const hashtagsPart = hashtags ? ` ${hashtags}` : '';
	const linkPart = `\n\n${link}`;

	// Combine title and description
	const content = `${title}. ${plainDescription}`;

	// Build the final message: content + hashtags + link
	return `${content}${hashtagsPart}${linkPart}`;
}

/**
 * Log a message preview to the console
 * @param {string} platform - Platform name
 * @param {string} message - The message to log
 * @param {{ imageData?: Buffer, imageAlt?: string }} postData - Post data with optional image
 */
function logMessage(platform, message, postData) {
	console.log(`\n📝 ${platform.charAt(0).toUpperCase() + platform.slice(1)} message:\n`);
	console.log(message);

	// Validate message length for Mastodon
	if (platform === 'mastodon') {
		const validation = validateMessageLength(message);
		const statusEmoji = validation.valid ? '✅' : '❌';
		console.log(`\n${statusEmoji} Length: ${validation.length}/${validation.limit} characters`);

		if (!validation.valid) {
			const overBy = validation.length - validation.limit;
			console.log(`⚠️ Message is ${overBy} character${overBy > 1 ? 's' : ''} too long!`);
		}
	}

	if (postData.imageData) {
		const alt = postData.imageAlt || '';
		console.log(`📷 Image: cover.jpeg${alt ? `, Alt: ${alt}` : ''}`);
	}
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

		logMessage(platform, message, postData);

		// Validate message length for Mastodon
		if (platform === 'mastodon') {
			const validation = validateMessageLength(message);
			if (!validation.valid) {
				throw new Error(
					`Mastodon message exceeds character limit: ${validation.length}/${validation.limit} characters`
				);
			}
		}

		const entry = {
			message,
			strategyId: strategy.id,
		};

		// Add image if available
		if (postData.imageData) {
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
			// Handle both 'success' and 'ok' properties (library inconsistency)
			const isSuccess = result.success || result.ok;
			const strategyName = result.strategy || result.name;

			if (isSuccess) {
				console.log(`✅ ${strategyName}: Posted successfully`);
				if (result.url) {
					console.log(`   ${result.url}`);
				}
			} else {
				console.error(`❌ ${strategyName}: Failed`);
				if (result.error) {
					console.error(`   ${result.error.message || result.error}`);
				} else {
					console.error(`   Unknown error`);
				}
				// Log full error details for debugging
				console.error('   Full result:', JSON.stringify(result, null, 2));
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
			console.log('Dry run mode');
			const platforms = ['mastodon'];
			platforms.forEach(platform => {
				const message = createMessage(postData, platform);
				logMessage(platform, message, postData);
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
