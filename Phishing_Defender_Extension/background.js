let trancoWhitelist = null;
let whitelistPromise = null;

// 1. Load Whitelist Safely
async function ensureWhitelist() {
    if (trancoWhitelist) return;
    if (!whitelistPromise) {
        whitelistPromise = fetch(chrome.runtime.getURL('models/whitelist.json'))
            .then(res => res.json())
            .then(data => { trancoWhitelist = new Set(data); console.log("✅ Whitelist loaded"); })
            .catch(e => { trancoWhitelist = new Set(); });
    }
    await whitelistPromise;
}

// 2. Offscreen Manager with "Queue/Lock"
let creatingOffscreen = false;
async function ensureOffscreen() {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl] });
    if (existing.length > 0) return;

    // If already creating, wait in line
    if (creatingOffscreen) {
        await new Promise(resolve => setTimeout(resolve, 200));
        return ensureOffscreen();
    }

    creatingOffscreen = true;
    try {
        await chrome.offscreen.createDocument({
            url: offscreenUrl, reasons: ['USER_MEDIA', 'DOM_PARSER'], justification: 'AI Processing'
        });
        await new Promise(resolve => setTimeout(resolve, 500)); // Give Sandbox time to load
    } finally {
        creatingOffscreen = false;
    }
}

// 3. Federated Learning Storage
function saveToLocalFederatedStorage(dataType, data, label) {
    chrome.storage.local.get(['federatedData'], function(result) {
        let currentData = result.federatedData || [];
        currentData.push({ type: dataType, features: data, label: label, timestamp: new Date().toISOString() });
        if (currentData.length > 100) currentData.shift();
        chrome.storage.local.set({ federatedData: currentData });
    });
}

// 4. Message Router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        // --- A. URL Checking ---
        if (request.action === "check_url") {
            try {
                await ensureWhitelist(); // Wait for whitelist
                const hostname = new URL(request.url).hostname.replace("www.", "");
                if (trancoWhitelist.has(hostname)) {
                    sendResponse({ status: "SAFE", confidence: 100 });
                    return;
                }
            } catch(e) {} 

            await ensureOffscreen(); // Wait for AI 
            
            chrome.runtime.sendMessage({ target: 'offscreen', action: 'predict_url', url: request.url }, (aiRes) => {
                if(aiRes) {
                    if (aiRes.status !== "LOADING") {
                        saveToLocalFederatedStorage('url', request.url, aiRes.status === "PHISHING" ? 1 : 0);
                    }
                    sendResponse(aiRes);
                } else {
                    sendResponse({ status: "LOADING", confidence: 0 }); 
                }
            });
        }
        
        // --- B. QR Checking ---
        else if (request.action === "decode_and_check_qr") {
            await ensureOffscreen();
            chrome.runtime.sendMessage({ target: 'offscreen', action: 'process_qr', imageUrl: request.imageUrl }, sendResponse);
        }
        
        // --- C. Voice Checking ---
        else if (request.action === "start_voice_scan") {
            await ensureOffscreen();
            chrome.runtime.sendMessage({ target: 'offscreen', action: 'start_listening' });
            sendResponse({ status: "started" });
        }
        else if (request.action === "voice_result_ready") {
            saveToLocalFederatedStorage('voice', "voice_data", request.status === "PHISHING" ? 1 : 0);
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if(tabs[0]) chrome.tabs.sendMessage(tabs[0].id, request);
            });
        }
    })();
    return true; 
});