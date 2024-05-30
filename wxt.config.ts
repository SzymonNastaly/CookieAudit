import {defineConfig} from 'wxt';
import react from '@vitejs/plugin-react';


// See https://wxt.dev/api/config.html
export default defineConfig({
    vite: () => ({
        plugins: [react()]
    }),
    manifest: {
        permissions: ["cookies", "activeTab", "storage", "unlimitedStorage", "tabs", "scripting", "webNavigation"],
        web_accessible_resources: [
            {
                matches: ["<all_urls>"],
                resources: ['ext_data/*', 'noticeInteractor.js', 'noticeInteractor2.js', 'reportCreator.js'],
            }
        ],
        content_security_policy: {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
            sandbox: "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; child-src 'self';"
        },
    },
});
