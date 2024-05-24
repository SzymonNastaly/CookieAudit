import {useState, useEffect, useRef} from 'react';
import './App.css';
import '@mantine/core/styles.css';
import {MantineProvider} from '@mantine/core';
import {Badge, Container, Stack, Text, Group, Center, Button, Divider} from '@mantine/core';
import {storage} from 'wxt/storage';
import {STAGE2} from '../modules/globals.js'


/**
 * Retrieve Url of the active tab.
 * @returns {String} Url.
 */
async function getURL() {
    let queryOptions = {active: true};
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
        storage.getItem("local:scan").then((localScan) => {
            console.log("getting local:scan", localScan);
            if (localScan != null) {
                setScan(localScan);
            }
        });

        const unwatch = storage.watch('local:scan', (newScan, _) => {
            setScan(newScan);
        });
        return () => {
            unwatch();
        };
    }, []);

    function isStage(scanState, stage) {
        if (stage === STAGE2.NOT_STARTED) {
            return scanState == null || scanState['stage2'] === stage;
        } else {
            return scanState && scanState['stage2'] === stage;
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
        const {msg} = await browser.runtime.sendMessage({msg: "start_scan"});
        if (msg !== "ok") throw new Error("start_scan was not confirmed by background.js");

        // close popup
        window.close();
    }

    function noNotice() {
        const {msg} = browser.runtime.sendMessage({msg: "no_notice"});
        if (msg !== "ok") throw new Error("no_notice was not confirmed by background.js");
    }

    function cancelScan() {
        const {msg} = browser.runtime.sendMessage({msg: "cancel_scan"});
        if (msg !== "ok") throw new Error("cancel_scan was not confirmed by background.js");
    }

    function warnings(s) {
        let elements = [];
        if (s.nonnecessary.length > 0) {
            elements.push(<Group><Badge color="red">{s.nonnecessary.length}</Badge>Non-essential cookies</Group>);

            let cookieWarnings = s.nonnecessary.map((c) => {
                return <Stack align="flex-start" justify="flex-start" bg="var(--mantine-color-red-1)" gap="xs"
                              key={c.name}>
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
                <Group justify="center" grow>
                    {isStage(scan,STAGE2.NOT_STARTED) && (<Container>
                        <Text>Open the target website</Text>
                        <Text>Close all other tabs before starting a scan</Text>
                        <Button variant="light" color="green" onClick={startScan}>Start Scan</Button>
                    </Container>)}
                    {isStage(scan,STAGE2.NOTICE_SELECTION) && (<Container>
                        <Text>Please select the cookie notice.</Text>
                        <Text>If there is no notice, skip the selection:</Text>
                        <Button variant="light" color="orange" onClick={noNotice}>No Cookie Notice</Button>
                    </Container>)}
                    {isStage(scan,STAGE2.INTERACTION_WO_NOTICE) && (<Container>
                        <Text>Please scroll through the website and click on a few links.</Text>
                        <Button variant="light" color="orange" onClick={noNotice}>Finished Interaction</Button>
                    </Container>)}
                </Group>
                <Divider my="md" />
                <Group justify="center" grow>
                    <Button variant="light" color="red" onClick={cancelScan}>Cancel Scan</Button>
                </Group>
            </Stack>
        </Center>
    </MantineProvider>);
}
