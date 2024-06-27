import ReactDOM from 'react-dom/client';
import App from './App.jsx';

export default defineContentScript({
  matches: ['<all_urls>'],

  async main(ctx) {
    const ui = createIntegratedUi(ctx, {
      name: 'notifications-ui', position: 'inline', onMount: (container) => {
        // Container is a body, and React warns when creating a root on the body, so create a wrapper div
        const app = document.createElement('div');
        container.append(app);

        // Create a root on the UI container and render a component
        const root = ReactDOM.createRoot(app);
        root.render(<App/>);
        return root;
      }, onRemove: (root) => {
        // Unmount the root when the UI is removed
        root?.unmount();
      },
    });
    if (!ui.mounted) {
      ui.mount();
    }
  },
});
