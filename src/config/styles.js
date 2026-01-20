import { bundle as lightningcssBundle, browserslistToTargets, Features } from 'lightningcss';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const inlineSvg = (urlPath, baseDir) => {
	if (/^(https?:)?\/\//.test(urlPath)) {
		return null;
	}

	const relativePath = urlPath.replace(/^(\.\.\/)+/, '');
	const svgPath = path.resolve(baseDir, relativePath);

	try {
		const svg = readFileSync(svgPath, 'utf8');
		const encoded = encodeURIComponent(svg)
			.replace(/'/g, '%27')
			.replace(/"/g, '%22');

		return `data:image/svg+xml,${encoded}`;
	} catch {
		return null;
	}
};

export default (config, { browserslist }) => {
	const processStyles = async (filePath) => {
		const absolutePath = path.resolve(filePath);
		const srcDir = path.resolve('src');

		return lightningcssBundle({
			filename: absolutePath,
			minify: true,
			sourceMap: false,
			targets: browserslistToTargets(browserslist),
			include: Features.MediaQueries | Features.Nesting | Features.LightDark,
			visitor: {
				Url(url) {
					if (url.url.endsWith('.svg')) {
						const inlined = inlineSvg(url.url, srcDir);
						if (inlined) {
							return { ...url, url: inlined };
						}
					}
					return url;
				},
			},
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
};
