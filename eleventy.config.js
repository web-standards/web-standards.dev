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
