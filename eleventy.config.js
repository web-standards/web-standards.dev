import { readFileSync } from 'node:fs';

import { load as yamlLoad } from 'js-yaml';
import pluginRss from '@11ty/eleventy-plugin-rss';
import browserslist from 'browserslist';

import collections from './src/config/collections.js';
import filters from './src/config/filters.js';
import styles from './src/config/styles.js';
import scripts from './src/config/scripts.js';
import images from './src/config/images.js';
import search from './src/config/search.js';

const browserslistConfig = readFileSync('./.browserslistrc', 'utf8')
	.split('\n')
	.filter((line) => line !== '' || line.startsWith('#'))
	.join(',');

export default (config) => {
	const isDev = process.env.ELEVENTY_RUN_MODE === 'serve';

	// Shared options
	const options = {
		newsGlob: 'src/news/????/??/*/index.md',
		pageSize: 12,
		browserslist: browserslist(browserslistConfig),
	};

	// Modules
	collections(config, options);
	filters(config);
	styles(config, options);
	scripts(config);
	images(config);
	search(config);

	// Global data
	config.addGlobalData('isDev', isDev);

	// YAML
	config.addDataExtension('yml', (contents) => {
		return yamlLoad(contents);
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
