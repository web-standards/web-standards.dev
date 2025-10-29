import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { load as yamlLoad } from 'js-yaml';
import rss from '@11ty/eleventy-plugin-rss';

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

	// Filters

	config.addFilter('limit', (array, limit) => {
		return array.slice(0, limit);
	});

	// YAML

	config.addDataExtension('yml', (contents) => {
		return yamlLoad(contents);
	});

	// Dates

	config.addFilter('lastModified', (filePath) => {
		try {
			const lastModified = execSync(`git log -1 --format=%cd --date=iso ${filePath}`).toString().trim();
			return new Date(lastModified);
		} catch (error) {
			console.error(error);
			const stats = fs.statSync(filePath);
			return stats.mtime;
		}
	});

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
