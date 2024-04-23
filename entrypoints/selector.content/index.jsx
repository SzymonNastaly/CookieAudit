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
    matches: ['*://*/*'],

    async main(ctx) {
        const ui = await createIntegratedUi(ctx, {
            name: 'selector-ui',
            position: 'inline',
            anchor: 'body',
            onMount: (container) => {
                // Container is a body, and React warns when creating a root on the body, so create a wrapper div
                const app = document.createElement('div');
                container.append(app);

                // Create a root on the UI container and render a component
                const root = ReactDOM.createRoot(app);
                root.render(<App />);
                return root;
            },
            onRemove: (root) => {
                // Unmount the root when the UI is removed
                root?.unmount();
            },
        });

        ui.mount();

        // storage.getItems(["local:selectorAutoEnable", "local:selectorShowPreview"]).then((e) => {
        //     e[0] && DomSelector.autoSelect()
        // });
        /*browser.runtime.onMessage.addListener((e, t, o) => {
            o({status: "ok"}), storage.getItem("local:selectorShowPreview").then((selectorShowPreview) => {
                // if selectorShowPreview is true, this results in the data (dom-selector-data) dialog remaining after an element has been selected
                selectorShowPreview = true;
                DomSelector(selectorShowPreview).then(e => {
                    console.log(e)
                });
            });
        });*/
    },
});
