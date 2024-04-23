import {useState, useEffect} from 'react';
import './App.css';
import '@mantine/core/styles.css';
import {MantineProvider} from '@mantine/core';
import {Center, Box, Button} from '@mantine/core';
import {storage} from 'wxt/storage';

export default function App() {
    const [cmps, setCmps] = useState("Default CMPs");
    const [count, setCount] = useState(0);

    useEffect(() => {
        // Return the cleanup function that React will call on component unmount
        // or before re-running the effect due to dependency changes.
        // This function will remove the watcher.
        return () => {
            // unwatch();
        };
    }, []);

    let startSelect = () => {
        // Ensure chrome.tabs is available (meaning this is running within a Chrome extension with appropriate permissions)
        if (chrome.tabs) {
            chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
                chrome.tabs.sendMessage(tabs[0].id, {start: "true"}, function(response) {
                    // You can handle a response from your content script here, if needed
                });
                window.close(); // Note: window.close() will only work in the popup of your Chrome Extension
            });
        } else {
            console.log('This function is meant to be run in a Chrome Extension.');
        }
    };

    /*const autoEnableToggle = async (event) => {
        const newValue = event.target.checked;

        // Step 1: Update React state
        setAutoEnable(newValue);

        // Step 2: Update browser's local storage
        try {
            await storage.setItem("local:selectorAutoEnable", newValue );
        } catch (error) {
            console.error('Failed to save settings:', error);
            // revert the state change if saving to storage fails
            setAutoEnable(!newValue);
        }
    };*/

    return (<MantineProvider>
        <Center maw={400} h={100}>
            <Box>CookieAudit 2</Box>
            <Box>
                <Button variant="light" color="green" onClick={startSelect}>Start Selection</Button>
            </Box>
        </Center>
    </MantineProvider>);
}
