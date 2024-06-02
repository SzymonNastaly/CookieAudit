# Devlog

## June 2, 2024

### How to best call selector.content

- one could create a content script with `registration: "runtime"`
    - you can register it with `registerContentScripts`. It will only first run on the first reload (apparently).
    - you can execute it directly with `executeScript`.
      This works for "normal" scripts.
      But it currently doesn't work to start the selector.
      This is probably because the selector contains a UI.
      Such that the script returns after the UI creation -> on return it is removed again.
- I think I will just continue using it as is: sending and receiving messages between background.js and selector.content
    - Fortunately, I have found a slight improvement.
      The selector sends its response only when the selection has been made and the 'Confirm' button has been clicked.
      Like this, we remove the requirement for the additional `selected_notice` message vom selector to background.
      This makes the whole extension more sequential in understanding.

## June 1, 2024

- Do we maybe actually need a mutex for the _scan_ or _cookie_ accesses?
- Try out if really no bad cookies are set on rtl on notice ignorance?
- remove the tabs.query from the content scripts and think how to do the selector activation best, commit before trying
  those selector things out!
- problem: mantine changes background and other things of the webpage css.
  idea: shadowRootUi and do tabs.insertCss of the styles in background.js

## May 31, 2024

### Thoughts on Different Notice Selector for Second Level Notice

I think we should include the selector content script at runtime (see `registration` option in wxt.dev) and always
deregister when not necessary anymore.
This will make the flow even easier to understand.
Probably it should then be default-active (and not listen for a message to be activated).
I think we will also need to use the selector in the case that the notice of the second layer has a different
selector: for this case, we should include the detection heuristics from Bouhoula Crawler to decide if a notice may be
existent even if the notice with the first level selector is not visible/existing anymore.

### Adding of Second Level

We need to handle the second layer in many cookie notices, that means:

1. for every first-level button that could open a second layer (buttons that are classified as Settings or Other), click
   on it
   and explore if a second layer has been opened.
2. Collect the text and interactive Elements on the second layer and classify them.
   If they are relevant for interaction (i.e., Reject, Close, Save), add them to the array for `ieToInteract`

**DONE**: We have potential buttons that only switch around views and are misclassified.
Therefore, we later should when interacting with notice and page, always check if the clicked button made the notice
disappear—if not skip it entirely (and probably remove it from the interactive objects in the scan).

**TODO**: It is possible (for example, it happens on 20min.ch) that a new cookie notice (with different notice selector)
appears for the settings/second layer.
Some random thoughts and approaches:

- always ask user to select the second layer notice (even if it is possible that the selector stayed the same)
- if the first layer selector still exists and is visible, try to check if its content has changed: if it has changed
  use that selector, if it has not changed, ask the user
- if the first layer selector doesn't exist, ask the user
- is there any use in heuristics for the notice detection?: at least one would be to minimize the annoying the user...
  In that case (characterized by the secondLevelDiscovery not finding the notice with the selector), we should ask the
  user to _reselect_ the second layer.

**FAR FUTURE TODO**: it shouldn't be entirely impossible to also cover websites that open a new page when e.g. clicking
on the settings button inside the notice.

## May 29, 2024

### Fixing the cancel functionality on complex websites

Some websites (first found on [rtl.de](https://rtl.de)) store the cookie preference in localStorage. We now delete it in
clearCookies via
an executeScript call that calls `window.localStorage.clear()`.

### Activation of Selector, after selection

I noticed this on rtl.de. It appears that after some time the selector content script is made active again for some
reason. I think this is the case because of the multiple frames of the content script (if there are multiple iframes or
similar). A possible fix could be to check in the selector if there is already a selection set in the storage.

### Using less content scripts and moving towards browser.scripting.executeScript

Only now I have noticed the possibility of directly executing js from the background script. This greatly minimizes the
need for all the messaging that I have been doing (between the extension service worker=`background.js`) and the content
script that was responsible for the interaction with the page.
All functions, which are used inside the function that is executed via executeScript, need to be declared inside the
function. That is ugly and doesn't really make sense (as it would be nice to have a central definition of some commonly
used function), we will use the executeScript files functionality and provide scripts that were defined
via `defineUnlistedScript` (this is a wxt.dev functionality).
The return of values (also promises) from the UnlistedScript now seems to work correctly. But the functionality still
does not work completely. E.g., the cookie notice is still there after everything...

### Multi-Iframe environment

We need to attach the content scripts (both interactor and selector) into all the possible contexts: both the "real"
page and all iframes. (e.g. for the case when the cookie notice is (in) an iframe). This is done with `allFrames: true`.
(_not_ `all_frames`).

We need to coordinate the many instances of the content scripts.
We can (probably) uniquely identify instances between reloads with `iframeFullIndex` from
[stackoverflow](https://stackoverflow.com/questions/26010355/is-there-a-way-to-uniquely-identify-an-iframe-that-the-content-script-runs-in-fo).
The interactor of the page is called `root`, additionally we store the index for the interactor of the cookie notice in
the `local:selection`.
We move from the old messaging of `click_and_interact` to the **scripting API**, see above for more information.

We also monitor the links that we clicked on during page interaction—to actually visit distinct subpages.

### Capture & Propagation of Clicks (and other events)

Some websites capture and stop the propagation of click events.
I first noticed this could happen on [farmerama.rtl.de](https://farmerama.rtl.de).
What I now do is to react to any of click/mousedown/mouseup events in the selector UI—but only react once.
The problem was described in:
https://stackoverflow.com/questions/58605898/ensure-click-event-is-seen-by-the-content-script,
And I explained my fix in the blogpost:
https://szymonnastaly.com/blog/captured-click-events/

## May 15, 2024

### Working on the flow of violations

![violations_decision_tree.png](violations_decision_tree.png)

### New content script: interactor.content

Here we wait for messages that say we should reload the webpage or click on a cookie notice element and scroll around.

## May 14, 2024

### Better sentence segmentation

Removed npm package for sentence segmentation. Now using Intl.Segmenter (browser built-in functionality).

## May 12, 2024

### Integrating interactive_elements_model

We load the models/tokenizer in a Promise.all() expression.
Further, we also classify the interactive elements in a Promise.all() - in there we translate, classify, convert to a
label, and store that label in the selection variable.
The local storage `selection` is then of the form:

```
{
  notice: {
    selector: 'some query selector',
    text: 'text of the notice',
    label: 0 (no analytics/advertising) | 1 (analytics/advertising detected)
  },
  interactiveObjects: [{
    selector: 'some query selector',
    text: 'text of the interactive element',
    label: integer label corresponding to the Purpose Object
  }]
}
```

## May 11, 2024

### ONNX conversion

Converting the models to ONNX is done using a script from the transformers.js library, e.g., for the interactive
elements
model it was done using:

```shell
python3 -m scripts.convert --quantize --model_id ./interactive_elements_model --tokenizer_id bert-base-uncased --task text-classification
```

Note: this results in both a quantized and normal ONNX model. I have not made any comparisons in the quality of both.

TODO: Comparison of quantized and normal model.

### Integrating bert-based-uncased tokenizer into huggingface repos

I copied the `tokenizer.json` and `tokenizer_config.json` from
[bert-base-uncased-onnx](https://huggingface.co/Xenova/bert-base-uncased/tree/main) into the
[purpose_detection_model](https://huggingface.co/snastal/purpose_detection_model/tree/main). Now I can use the
`snastal/purpose_detection_model` in transformers.js as both Tokenizer and Model.

**The following described slowness is not true since integrating the tokenizer. It seems now that the non-quantized
version is fast enough.**

### Getting the non-quantized version to work

The non-quantized version works like this:

```javascript
let useQuantized = false;
let tokenizer = await AutoTokenizer.from_pretrained("snastal/purpose_detection_model", {quantized: useQuantized});
let model = await AutoModelForSequenceClassification.from_pretrained("snastal/purpose_detection_model", {
    quantized: useQuantized
});

// Actually run the model on the input text
let inputs = await tokenizer(text);
let res = await model(inputs);
```

Unfortunately, it is very slow (on my laptop 15s per sentence). Further, because the models are so big, we can only
classify one sentence after the other (so the following is not possible):

```javascript
let classifications = await Promise.all(sentences.map(async sentence => {
    let res = await classify(sentence);
    return getPrediction(res);
}));
```

If you were to run it in "parallel" like above, we get the error `RangeError: offset is out of bounds`, which probably
results directly from too much memory being used.
The following issues are
related: https://github.com/xenova/transformers.js/issues/499, https://github.com/xenova/transformers.js/issues/492.

It probably will be fixed + made faster by transformers.js version 3 (which uses webgpu).
Right now it is [in development](https://github.com/xenova/transformers.js/pull/545) and I cannot get it to work.
&rarr; I just get no result (but also no errors).

#### Update on May 16, 2024

By making three changes, the problem seems to have been fixed:

1. instead of initializing the tokenizer and model separately as before, we use the `pipeline API` as provided by
   transformers.js: `pipeline("text-classification", "snastal/purpose_detection_model", {quantized: quantized});`
2. instead of classifying the different sentences and interactive elements (depending on the model), we use the
   possibility
   of the pipeline API to provide an array of elements to
   classify: `await purposeClassifier(["one sentence.", "another sentence"])`
3. instead of creating the classifier (by calling `pipeline()`) always when need it, we now use a Singleton class that
   stores the model as returned by `pipeline()`. This definitely helped (because the problem was not solved by the first
   two changes alone).
   But it is strange that it even helped, because:
   a. transformers.js uses the Cache API of the browser to cache the models (to not always download them from
   huggingface)
   b. background scripts are service workers in manifest v3 &rarr they are sometimes inactive and state should
   theoretically be reset

**For the future:** We need to keep an eye on transformer.js being updated to v3 as this should help in many ways.
Additionally, it's not clear if the issue was resolved entirely, as often (with only the first two optimizations)
the `RangeError` appeared only after
analysing many pages.

## May 8, 2024

Remove the “storing” and “retrieving” of the transformer models (which are functions) to and from
the [browser.storage](http://browser.storage) - because that doesn't work for functions.
Either way, the models are somehow cached (or similar), because we (seemingly) don’t download them for every sentence
separately.

The BERT models are now finally working in the Cookie Audit 2 extension. The issue was that the permission to run `wasm`
was not set inside the `manifest.json`. It took many hours (of trying other things) to find this out.
The classification of the purpose-detection-model returns logits of which we take the one with the biggest value. (index
0 means functional, index 1 means analytics/advertising). Then we sum up how many sentences describe
analytics/advertising in the notice.

## May 7, 2024

Added separate message: when a content script has a confirmed cookie notice selector, it sends a message ___ to the
extension service worker. The extension service worker then continues with the scan.
Splitting text to sentences is now done with a npm package called `sentence-splitter`. This is unfortunately necessary,
as spacy does not run in javascript (at least it seems so).

I created a first version of a diagram to visualize the messaging that is going on between the components (namely the
extension service worker, the popup and the content script).
Added reset (setting to empty objects) of the storage (`cookies`, `selection`, `scan` ) at the beginning of a new scan.
Learning: no usage of global variables (to store state) inside the background script, instead need to
use `local storage` .