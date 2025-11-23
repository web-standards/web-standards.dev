#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createNewPost(dateInput, slug) {
	const datePattern = /^(\d{4})\.(\d{2})\.(\d{2})$/;
	const match = dateInput.match(datePattern);

	if (!match) {
		console.error('Error: Invalid date format. Expected format: YYYY.MM.DD (e.g., 2025.11.07)');
		process.exit(1);
	}

	const [, year, month, day] = match;
	const formattedDate = `${year}-${month}-${day}`;

	const folderName = slug || 'slug';

	const projectRoot = path.resolve(__dirname, '..');
	const templateDir = path.join(projectRoot, 'src', 'news', 'template');
	const targetDir = path.join(projectRoot, 'src', 'news', year, month, folderName);

	try {
		await fs.access(templateDir);
	} catch {
		console.error(`Error: Template directory not found at ${templateDir}`);
		process.exit(1);
	}

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

	await fs.mkdir(targetDir, { recursive: true });

	const files = await fs.readdir(templateDir);

	for (const file of files) {
		const sourcePath = path.join(templateDir, file);
		const targetPath = path.join(targetDir, file);

		const stat = await fs.stat(sourcePath);

		if (stat.isFile()) {
			let content = await fs.readFile(sourcePath, 'utf8');

			if (file === 'index.yml') {
				content = content.replace(/date:\s*\d{4}-\d{2}-\d{2}/, `date: ${formattedDate}`);
			}

			await fs.writeFile(targetPath, content, 'utf8');
		}
	}

	console.log(`✓ Created new files:\n\nsrc/news/${year}/${month}/${folderName}/index.yml\nsrc/news/${year}/${month}/${folderName}/index.md`);
}

const dateArg = process.argv[2];
const slugArg = process.argv[3];

if (!dateArg) {
	console.error('Error: Please provide a date in format YYYY.MM.DD');
	console.error('Usage: npm run new YYYY.MM.DD [slug]');
	process.exit(1);
}

createNewPost(dateArg, slugArg).catch(error => {
	console.error('Error:', error.message);
	process.exit(1);
});
