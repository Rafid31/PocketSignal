chrome.runtime.onInstalled.addListener(() => {
  console.log('PocketSignal Pro installed!');
});

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, {action: 'toggle_panel'});
});
