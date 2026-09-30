// offscreen.js - Acts as a bridge between background.js and sandbox.js
const sandbox = document.getElementById('ai-sandbox');
let pendingRequests = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return false;

    if (message.action === 'predict_url' || message.action === 'process_qr') {
        const reqId = Date.now().toString() + Math.random().toString();
        pendingRequests[reqId] = sendResponse;
        sandbox.contentWindow.postMessage({ id: reqId, action: message.action, url: message.url, imageUrl: message.imageUrl }, '*');
        return true;
    }
    else if (message.action === 'start_listening') {
        startVoiceAI();
        return false;
    }
});

window.addEventListener('message', (event) => {
    const data = event.data;

    // 🚀 FL UPDATE: Listen for weights from sandbox and forward to background.js
    if (data.type === 'federated_weights') {
        chrome.runtime.sendMessage({ 
            action: 'trigger_fl_upload', 
            modelType: data.modelType, 
            weights: data.weights 
        });
        return;
    }

    if (data.type === 'voice_result') {
        chrome.runtime.sendMessage({ action: 'voice_result_ready', status: data.status, confidence: data.confidence });
        return;
    }
    if (data.id && pendingRequests[data.id]) {
        if (data.qrData !== undefined) {
            pendingRequests[data.id]({ qrData: data.qrData });
        } else if (data.status) {
            pendingRequests[data.id](data);
        }
        delete pendingRequests[data.id];
    }
});

async function startVoiceAI() {
    try {
        console.log("🎤 [Offscreen] Requesting Microphone access...");
        const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioContext = new AudioContext({ sampleRate: 22050 });

        // If AudioContext is suspended by the browser, it will be resumed.
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        const source = audioContext.createMediaStreamSource(mediaStream);
        let mfccFeatures = [];

        console.log("👂 [Offscreen] Listening for 7 seconds...");

        const meydaAnalyzer = Meyda.createMeydaAnalyzer({
            "audioContext": audioContext,
            "source": source,
            "bufferSize": 512,
            "featureExtractors": ["mfcc"],
            "callback": (features) => {
                if (features && features.mfcc) {
                    let currentMfcc = features.mfcc;
                    if (currentMfcc.length > 40) currentMfcc = currentMfcc.slice(0, 40);
                    while (currentMfcc.length < 40) currentMfcc.push(0);
                    mfccFeatures.push(currentMfcc);
                }
            }
        });

        meydaAnalyzer.start();

        setTimeout(() => {
            meydaAnalyzer.stop();
            mediaStream.getTracks().forEach(track => track.stop());
            audioContext.close();

            if (mfccFeatures.length > 0) {
                console.log(`📤 [Offscreen] Sending ${mfccFeatures.length} voice frames to Sandbox.`);
                sandbox.contentWindow.postMessage({ action: 'predict_voice', features: mfccFeatures }, '*');
            } else {
                console.error("❌ [Offscreen] No audio features captured! Did you play the audio?");
                chrome.runtime.sendMessage({ action: 'voice_result_ready', status: "ERROR", confidence: 0 });
            }
        }, 7000);
    } catch (e) {
        console.error("❌ [Offscreen] Microphone Error:", e);
        chrome.runtime.sendMessage({ action: 'voice_result_ready', status: "ERROR", confidence: 0 });
    }
}