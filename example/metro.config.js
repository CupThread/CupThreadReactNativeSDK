const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '..')];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@cupthread/react-native') {
    return {
      filePath: path.resolve(__dirname, '../src/index.ts'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
