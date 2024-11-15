import {defineConfig} from 'wxt';
import react from '@vitejs/plugin-react';

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: ({mode}) => ({
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode)
    }
  }),
  manifest: {
    name: 'Cookie Audit',
    description: 'Investigate cookie compliance on websites.',
    version: '2024.11.9',
    default_locale: 'en',
    permissions: [
      'cookies',
      'activeTab',
      'tabs',
      'storage',
      'unlimitedStorage',
      'scripting',
      'webNavigation',
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
