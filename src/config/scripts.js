import * as esbuild from 'esbuild';
import browserslistToEsbuild from 'browserslist-to-esbuild';

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
					minify: true,
					bundle: true,
					external: ['/pagefind/pagefind.js'],
					write: false,
				});

				return outputFiles[0].text;
			};
		},
	});
};
