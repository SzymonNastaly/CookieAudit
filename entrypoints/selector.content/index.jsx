/*
    Package: Dom-Selector
    Version: 2.0.0 [Minified]
    Author: Shivam Dewangan https://github.com/shivamdevs
    Repository: https://github.com/shivamdevs/dom-selector
    License: MIT License
*/
//import {fetchEasylist} from '../content/banner.js';
import './style.css';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

export default defineContentScript({
  matches: ['<all_urls>'], allFrames: true,

  async main(ctx) {
    browser.runtime.onMessage.addListener(handleMountMessage);
    const ui = createIntegratedUi(ctx, {
      name: 'selector-ui',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => {
        // Container is a body, and React warns when creating a root on the body, so create a wrapper div
        const app = document.createElement('div');
        container.append(app);

        // Create a root on the UI container and render a component
        const root = ReactDOM.createRoot(app);
        root.render(<App/>);
        return root;
      },
      onRemove: (root) => {
        // Unmount the root when the UI is removed
        root?.unmount();
      },
    });

    function handleMountMessage(message, sender, sendResponse) {
      const {msg} = message;
      if (msg === 'mount_select') {
        if (!ui.mounted) {
          ui.mount();
        }
        sendResponse({msg: 'ok'});
      }
    }
  },
});
