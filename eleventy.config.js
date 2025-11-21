import { load as yamlLoad } from 'js-yaml';
import pluginRss from '@11ty/eleventy-plugin-rss';
import { bundle as lightningcssBundle, browserslistToTargets, Features } from 'lightningcss';
import * as esbuild from 'esbuild';
import Image from '@11ty/eleventy-img';
import { glob } from 'glob';
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pagefind from 'pagefind';
import MarkdownIt from 'markdown-it';

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

	config.addCollection('sitemap', (collectionApi) => {
		const newsItems = collectionApi.getFilteredByGlob(collections.news)
			.filter((item) => item.data.permalink !== false);

		const mostRecentNewsDate = newsItems.length > 0
			? newsItems.reduce((latest, item) => item.date > latest ? item.date : latest, newsItems[0].date)
			: new Date();

		const homePage = [{
			url: '/',
			date: mostRecentNewsDate,
			priority: 1.0,
			changefreq: 'daily',
		}];

		const newsPages = newsItems
			.map((item) => ({
				url: item.url,
				date: item.date,
				priority: 0.8,
				changefreq: 'weekly',
			}))
			.sort((a, b) => b.date - a.date);

		const tagDates = new Map();
		collectionApi.getAll().forEach((item) => {
			if (item.data.tags && item.data.permalink !== false) {
				item.data.tags.forEach((tag) => {
					if (tag !== 'all' && tag !== 'news') {
						const currentDate = tagDates.get(tag);
						if (!currentDate || item.date > currentDate) {
							tagDates.set(tag, item.date);
						}
					}
				});
			}
		});

		const tagPages = Array.from(tagDates)
			.map(([tag, date]) => ({
				url: `/tags/${tag}/`,
				date: date,
				priority: 0.5,
				changefreq: 'weekly',
			}))
			.sort((a, b) => b.date - a.date);

		return [...homePage, ...newsPages, ...tagPages];
	});

	config.addFilter('relatedByTags', (collection, currentUrl, currentTags) => {
		return collection.filter((item) => {
			if (item.url === currentUrl) {
				return false;
			}
			return currentTags.some((tag) => item.data.tags?.includes(tag));
		});
	});

	// YAML

	config.addDataExtension('yml', (contents) => {
		return yamlLoad(contents);
	});

	// Markdown

	let markdownInline = new MarkdownIt({
		html: true,
	});

	config.amendLibrary('md', (mdLib) => {
		markdownInline = mdLib;
	});

	config.addFilter('markdownInline', (content) => {
		return markdownInline.renderInline(String(content ?? ''));
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

	// JavaScript

	config.addTemplateFormats('js');

	config.addExtension('js', {
		outputFileExtension: 'js',
		compile: async (content, path) => {
			if (path !== './src/scripts/index.js') {
				return;
			}

			return async () => {
				let { outputFiles } = await esbuild.build({
					target: 'es2020',
					entryPoints: [path],
					minify: true,
					bundle: true,
					external: ['/pagefind/pagefind.js'],
					write: false,
				});

				return outputFiles[0].text;
			};
		},
	});

	// Covers

	const imagesCache = '.cache/@11ty/_images';

	Image.concurrency = os.availableParallelism?.() ?? os.cpus().length;

	config.on('eleventy.before', async () => {
		const avifFiles = await glob('src/news/**/**/cover.avif');

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

	// Search

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

	// Strings

	config.addFilter('limit', (array, limit) => {
		return array.slice(0, limit);
	});

	config.addFilter('stripURL', (url) => {
		return url
			.replace(/^https?:\/\//, '')
			.replace(/^www\./, '')
			.replace(/\/$/, '');
	});

	// Passthrough copy

	[
		'src/apple-touch-icon.png',
		'src/favicon.ico',
		'src/fonts',
		'src/images',
		'src/news/**/*.!(md|yml)',
		'src/robots.txt',
	].forEach((path) => config.addPassthroughCopy(path));

	// Plugins

	config.addPlugin(pluginRss);

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
