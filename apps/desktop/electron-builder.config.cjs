/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.vrnrn.vorchestra',
  productName: 'Vorchestra',
  artifactName: '${productName}-${version}-mac-${arch}.${ext}',
  asar: true,
  forceCodeSigning: false,
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'out/**/*',
    'package.json',
    '!node_modules/@vorchestra/*/src{,/**/*}',
    '!node_modules/@vorchestra/*/test{,/**/*}',
    '!node_modules/@vorchestra/*/dist/test{,/**/*}',
    '!node_modules/@vorchestra/**/*.map',
    '!node_modules/@vorchestra/*/tsconfig.json',
    '!node_modules/@types{,/**/*}',
    '!node_modules/**/*.map',
    '!out/**/*.map',
  ],
  mac: {
    icon: 'build/icon.icns',
    category: 'public.app-category.developer-tools',
    minimumSystemVersion: '12.0',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    target: ['dmg', 'zip'],
  },
  dmg: {
    title: '${productName} ${version}',
    contents: [
      { x: 140, y: 190, type: 'file' },
      { x: 400, y: 190, type: 'link', path: '/Applications' },
    ],
  },
};
