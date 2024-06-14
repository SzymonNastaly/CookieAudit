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
    version_name: '2024.06.14',
    default_locale: 'en',
    permissions: [
      'cookies',
      'activeTab',
      'storage',
      'unlimitedStorage',
      'tabs',
      'scripting',
      'webNavigation'],
    host_permissions: ['<all_urls>'],
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
  },
});
