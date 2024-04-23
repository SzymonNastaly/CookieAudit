export default defineBackground(() => {
    storage.setItem("local:selectorShowPreview", false);
    storage.setItem("local:selectorAutoEnable", false);


    console.log('Hello background!', {id: browser.runtime.id});
});
