import * as esbuild from 'esbuild';

export default (config) => {
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
};
