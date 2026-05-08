import { minify } from 'html-minifier-next';

export default (config) => {
	config.addTransform('html-minify', async function (content) {
		if (this.page.outputPath && this.page.outputPath.endsWith('.html')) {
			return await minify(content, {
				collapseWhitespace: true,
				removeComments: true,
			});
		}

		return content;
	});
};
