#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function findScheduledNews(slug) {
	const projectRoot = path.resolve(__dirname, '..');
	const newsDir = path.join(projectRoot, 'src', 'news');

	async function searchDirectory(dir) {
		const entries = await fs.readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				if (entry.name === slug) {
					const ymlPath = path.join(fullPath, 'index.yml');
					try {
						const content = await fs.readFile(ymlPath, 'utf8');
						if (content.includes('permalink: false')) {
							return fullPath;
						}
					} catch {
						// Continue searching if file doesn't exist or can't be read
					}
				} else {
					const result = await searchDirectory(fullPath);
					if (result) return result;
				}
			}
		}

		return null;
	}

	return await searchDirectory(newsDir);
}

async function moveNews(dateInput, slug) {
	const datePattern = /^(\d{4})\.(\d{2})\.(\d{2})$/;
	const match = dateInput.match(datePattern);

	if (!match) {
		console.error('Error: Invalid date format. Expected format: YYYY.MM.DD (e.g., 2025.11.07)');
		process.exit(1);
	}

	const [, year, month, day] = match;
	const formattedDate = `${year}-${month}-${day}`;

	const projectRoot = path.resolve(__dirname, '..');

	// Find the scheduled news
	const sourcePath = await findScheduledNews(slug);

	if (!sourcePath) {
		console.error(`Error: No scheduled news found with slug "${slug}"`);
		process.exit(1);
	}

	// Prepare target path
	const targetDir = path.join(projectRoot, 'src', 'news', year, month, slug);

	// Check if target already exists
	try {
		await fs.access(targetDir);
		console.error(`Error: Directory already exists at ${targetDir}`);
		process.exit(1);
	} catch (error) {
		if (error.code && error.code !== 'ENOENT') {
			console.error(`Error accessing target directory: ${error.message}`);
			process.exit(1);
		}
	}

	// Create target directory
	await fs.mkdir(targetDir, { recursive: true });

	// Move files and update date
	const files = await fs.readdir(sourcePath);

	for (const file of files) {
		const sourceFile = path.join(sourcePath, file);
		const targetFile = path.join(targetDir, file);

		const stat = await fs.stat(sourceFile);

		if (stat.isFile()) {
			let content = await fs.readFile(sourceFile, 'utf8');

			if (file === 'index.yml') {
				content = content.replace(/date:\s*\d{4}-\d{2}-\d{2}/, `date: ${formattedDate}`);
			}

			await fs.writeFile(targetFile, content, 'utf8');
		}
	}

	// Remove old directory
	await fs.rm(sourcePath, { recursive: true });

	// Get relative paths for display
	const oldPath = path.relative(projectRoot, sourcePath);
	const newPath = path.relative(projectRoot, targetDir);

	console.log(`✓ Moved news from:\n  ${oldPath}\n\n  to:\n  ${newPath}\n\n  with date: ${formattedDate}`);
}

const dateArg = process.argv[2];
const slugArg = process.argv[3];

if (!dateArg || !slugArg) {
	console.error('Error: Please provide both date and slug');
	console.error('Usage: npm run move YYYY.MM.DD news-url-slug');
	process.exit(1);
}

moveNews(dateArg, slugArg).catch(error => {
	console.error('Error:', error.message);
	process.exit(1);
});
