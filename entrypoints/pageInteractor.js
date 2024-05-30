import {delay} from "./modules/globals.js";

// This function gets the hostname from a URL. ChatGPT
function getHostName(url) {
    const anchorElement = document.createElement('a');
    anchorElement.href = url;
    return anchorElement.hostname;
}

function isTrivialLink(currentUrl, linkUrl) {
    let currentLocation;
    let targetLocation
    try {
        currentLocation = new URL(currentUrl);
        targetLocation = new URL(linkUrl);
    } catch (error) {
        console.log("URL not possbile currentUrl", currentUrl);
        console.log("linkUrl", linkUrl);
        return true;
    }

    // Check if the link is to the same page (ignoring hash and search)
    if (targetLocation.origin === currentLocation.origin && targetLocation.pathname === currentLocation.pathname && targetLocation.search === '') {
        return true;
    }

    // Check if the link is exactly the same as the current URL or it's just the current URL with any hash
    return linkUrl === currentUrl || (targetLocation.href === currentLocation.href + targetLocation.hash);
}

export default defineUnlistedScript(async () => {
    window.scrollBy({top: window.innerHeight, behavior: "smooth"});

    await delay(1000);

    // find link to click on
    const scan = await storage.getItem("local:scan");
    const currentUrl = scan.url;
    const currentDomain = getHostName(currentUrl);
    const headerLinks = document.querySelectorAll('header a, .header a, .nav a, nav a, a');

    let interaction = await storage.getItem("local:interaction");

    for (const link of headerLinks) {
        if (link.href && !interaction.visitedPages.includes(link.href) && getHostName(link.href) === currentDomain && !isTrivialLink(currentUrl, link.href)) {
            interaction.visitedPages.push(link.href);
            await storage.setItem("local:interaction", interaction);
            await delay(5000);
            return link.href; // Stop after navigating to the first suitable link.
        }
    }
});