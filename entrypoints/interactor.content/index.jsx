import smoothscroll from 'smoothscroll-polyfill';
import {delay} from "../modules/globals.js";

export default defineContentScript({
    matches: ["<all_urls>"],

    async main(ctx) {
        browser.runtime.onMessage.addListener(handleMessage);
        await browser.runtime.sendMessage({msg: "interactor_mounted"});
        console.log("send message that interactor_mounted");

        // Function to await no changes being made to the DOM
        // ChatGPT
        function awaitNoDOMChanges(timeout = 100) {
            return new Promise((resolve) => {
                let debounceTimer;

                // Create a MutationObserver to observe the entire document
                const observer = new MutationObserver(() => {
                    // Clear the previous timer and set a new one
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        // Stop observing changes and resolve the promise
                        observer.disconnect();
                        resolve();
                    }, timeout);
                });

                // Start observing changes in the entire document
                observer.observe(document, {
                    childList: true, // Observe changes to child nodes
                    subtree: true, // Observe changes in all descendants
                    attributes: true, // Observe changes to attributes
                    characterData: true // Observe changes to text content
                });
            });
        }

        // This function gets the hostname from a URL. ChatGPT
        function getHostName(url) {
            const anchorElement = document.createElement('a');
            anchorElement.href = url;
            return anchorElement.hostname;
        }

        function isTrivialLink(currentUrl, linkUrl) {
            const currentLocation = new URL(currentUrl);
            const targetLocation = new URL(linkUrl);

            // Check if the link is to the same page (ignoring hash and search)
            if (targetLocation.origin === currentLocation.origin && targetLocation.pathname === currentLocation.pathname && (targetLocation.hash === '' || targetLocation.hash === '#') && targetLocation.search === '') {
                return true;
            }

            // Check if the link is exactly the same as the current URL or just a hashtag
            return linkUrl === currentUrl || linkUrl === currentUrl + '#';
        }

        // This function finds a suitable link in the header and navigates if it's the same domain.
        // ChatGPT
        function navigateWithinSameDomain() {
            const currentUrl = window.location.href;
            const currentDomain = window.location.hostname;
            const headerLinks = document.querySelectorAll('header a, .header a, .nav a, nav a, a'); // Adjust the selector as per your page structure.

            for (let link of headerLinks) {
                if (link.href && getHostName(link.href) === currentDomain && !isTrivialLink(currentUrl, link.href)) {
                    window.location.href = link.href; // Navigate to the link.
                    break; // Stop after navigating to the first suitable link.
                }
            }
        }

        function handleMessage(message, sender, sendResponse) {
            smoothscroll.polyfill();
            let {msg, data} = message;
            console.debug("interactor received message", message);
            if (msg === "reload") {
                // I think we have to sendResponse before, because the reload also reloads this content script
                sendResponse({msg: "ok"});
                window.location.reload();
            } else if (msg === 'click_and_interact') {
                (async () => {
                    await awaitNoDOMChanges(200);
                    if (data?.selector?.length === 0) {
                        sendResponse({msg: "ok"});
                        window.scrollBy({top: window.innerHeight, behavior: "smooth"});
                        await delay(1000);
                        navigateWithinSameDomain(); // results in remounting of content script, response has to be sent _before_
                    } else if (data?.selector?.length === 1) {
                        let el = document.querySelector(data.selector[0]);
                        console.debug("el in click_and_interact", el);
                        console.debug("data.selector in click_and_interact", data.selector);
                        if (el != null) {
                            sendResponse({msg: "ok"});
                            el.dispatchEvent(new MouseEvent("click"));
                            await delay(1000);
                            window.scrollBy({top: window.innerHeight, behavior: "smooth"});
                            await delay(1000);
                            navigateWithinSameDomain(); // results in remounting of content script, response has to be sent _before_
                        } else {
                            sendResponse({msg: "query selector not found"});
                        }
                    } else if (data?.selector?.length === 2) {
                        sendResponse({msg: "TODO: query selector of depth 2"});
                    } else {
                        sendResponse({msg: `malformed query selector: ${data?.selector}`});
                    }
                })();
                return true;
            }
        }
    },
});
