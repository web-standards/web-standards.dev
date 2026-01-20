import Image from '@11ty/eleventy-img';
import { glob } from 'node:fs/promises';
import os from 'node:os';

const imagesCache = '.cache/@11ty/_images';

export { imagesCache };

export default (config) => {
	Image.concurrency = os.availableParallelism?.() ?? os.cpus().length;

	config.on('eleventy.before', async () => {
		const avifFiles = await Array.fromAsync(
			glob('src/news/**/**/cover.avif')
		);

		await Promise.all(
			avifFiles.map(async (avifPath) => {
				const relativePath = avifPath
					.replace('src/', '')
					.replace('/cover.avif', '');

				await Image(avifPath, {
					widths: [1920],
					formats: ['jpeg'],
					outputDir: `${imagesCache}/${relativePath}`,
					urlPath: `/${relativePath}/`,
					filenameFormat: () => 'cover.jpeg',
					sharpJpegOptions: {
						quality: 80,
					},
				});

				await Image(avifPath, {
					widths: [320, 480, 640, 960, 1280],
					formats: ['avif', 'jpeg'],
					outputDir: `${imagesCache}/${relativePath}`,
					urlPath: `/${relativePath}/`,
					filenameFormat: (id, src, width, format) => {
						return `cover-${width}.${format}`;
					},
					sharpAvifOptions: {
						quality: 50,
						effort: 6,
					},
					sharpJpegOptions: {
						quality: 80,
					},
				});
			})
		);
	});
};
