import {
  Badge,
  Button,
  Center,
  Container,
  Divider,
  Group,
  MantineProvider,
  Progress,
  Stack,
  Text,
} from '@mantine/core';
import {useEffect, useRef, useState} from 'react';
import './App.css';
import '@mantine/core/styles.css';
import {storage} from 'wxt/storage';
import {STAGE2} from '../modules/globals.js';

/**
 * Retrieve Url of the active tab.
 * @returns {Promise<String|null>} Url.
 */
async function getURL() {
  let queryOptions = {active: true};
  // `tab` will either be a `tabs.Tab` instance or `undefined`.
  let [tab] = await browser.tabs.query(queryOptions);
  if (!tab || !tab.url) {
    return null;
  }
  return tab.url;
}

export default function App() {
  const [startDisabled, setStartDisabled] = useState(false);

  const [ieProgress, setIeProgress] = useState(
      {isDownloading: false, value: 0});
  const [purposeProgress, setPurposeProgress] = useState(
      {isDownloading: false, value: 0});

  const [scan, _setScan] = useState(null);
  const scanRef = useRef(null);

  function setScan(s) {
    _setScan(s);
    scanRef.current = s;
  }

  useEffect(() => {
    storage.getItem('local:scan').then((localScan) => {
      console.log('getting local:scan', localScan);
      if (localScan != null) {
        setScan(localScan);
      }
    });
    storage.getItem('local:progress').then((progress) => {
      if (progress != null) {
        setIeProgress({
          isDownloading: progress.ieDownloading,
          value: progress.ie,
        });
        setPurposeProgress({
          isDownloading: progress.purposeDownloading,
          value: progress.purpose,
        });
      }
    });

    (async () => {
      const url = await getURL();
      if (url == null || !url.startsWith('http')) {
        setStartDisabled(true);
      }
    })();

    const unwatchScan = storage.watch('local:scan', (newScan, _) => {
      setScan(newScan);
    });
    const unwatchProgress = storage.watch('local:progress',
        (newProgress, _) => {
          if (newProgress != null) {
            setIeProgress({
              isDownloading: newProgress.ieDownloading,
              value: newProgress.ie,
            });
            setPurposeProgress({
              isDownloading: newProgress.purposeDownloading,
              value: newProgress.purpose,
            });
          }
        });

    return () => {
      unwatchScan();
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
    const tabs = await browser.tabs.query({});
    let windows = new Set(tabs.map(tab => tab.windowId));

    if (windows.size > 1) {
      const tabs = await browser.tabs.query({active: true});
      await browser.tabs.sendMessage(tabs[0].id, {
        msg: 'dialog',
        title: browser.i18n.getMessage('popup_errorTitle'),
        text: browser.i18n.getMessage('popup_tooManyWindowsText'),
        color: 'red',
      });
      return;
    } else if (tabs.length > 1) {
      const tabs = await browser.tabs.query({active: true});
      await browser.tabs.sendMessage(tabs[0].id, {
        msg: 'dialog',
        title: browser.i18n.getMessage('popup_errorTitle'),
        text: browser.i18n.getMessage('popup_tooManyTabsText'),
        color: 'red',
      });
      return;
    }

    console.log('Starting scan...');
    const {msg} = await browser.runtime.sendMessage({msg: 'start_scan'});
    if (msg !== 'ok') throw new Error(
        'start_scan was not confirmed by background.js');

    // close popup
    window.close();
  }

  async function noNotice() {
    const {msg} = await browser.runtime.sendMessage({msg: 'no_notice'});
    if (msg !== 'ok') throw new Error(
        'no_notice was not confirmed by background.js');
  }

  async function cancelScan() {
    setStartDisabled(true);
    const response = await browser.runtime.sendMessage({msg: 'cancel_scan'});
    console.log('response after cancel_scan', response);
    if (response.msg !== 'ok') throw new Error(
        'cancel_scan was not confirmed by background.js');
    setStartDisabled(false);
    // close popup
    window.close();
  }

  function warnings(s) {
    let elements = [];
    if (s.nonnecessary.length > 0) {
      elements.push(<Group><Badge color="red">{s.nonnecessary.length}</Badge>Non-essential
        cookies</Group>);

      let cookieWarnings = s.nonnecessary.map((c) => {
        return <Stack align="flex-start" justify="flex-start"
                      bg="var(--mantine-color-red-1)" gap="xs"
                      key={c.name}>
          <Text>{c.name}</Text>
          <Text>{c.domain}</Text>
          <Text>{c.current_label}</Text>
        </Stack>;
      });
      elements.push(<Stack>{cookieWarnings}</Stack>);
    }
    return elements;
  }

  return (<MantineProvider>
    <Center maw={800} p={20}>
      <Stack>
        <Group justify="center">
          <Text>{browser.i18n.getMessage('ext_name')}</Text>
        </Group>
        <Group justify="center" grow>
          {isStage(scan, STAGE2.NOT_STARTED) && (<Container>
            <Text>{browser.i18n.getMessage(
                'popup_initialInstruction')}</Text>
            <Group justify="center" grow>
              <Button variant="light" color="green"
                      onClick={startScan}
                      disabled={startDisabled}>{browser.i18n.getMessage(
                  'popup_startScanBtn')}</Button>
            </Group>
          </Container>)}
          {isStage(scan, STAGE2.NOTICE_SELECTION) && (<Container>
            <Text>{browser.i18n.getMessage(
                'popup_skipSelection')}</Text>
            <Button variant="light" color="orange"
                    onClick={noNotice}>{browser.i18n.getMessage(
                'popup_noNoticeBtn')}</Button>
          </Container>)}
        </Group>
        <Divider my="md"/>
        <Group justify="center" grow>
          {((purposeProgress.value > 0 && purposeProgress.value <
                      100) ||
                  (ieProgress.value > 0 && ieProgress.value < 100)) &&
              (<Container>
                <Text>{browser.i18n.getMessage(
                    'popup_download')}</Text>
                <Progress
                    value={(purposeProgress.value + ieProgress.value) /
                        2}/>
                <Divider my="md"/>
              </Container>)}
        </Group>
        <Group justify="center" grow>
          <Button variant="light" color="red"
                  onClick={cancelScan}>{browser.i18n.getMessage(
              'popup_cancelScanBtn')}</Button>
        </Group>
      </Stack>
    </Center>
  </MantineProvider>);
}
