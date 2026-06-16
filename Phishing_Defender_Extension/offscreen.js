const sandbox = document.getElementById('ai-sandbox');
let pendingRequests = {};

// Receive from Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return false;

    if (message.action === 'predict_url') {
        const reqId = Date.now().toString() + Math.random().toString();
        pendingRequests[reqId] = sendResponse;
        sandbox.contentWindow.postMessage({ id: reqId, action: 'predict_url', url: message.url }, '*');
        return true;
    }
    else if (message.action === 'process_qr') {
        const reqId = Date.now().toString() + Math.random().toString();
        pendingRequests[reqId] = sendResponse;
        sandbox.contentWindow.postMessage({ id: reqId, action: 'process_qr', imageUrl: message.imageUrl }, '*');
        return true;
    }
    else if (message.action === 'start_listening') {
        startVoiceAI();
        return false;
    }
});

// Receive from Sandbox and send to Background
window.addEventListener('message', (event) => {
    const data = event.data;

    if (data.type === 'voice_result') {
        chrome.runtime.sendMessage({
            action: 'voice_result_ready',
            status: data.status,
            confidence: data.confidence
        });
        return;
    }

    if (data.id && pendingRequests[data.id]) {
        if (data.qrData !== undefined) {
            if (data.qrData) {
                chrome.runtime.sendMessage({ action: "check_url", url: data.qrData }, (res) => {
                    pendingRequests[data.id](res);
                    delete pendingRequests[data.id];
                });
            } else {
                pendingRequests[data.id]({ status: "NO_QR" });
                delete pendingRequests[data.id];
            }
        }
        else if (data.status) {
            pendingRequests[data.id](data);
            delete pendingRequests[data.id];
        }
    }
});

// Mic Processing
async function startVoiceAI() {
    try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioContext = new AudioContext({ sampleRate: 22050 });
        const source = audioContext.createMediaStreamSource(mediaStream);
        let mfccFeatures = [];

        const meydaAnalyzer = Meyda.createAnalyzer({
            "audioContext": audioContext, "source": source, "bufferSize": 512, "featureExtractors": ["mfcc"],
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
                // Send MFCC arrays to Sandbox for prediction
                sandbox.contentWindow.postMessage({ action: 'predict_voice', features: mfccFeatures }, '*');
            }
        }, 7000);
    } catch (e) { console.error(e); }
}