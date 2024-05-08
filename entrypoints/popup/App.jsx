import {useState, useEffect, useRef} from 'react';
import './App.css';
import '@mantine/core/styles.css';
import {MantineProvider} from '@mantine/core';
import {Badge, Container, Stack, Text, Group, Center, Button} from '@mantine/core';
import {storage} from 'wxt/storage';
import {SCANSTAGE, FIXES} from '../modules/globals.js'


/**
 * Retrieve Url of the active tab.
 * @returns {String} Url.
 */
async function getURL() {
    let queryOptions = {active: true, lastFocusedWindow: true};
    // `tab` will either be a `tabs.Tab` instance or `undefined`.
    let [tab] = await browser.tabs.query(queryOptions);
    if (!tab || !tab.url) {
        return undefined;
    }
    return tab.url;
}

export default function App() {
    const [scan, _setScan] = useState(null);
    const scanRef = useRef(null);

    function setScan(s) {
        _setScan(s);
        scanRef.current = s;
    }

    useEffect(() => {
        let intervalID;
        storage.getItem("local:scan").then((localScan) => {
            if (localScan) {
                setScan(localScan);
                if (localScan.stage && (localScan.stage === SCANSTAGE[1] || localScan.stage === SCANSTAGE[2])) {
                    console.log("localscan is stage 1 or 2: ");
                    console.log(localScan);
                    intervalID = window.setInterval(() => {
                        try {
                            browser.runtime.sendMessage("analyze_cookies");
                        } catch (err) {
                            console.error("error analyzing cookies");
                        }
                    }, 3000);
                }
            }
        });

        const unwatch = storage.watch('local:scan', (newScan, _) => {
            console.log("changed scan in storage: ");
            console.log(newScan);
            setScan(newScan);
        });
        return () => {
            window.clearInterval(intervalID);
            unwatch();
        };
    }, []);

    function isStage(scanState, stageIndex) {
        if (scanState && scanState.stage === SCANSTAGE[stageIndex]) {
            return true;
        } else return !scanState && stageIndex === 0;
    }

    async function startSelect () {
        // Ensure chrome.tabs is available (meaning this is running within a Chrome extension with appropriate permissions)
        if (browser.tabs) {
            const tabs = await browser.tabs.query({active: true, currentWindow: true});
            await browser.tabs.sendMessage(tabs[0].id, "start_select");
        } else {
            console.log('This function is meant to be run in a Chrome Extension.');
        }
    }

    /**
     * The next functions are handlers for when the user clicks one of the buttons on the popup.
     * This function is called when a user clicks the start button. It creates a new empty scan object and stores it in the chrome storage.
     */
    async function startScan() {
        const url = getURL();
        if (!url) {
            console.log('Open a website before starting a scan');
            return;
        }

        console.log("Starting scan...");
        //await startSelect();

        /*try {
            const res = await browser.runtime.sendMessage("clear_cookies");
            console.log(`cleared cookies: ${res}`);
        } catch (err) {
            console.error("error clearing cookies");
            return;
        }*/

        browser.runtime.sendMessage("start_scan");

        // close popup
        window.close();
    }

    function warnings(s) {
        let elements = [];
        if (s.nonnecessary.length > 0) {
            elements.push(<Group><Badge color="red">{s.nonnecessary.length}</Badge>Non-essential cookies</Group>);

            let cookieWarnings = s.nonnecessary.map((c) => {
                return <Stack align="flex-start" justify="flex-start" bg="var(--mantine-color-red-1)" gap="xs" key={c.name}>
                    <Text>{c.name}</Text>
                    <Text>{c.domain}</Text>
                    <Text>{c.current_label}</Text>
                </Stack>
            });
            elements.push(<Stack>{cookieWarnings}</Stack>)
        }
        return elements;
    }



    return (<MantineProvider>
        <Center maw={800} p={20}>
            <Stack>
                <Group justify="center">
                    <Text>CookieAudit 2</Text>
                </Group>
                <Group justfy="center" grow>
                    {isStage(scan, 0) && (<Container>
                        <Text>Open the target website</Text>
                        <Text>Close all other tabs before starting a scan</Text>
                        <Button variant="light" color="green" onClick={startScan}>Start Scan</Button>
                    </Container>)}
                    {isStage(scan, 1) && (<Container>
                        <Text>Reload the page and reject all non-essential cookies. Then navigate around the
                            website.</Text>
                        {warnings(scan)}
                    </Container>)}
                </Group>
            </Stack>
        </Center>
    </MantineProvider>);
}
