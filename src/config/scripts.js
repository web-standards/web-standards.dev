import * as esbuild from 'esbuild';
import browserslistToEsbuild from 'browserslist-to-esbuild';
import { minify as minifyTemplates } from 'esbuild-minify-templates';

export default (config, { browserslist }) => {
	config.addTemplateFormats('js');

	config.addExtension('js', {
		outputFileExtension: 'js',
		compile: async (content, path) => {
			if (path !== './src/scripts/index.js') {
				return;
			}

			return async () => {
				let { outputFiles } = await esbuild.build({
					target: browserslistToEsbuild(browserslist),
					entryPoints: [path],
					bundle: true,
					external: ['/pagefind/pagefind.js'],
					write: false,
				});

				let code = minifyTemplates(outputFiles[0].text).toString();

				let { code: minified } = await esbuild.transform(code, {
					target: browserslistToEsbuild(browserslist),
					minify: true,
				});

				return minified;
			};
		},
	});
};
