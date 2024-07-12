import {defineConfig} from 'wxt';
import react from '@vitejs/plugin-react';

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: () => ({
    plugins: [react()],
  }),
  manifest: {
    name: 'Cookie Audit',
    description: 'Investigate cookie compliance on websites.',
    version: '2024.7.12',
    default_locale: 'en',
    permissions: [
      'cookies',
      'activeTab',
      'tabs',
      'storage',
      'unlimitedStorage',
      'scripting',
      'webNavigation',
      '<all_urls>',
      'tts'],
    host_permissions: ['<all_urls>'],
    browser_specific_settings: {
      gecko: {
        id: 'cookieaudit@szymonnastaly.com',
      },
    },
    web_accessible_resources: [
      {
        matches: ['<all_urls>'],
        resources: [
          'ext_data/*',
          'cookieManagement.js',
          'inspectBtnAndSettings.js',
          'noticeInteractor.js',
          'noticeStillOpen.js',
          'pageInteractor.js',
          'reportCreator.js',
          'retrieveDataFromNotice.js',
          'checkForcedAction.js',
          'checkInterfaceInterference.js',
        ],
      },
    ],
    content_security_policy: {
      extension_pages: 'script-src \'self\' \'wasm-unsafe-eval\'; object-src \'self\';',
    },
    icons: {
      '16': 'icon/icon16.png',
      '32': 'icon/icon32.png',
      '64': 'icon/icon64.png',
      '128': 'icon/icon128.png',
    },
  },
});
