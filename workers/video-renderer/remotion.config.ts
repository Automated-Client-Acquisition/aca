import { Config } from '@remotion/cli/config';

Config.overrideWebpackConfig((config) => {
  return {
    ...config,
    resolve: {
      ...config.resolve,
      extensionAlias: {
        '.js': ['.tsx', '.ts', '.jsx', '.js'],
      },
    },
  };
});
