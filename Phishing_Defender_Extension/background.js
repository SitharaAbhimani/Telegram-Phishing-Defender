// background.js - Main extension background service worker (Clean Version for FL)

let trancoWhitelist = null;
let whitelistPromise = null;
let creatingOffscreen = false;

// ======================================================================
// 1. WHITELIST MANAGEMENT
// ======================================================================
async function ensureWhitelist() {
    if (trancoWhitelist) return;
    if (!whitelistPromise) {
        whitelistPromise = fetch(chrome.runtime.getURL('models/whitelist.json'))
            .then(res => res.json())
            .then(data => { trancoWhitelist = new Set(data); })
            .catch(e => { trancoWhitelist = new Set(); });
    }
    await whitelistPromise;
}

function isWhitelistedFast(urlString) {
    try {
        const urlObj = new URL(urlString);
        let hostname = urlObj.hostname.toLowerCase();
        if (hostname.startsWith("www.")) hostname = hostname.substring(4);
        if (trancoWhitelist.has(hostname)) return true;

        const parts = hostname.split('.');
        if (parts.length >= 3 && (parts[parts.length - 2] === 'ac' || parts[parts.length - 2] === 'co' || parts[parts.length - 2] === 'gov' || parts[parts.length - 2] === 'edu')) {
            const rootDomain = parts.slice(-3).join('.');
            if (trancoWhitelist.has(rootDomain)) return true;
        } else if (parts.length >= 2) {
            const rootDomain = parts.slice(-2).join('.');
            if (trancoWhitelist.has(rootDomain)) return true;
        }
        return false;
    } catch (e) { return false; }
}

// ======================================================================
// 2. OFFSCREEN MANAGER
// ======================================================================
async function ensureOffscreen() {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl] });
    if (existing.length > 0) return;
    if (creatingOffscreen) {
        await new Promise(resolve => setTimeout(resolve, 200));
        return ensureOffscreen();
    }
    creatingOffscreen = true;
    try {
        await chrome.offscreen.createDocument({ url: offscreenUrl, reasons: ['USER_MEDIA', 'DOM_PARSER'], justification: 'AI Processing' });
        await new Promise(resolve => setTimeout(resolve, 500));
    } finally { creatingOffscreen = false; }
}

// ======================================================================
// 3. FEDERATED LEARNING LOCAL STORAGE
// ======================================================================
function saveToLocalFederatedStorage(dataType, data, label) {
    chrome.storage.local.get(['federatedData'], function (result) {
        let currentData = result.federatedData || [];
        currentData.push({ type: dataType, features: data, label: label, timestamp: new Date().toISOString() });
        if (currentData.length > 100) currentData.shift();
        chrome.storage.local.set({ federatedData: currentData });
    });
}

// ======================================================================
// 4. MESSAGE ROUTER
// ======================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "check_url") {
        (async () => {
            await ensureWhitelist();
            if (isWhitelistedFast(request.url)) {
                sendResponse({ status: "SAFE", confidence: 100, url: request.url });
                return;
            }
            await ensureOffscreen();
            chrome.runtime.sendMessage({ target: 'offscreen', action: 'predict_url', url: request.url }, (aiRes) => {
                if (aiRes) {
                    aiRes.url = request.url;
                    if (aiRes.status !== "LOADING" && aiRes.sequence) {
                        saveToLocalFederatedStorage('url', aiRes.sequence, aiRes.status === "PHISHING" ? 1 : 0);
                    }
                }
                sendResponse(aiRes || { status: "LOADING", confidence: 0 });
            });
        })();
        return true;
    }

    else if (request.action === "decode_and_check_qr") {
        (async () => {
            await ensureOffscreen();
            chrome.runtime.sendMessage({ target: 'offscreen', action: 'process_qr', imageUrl: request.imageUrl }, async (qrRes) => {
                if (chrome.runtime.lastError || !qrRes || !qrRes.qrData) {
                    sendResponse({ status: "NO_QR" });
                    return;
                }
                const decodedUrl = qrRes.qrData;
                await ensureWhitelist();
                if (isWhitelistedFast(decodedUrl)) {
                    sendResponse({ status: "SAFE", confidence: 100, url: decodedUrl });
                    return;
                }
                chrome.runtime.sendMessage({ target: 'offscreen', action: 'predict_url', url: decodedUrl }, (aiRes) => {
                    if (aiRes) {
                        aiRes.url = decodedUrl;
                        if (aiRes.status !== "LOADING" && aiRes.sequence) {
                            saveToLocalFederatedStorage('qr_url', aiRes.sequence, aiRes.status === "PHISHING" ? 1 : 0);
                        }
                    }
                    sendResponse(aiRes || { status: "LOADING", confidence: 0 });
                });
            });
        })();
        return true;
    }

    else if (request.action === "start_voice_scan") {
        (async () => {
            await ensureOffscreen();
            chrome.runtime.sendMessage({ target: 'offscreen', action: 'start_listening' });
            sendResponse({ status: "started" });
        })();
        return true;
    }

    else if (request.action === "voice_result_ready") {
        saveToLocalFederatedStorage('voice', "voice_data", request.status === "PHISHING" ? 1 : 0);
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, request);
        });
        return true;
    }
});

// ======================================================================
// 5. FEDERATED LEARNING - SERVER COMMUNICATION 
// ======================================================================
const FL_SERVER_URL = "http://127.0.0.1:8000";
const CLIENT_ID = "client_" + Math.random().toString(36).substr(2, 9);

async function sendWeightsToServer(modelType, weightsArray, sampleCount) {
    try {
        console.log(`⏳ [FL] Sending ${modelType} weights...`);
        const response = await fetch(`${FL_SERVER_URL}/api/weights/upload`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: CLIENT_ID, model_type: modelType, weights: weightsArray, data_samples_count: sampleCount })
        });
        if (response.ok) console.log(`✅ [FL] Successfully sent ${modelType} weights!`);
    } catch (error) { console.error(`❌ [FL] Failed to connect to server.`, error); }
}
self.sendWeightsToServer = sendWeightsToServer;

async function fetchGlobalModel(modelType) {
    try {
        const response = await fetch(`${FL_SERVER_URL}/api/weights/global/${modelType}`, { method: "GET", headers: { "Content-Type": "application/json" } });
        const result = await response.json();
        if (result.weights && result.weights.length > 0) console.log(`✅ [FL] Received global ${modelType} model!`);
    } catch (error) { console.error(`❌ [FL] Failed to fetch global model.`, error); }
}
self.fetchGlobalModel = fetchGlobalModel;