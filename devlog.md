# Devlog
## May 8, 2024 6:15 PM
Remove the “storing” and “retrieving” of the transformer models (which are functions) to and from the [browser.storage](http://browser.storage) - because that doesn’t work for functions. Either way the models are somehow cached (or similar), because we (seemingly) don’t download them for every sentence seperately.

## May 8, 2024 2:52 PM
The BERT models are now finally working in the Cookie Audit 2 extension. The issue was that the permission to run `wasm` was not set inside the `manifest.json`. It took many hours (of trying other things) to find this out.
The classification of the purpose-detection-model returns logits of which we take the one with the biggest value. (index 0 means functional, index 1 means analytics/advertising). Then we sum up how many sentences describe analytics/advertising in the notice.

## May 7, 2024 5:27 PM
Added separate message: when content script has a confirmed cookie notice selector, it sends a message ___ to the extension service worker. The extension service worker then continues with the scan.
Splitting text to sentences is now done with an npm package called `sentence-splitter`. This is unfortunately necessary, as spacy does not run in javascript (at least it seems so).

## May 7, 2024 12:42 PM
Created first version of diagram to visualize the messaging that is going on between the components (namely the extension service worker, the popup and the content script).
Added reset (setting to empty objects) of the storage (`cookies`, `selection`, `scan` ) in the beginning of a new scan.
Learning: no usage of global variables (to store state) inside the background script, instead need to use `local storage` .