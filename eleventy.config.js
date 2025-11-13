import { load as yamlLoad } from 'js-yaml';
import rss from '@11ty/eleventy-plugin-rss';
import { bundle as lightningcssBundle, browserslistToTargets, Features } from 'lightningcss';
import Image from '@11ty/eleventy-img';
import { glob } from 'glob';

import packageJson from './package.json' with { type: 'json' };

export default (config) => {

	// Collections

	const collections = {
		news: 'src/news/????/??/*/index.md',
	};

	config.addCollection('news', (collectionApi) => {
		return collectionApi.getFilteredByGlob(collections.news)
			.filter((item) => item.data.permalink !== false)
			.map((item) => {
				item.data.layout = 'news.njk';
				return item;
			})
			.reverse();
	});

	// CSS

	const processStyles = async (path) => {
		return await lightningcssBundle({
			filename: path,
			minify: true,
			sourceMap: false,
			targets: browserslistToTargets(packageJson.browserslist),
			include: Features.MediaQueries | Features.Nesting | Features.LightDark,
		});
	};

	config.addTemplateFormats('css');

	config.addExtension('css', {
		outputFileExtension: 'css',
		compile: async (content, path) => {
			if (path !== './src/styles/index.css') {
				return;
			}

			return async () => {
				let { code } = await processStyles(path);

				return code;
			};
		},
	});

	config.addFilter('css', async (path) => {
		let { code } = await processStyles(path);

		return code;
	});

	// Covers

	config.on('eleventy.before', async () => {
		const avifFiles = await glob('src/news/**/**/cover.avif');

		const cacheOptions = {
			duration: '1d',
			directory: '.cache',
			removeUrlQueryParams: false,
		};

		await Promise.all(
			avifFiles.map(async (avifPath) => {
				const outputDir = avifPath
					.replace('src/', 'dist/')
					.replace('/cover.avif', '');

				await Image(avifPath, {
					widths: [1920],
					formats: ['jpeg'],
					outputDir: outputDir,
					cacheOptions: cacheOptions,
					filenameFormat: () => 'cover.jpeg',
				});

				await Image(avifPath, {
					widths: [320, 480, 640, 960, 1280],
					formats: ['avif', 'jpeg'],
					outputDir: outputDir,
					cacheOptions: cacheOptions,
					filenameFormat: (id, src, width, format) => {
						return `cover-${width}.${format}`;
					},
				});
			})
		);
	});

	// Filters

	config.addFilter('limit', (array, limit) => {
		return array.slice(0, limit);
	});

	config.addFilter('relatedByTags', (collection, currentUrl, currentTags) => {
		return collection.filter((item) => {
			if (item.url === currentUrl) {
				return false;
			}
			return currentTags.some((tag) => item.data.tags?.includes(tag));
		});
	});

	config.addFilter('stripURL', (url) => {
		return url
			.replace(/^https?:\/\//, '')
			.replace(/^www\./, '')
			.replace(/\/$/, '');
	});

	// YAML

	config.addDataExtension('yml', (contents) => {
		return yamlLoad(contents);
	});

	// Dates

	config.addFilter('dateLong', (value) => {
		return value.toLocaleString('en', {
			dateStyle: 'long',
		});
	});

	config.addFilter('dateShort', (value) => {
		const articleYear = value.getFullYear();
		const currentYear = new Date().getFullYear();
		const dateFormat = articleYear < currentYear
			? {
				dateStyle: 'long',
			}
			: {
				month: 'long',
				day: 'numeric',
			};

		return value.toLocaleString('en', dateFormat);
	});

	config.addFilter('dateISO', (value) => {
		return value.toISOString().split('T')[0];
	});

	// Passthrough copy

	[
		'src/apple-touch-icon.png',
		'src/favicon.ico',
		'src/fonts',
		'src/images',
		'src/news/**/*.!(md|yml)',
	].forEach((path) => config.addPassthroughCopy(path));

	// Plugins

	config.addPlugin(rss);

	// Config

	return {
		dir: {
			input: 'src',
			output: 'dist',
			includes: 'includes',
			layouts: 'layouts',
			data: 'data',
		},
		dataTemplateEngine: 'njk',
		markdownTemplateEngine: 'njk',
		htmlTemplateEngine: 'njk',
		templateFormats: ['md', 'njk'],
	};
};
