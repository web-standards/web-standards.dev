import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as pagefind from 'pagefind';

import { imagesCache } from './images.js';

export default (config) => {
	config.on('eleventy.after', async () => {
		cpSync(imagesCache, 'dist', { recursive: true });

		const { index } = await pagefind.createIndex();
		await index.addDirectory({ path: 'dist' });
		rmSync('dist/pagefind', { recursive: true, force: true });

		const { files } = await index.getFiles();
		const ignoredPaths = [
			'pagefind-ui',
			'pagefind-modular-ui',
			'translations/',
		];

		const filteredFiles = files.filter((file) => {
			return !ignoredPaths.some((pattern) => file.path.includes(pattern));
		});

		filteredFiles.forEach((file) => {
			const outputPath = path.join('dist/pagefind', file.path);
			mkdirSync(path.dirname(outputPath), { recursive: true });
			writeFileSync(outputPath, file.content);
		});
	});
};
