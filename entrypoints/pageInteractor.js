import {delay, urlWoQueryOrFragment} from './modules/globals.js';

// This function gets the hostname from a URL. ChatGPT
function getHostName(url) {
  const anchorElement = document.createElement('a');
  anchorElement.href = url;
  return anchorElement.hostname;
}

function isTrivialLink(currentUrl, linkUrl) {
  let currentLocation;
  let targetLocation;
  try {
    currentLocation = new URL(currentUrl);
    targetLocation = new URL(linkUrl);
  } catch (error) {
    return true;
  }

  // Check if the link is to the same page (ignoring hash and search)
  return targetLocation.origin === currentLocation.origin && targetLocation.pathname === currentLocation.pathname;
}

export default defineUnlistedScript(async () => {
  window.scrollBy({top: window.innerHeight, behavior: 'smooth'});

  await delay(1000);

  // find an anchor to click on
  const scan = await storage.getItem('local:scan');
  const currentUrl = scan.url;
  await storage.setItem('local:scan', scan);
  const currentDomain = getHostName(currentUrl);
  const headerLinks = document.querySelectorAll('header a, .header a, .nav a, nav a, a');

  let interaction = await storage.getItem('local:interaction');

  for (const link of headerLinks) {
    if (link.href && getHostName(link.href) === currentDomain && !isTrivialLink(currentUrl, link.href)) {
      const cleanUrl = urlWoQueryOrFragment(link.href);
      if (!interaction.visitedPages.includes(cleanUrl)) {
        interaction.visitedPages.push(cleanUrl);
        await storage.setItem('local:interaction', interaction);
        await delay(3000);
        return cleanUrl; // Stop after navigating to the first suitable link.
      }
    }
  }
  // scripts always need to return explicitly
  return null;
});