import { load as yamlLoad } from 'js-yaml';
import pluginRss from '@11ty/eleventy-plugin-rss';
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

	// Dynamic year and month collections for pagination
	config.addCollection('newsByYear', (collectionApi) => {
		const news = collectionApi.getFilteredByGlob(collections.news)
			.filter((item) => item.data.permalink !== false);

		const byYear = {};

		news.forEach((item) => {
			const year = item.date.getFullYear();
			if (!byYear[year]) {
				byYear[year] = [];
			}
			byYear[year].push(item);
		});

		const ITEMS_PER_PAGE = 12;
		const result = [];

		// Convert to array of objects with pagination
		Object.entries(byYear).forEach(([year, items]) => {
			const reversedItems = items.reverse();
			const totalPages = Math.ceil(reversedItems.length / ITEMS_PER_PAGE);

			for (let page = 0; page < totalPages; page++) {
				const startIndex = page * ITEMS_PER_PAGE;
				const endIndex = startIndex + ITEMS_PER_PAGE;
				const pageItems = reversedItems.slice(startIndex, endIndex);

				result.push({
					year: year,
					pageNumber: page,
					totalPages: totalPages,
					items: pageItems,
					allItems: reversedItems
				});
			}
		});

		return result;
	});

	config.addCollection('newsByYearMonth', (collectionApi) => {
		const news = collectionApi.getFilteredByGlob(collections.news)
			.filter((item) => item.data.permalink !== false);

		const byYearMonth = {};

		news.forEach((item) => {
			const year = item.date.getFullYear();
			const month = String(item.date.getMonth() + 1).padStart(2, '0');
			const key = `${year}/${month}`;

			if (!byYearMonth[key]) {
				byYearMonth[key] = {
					year: year,
					month: month,
					items: []
				};
			}
			byYearMonth[key].items.push(item);
		});

		const ITEMS_PER_PAGE = 12;
		const result = [];

		// Convert to array with pagination
		Object.entries(byYearMonth).forEach(([key, data]) => {
			const reversedItems = data.items.reverse();
			const totalPages = Math.ceil(reversedItems.length / ITEMS_PER_PAGE);

			for (let page = 0; page < totalPages; page++) {
				const startIndex = page * ITEMS_PER_PAGE;
				const endIndex = startIndex + ITEMS_PER_PAGE;
				const pageItems = reversedItems.slice(startIndex, endIndex);

				result.push({
					year: data.year,
					month: data.month,
					pageNumber: page,
					totalPages: totalPages,
					items: pageItems,
					allItems: reversedItems
				});
			}
		});

		return result;
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

	config.addFilter('monthName', (monthNumber) => {
		const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
		return monthNames[parseInt(monthNumber) - 1] || monthNumber;
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
